import {
	ButtonComponent,
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Modal,
	Notice,
	Platform,
	Plugin,
	Setting,
	TFile,
	normalizePath,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	TaskJournalCheckboxSinkSettingTab,
	TaskJournalCheckboxSinkSettings,
} from './settings';
import { parsePersistedPluginData, PersistedPluginData } from './data';
import { hideCompletionDateExtension } from './editor';
import {
	replaceVaultFileContent,
	trashVaultFile,
} from './vault-operations';
import {
	ManualCheckboxAttempt,
	ManualCheckboxCoordinator,
} from './checkbox';
import {
	appendCompletedTaskBlocks,
	appendUnderHeading,
	collectCompletedTaskBlocks,
	extractTaskText,
	formatDailyNotePath,
	formatJournalEntry,
	isLineInFencedCodeBlock,
	isLineInHtmlComment,
	isPathInScope,
	moveTaskBlockToSiblingEnd,
	organizeCompletedTasks,
	parseTaskLine,
	setTaskBlockCompleted,
	setTaskPartial,
	synchronizeCheckboxCompletionDates,
	TaskStatus,
} from './task';
import {
	applyReversePatch,
	createUndoRecord,
	hashContent,
	PlannedFileChange,
	UndoOperationType,
	UndoRecord,
} from './undo';

interface StatusChoice {
	id: TaskStatus | 'cancel';
	label: string;
}

const STATUS_CHOICES: StatusChoice[] = [
	{ id: 'completed', label: '已完成' },
	{ id: 'partial', label: '部分完成' },
	{ id: 'cancel', label: '取消' },
];
const LEGACY_DEFAULT_DAILY_NOTE_PATH_FORMAT = '00 Journal/Daily/YYYY-MM-DD.md';

export default class TaskJournalCheckboxSinkPlugin extends Plugin {
	settings!: TaskJournalCheckboxSinkSettings;
	private lastUndoRecord: UndoRecord | null = null;
	private isAutoOrganizing = false;
	private isInternalVaultWrite = false;
	private editorAutoOrganizeTimeout: number | null = null;
	private editorAutoOrganizePath: string | null = null;
	private vaultAutoOrganizeTimeouts = new Map<string, number>();
	private checkboxCoordinator!: ManualCheckboxCoordinator;

	async onload() {
		await this.loadSettings();
		this.registerEditorExtension(hideCompletionDateExtension);
		this.checkboxCoordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async (path) => this.readActiveEditorContent(path),
			commit: async (attempt, nativeChangedContent) => {
				await this.recordManualCheckboxOperation(attempt, nativeChangedContent);
			},
			onError: (error) => {
				console.error('Task Journal Checkbox Sink failed to record checkbox operation', error);
				new Notice('记录 checkbox 操作失败，请打开开发者控制台查看错误');
			},
		});

		this.addCommand({
			id: 'record-task-status',
			name: '记录任务状态',
			editorCallback: async (editor: Editor) => {
				try {
					await this.recordTaskStatus(editor);
				} catch (error) {
					console.error('Task Journal Checkbox Sink failed to record task status', error);
					new Notice('记录任务状态失败，请打开开发者控制台查看错误');
				}
			},
		});

		this.addCommand({
			id: 'archive-completed-tasks',
			name: '归档已完成任务',
			callback: async () => {
				try {
					await this.archiveCompletedTasks();
				} catch (error) {
					console.error('Task Journal Checkbox Sink failed to archive completed tasks', error);
					new Notice('归档已完成任务失败，请打开开发者控制台查看错误');
				}
			},
		});

		this.addCommand({
			id: 'undo-last-task-operation',
			name: '撤销上一次任务操作',
			callback: async () => {
				try {
					await this.undoLastTaskOperation();
				} catch (error) {
					console.error('Task Journal Checkbox Sink failed to undo task operation', error);
					new Notice('撤销上一次任务操作失败，请打开开发者控制台查看错误');
				}
			},
		});

		this.addSettingTab(new TaskJournalCheckboxSinkSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, info) => {
				const file = info.file;
				if (file instanceof TFile) {
					this.checkboxCoordinator.observe(file.path, editor.getValue());
				}
				this.scheduleAutoOrganizeEditor(editor, info);
			}),
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) {
					if (this.checkboxCoordinator.has(file.path)) {
						void this.observePendingCheckboxVaultFile(file);
					}
					this.scheduleAutoOrganizeVaultFile(file);
				}
			}),
		);

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.checkboxCoordinator.cancelExcept(file?.path ?? null);
			}),
		);

		const ownerDocument = this.app.workspace.containerEl.ownerDocument;
		this.registerDomEvent(
			ownerDocument,
			'click',
			(event) => {
				this.scheduleCheckboxCompletionUpdate(event);
			},
			{ capture: true },
		);

		this.register(() => {
			if (this.editorAutoOrganizeTimeout !== null) {
				window.clearTimeout(this.editorAutoOrganizeTimeout);
			}
			this.editorAutoOrganizeTimeout = null;
			this.editorAutoOrganizePath = null;

			for (const timeout of this.vaultAutoOrganizeTimeouts.values()) {
				window.clearTimeout(timeout);
			}
			this.vaultAutoOrganizeTimeouts.clear();
			this.checkboxCoordinator.dispose();
		});
	}

	async loadSettings() {
		const loadedData = await this.loadData() as unknown;
		const persistedData = parsePersistedPluginData(loadedData);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, persistedData.settings);
		this.lastUndoRecord = persistedData.lastUndoRecord;

		if (this.settings.dailyNotePathFormat === LEGACY_DEFAULT_DAILY_NOTE_PATH_FORMAT) {
			this.settings.dailyNotePathFormat = DEFAULT_SETTINGS.dailyNotePathFormat;
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.savePluginData();
	}

	private async savePluginData(): Promise<void> {
		const data: PersistedPluginData = {
			settings: this.settings,
			lastUndoRecord: this.lastUndoRecord,
		};
		await this.saveData(data);
	}

	private async recordTaskStatus(editor: Editor): Promise<void> {
		new Notice('正在记录任务状态');
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		const lines = getEditorLines(editor);

		if (
			!parseTaskLine(currentLine) ||
			isLineInFencedCodeBlock(lines, cursor.line) ||
			isLineInHtmlComment(lines, cursor.line)
		) {
			new Notice('当前行不是任务项');
			return;
		}

		const choice = await new StatusChoiceModal(this.app).choose();
		if (!choice || choice.id === 'cancel') {
			return;
		}

		const summary = await new SummaryModal(this.app).requestSummary();
		if (summary === null) {
			return;
		}

		const now = new Date();
		const sourceFile = this.app.workspace.getActiveFile();
		if (!(sourceFile instanceof TFile) || sourceFile.extension !== 'md') {
			new Notice('当前活动文件不是 Markdown 文件');
			return;
		}

		const sourceBefore = editor.getValue();
		const update = this.calculateTaskStatusUpdate(lines, cursor.line, choice.id, now);
		const updatedLine = update.updatedLine;
		const taskText = extractTaskText(updatedLine);
		const entry = formatJournalEntry(choice.id, taskText, summary, now);
		const changes = await this.planStatusRecordChanges(
			sourceFile.path,
			sourceBefore,
			update.content,
			entry,
			now,
		);
		await this.executePlannedChanges('status-record', changes, now);
		new Notice('任务记录已写入 daily note');
	}

	private calculateTaskStatusUpdate(
		lines: string[],
		lineNumber: number,
		status: TaskStatus,
		now: Date,
	): { content: string; updatedLine: string } {
		const currentLine = lines[lineNumber] ?? '';

		if (status === 'partial') {
			const updatedLine = setTaskPartial(currentLine);
			const updatedLines = [...lines];
			updatedLines[lineNumber] = updatedLine;
			return { content: updatedLines.join('\n'), updatedLine };
		}

		const completedLines = setTaskBlockCompleted(lines, lineNumber, now);
		const completedLine = completedLines[lineNumber] ?? lines[lineNumber] ?? '';
		const updatedLines = moveTaskBlockToSiblingEnd(completedLines, lineNumber);
		return { content: updatedLines.join('\n'), updatedLine: completedLine };
	}

	private async planStatusRecordChanges(
		sourcePath: string,
		sourceBefore: string,
		sourceAfter: string,
		entry: string,
		now: Date,
	): Promise<PlannedFileChange[]> {
		const dailyNotePath = normalizePath(
			formatDailyNotePath(
				this.settings.dailyNotePathFormat || DEFAULT_SETTINGS.dailyNotePathFormat,
				this.settings.dailyNoteDateFormat || DEFAULT_SETTINGS.dailyNoteDateFormat,
				now,
			),
		);
		const heading = this.settings.dailyNoteHeading || DEFAULT_SETTINGS.dailyNoteHeading;
		const existing = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (existing && !(existing instanceof TFile)) {
			throw new Error(`Daily Note 路径不是 Markdown 文件：${dailyNotePath}`);
		}

		if (dailyNotePath === sourcePath) {
			return [{
				path: sourcePath,
				beforeContent: sourceBefore,
				afterContent: appendUnderHeading(sourceAfter, heading, entry),
			}];
		}

		const dailyNoteBefore =
			existing instanceof TFile ? await this.readFileContent(existing) : null;
		return [
			{ path: sourcePath, beforeContent: sourceBefore, afterContent: sourceAfter },
			{
				path: dailyNotePath,
				beforeContent: dailyNoteBefore,
				afterContent: appendUnderHeading(dailyNoteBefore ?? '', heading, entry),
			},
		];
	}

	private async archiveCompletedTasks(): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!(activeFile instanceof TFile) || activeFile.extension !== 'md') {
			new Notice('当前活动文件不是 Markdown 文件');
			return;
		}

		const archiveHeading = this.settings.archiveHeading || DEFAULT_SETTINGS.archiveHeading;
		const archiveFilePath = normalizePath(
			this.settings.archiveFilePath || DEFAULT_SETTINGS.archiveFilePath,
		);
		const archiveTargetIsCurrentFile =
			this.settings.archiveTargetMode === 'heading' || archiveFilePath === activeFile.path;
		const sourceContent = await this.readFileContent(activeFile);
		const sourceLines = sourceContent.replace(/\r\n/g, '\n').split('\n');
		const collection = collectCompletedTaskBlocks(
			sourceLines,
			archiveTargetIsCurrentFile ? archiveHeading : undefined,
		);

		if (collection.entries.length === 0) {
			new Notice('当前文件没有可归档的已完成任务');
			return;
		}

		const groupMode = this.settings.archiveGroupMode || DEFAULT_SETTINGS.archiveGroupMode;
		const archiveNow = new Date();
		const remainingContent = collection.remainingLines.join('\n');

		if (archiveTargetIsCurrentFile) {
			const result = appendCompletedTaskBlocks(
				remainingContent,
				archiveHeading,
				groupMode,
				collection.entries,
				archiveNow,
			);
			await this.executePlannedChanges(
				'archive',
				[{ path: activeFile.path, beforeContent: sourceContent, afterContent: result.content }],
				archiveNow,
			);
			this.showArchiveNotice(collection.entries.length, result.missingCompletionDateCount);
			return;
		}

		const archiveFile = this.app.vault.getAbstractFileByPath(archiveFilePath);
		if (archiveFile && !(archiveFile instanceof TFile)) {
			new Notice(`归档路径不是 Markdown 文件：${archiveFilePath}`);
			return;
		}

		if (archiveFile instanceof TFile) {
			const archiveContent = await this.readFileContent(archiveFile);
			const result = appendCompletedTaskBlocks(
				archiveContent,
				archiveHeading,
				groupMode,
				collection.entries,
				archiveNow,
			);
			await this.executePlannedChanges(
				'archive',
				[
					{
						path: archiveFile.path,
						beforeContent: archiveContent,
						afterContent: result.content,
					},
					{
						path: activeFile.path,
						beforeContent: sourceContent,
						afterContent: remainingContent,
					},
				],
				archiveNow,
			);
			this.showArchiveNotice(collection.entries.length, result.missingCompletionDateCount);
			return;
		} else {
			const result = appendCompletedTaskBlocks(
				'',
				archiveHeading,
				groupMode,
				collection.entries,
				archiveNow,
			);
			await this.executePlannedChanges(
				'archive',
				[
					{ path: archiveFilePath, beforeContent: null, afterContent: result.content },
					{
						path: activeFile.path,
						beforeContent: sourceContent,
						afterContent: remainingContent,
					},
				],
				archiveNow,
			);
			this.showArchiveNotice(collection.entries.length, result.missingCompletionDateCount);
			return;
		}
	}

	private showArchiveNotice(archivedCount: number, missingCompletionDateCount: number): void {
		const fallbackMessage =
			missingCompletionDateCount > 0
				? `；其中 ${missingCompletionDateCount} 个旧任务缺少完成日期，已按今天分组`
				: '';
		new Notice(`已归档 ${archivedCount} 个已完成任务${fallbackMessage}`);
	}

	private scheduleAutoOrganizeEditor(editor: Editor, info: MarkdownFileInfo): void {
		const file = info.file;
		if (
			this.isAutoOrganizing ||
			this.isInternalVaultWrite ||
			!this.settings.autoOrganizeEnabled ||
			(file !== null && this.checkboxCoordinator.has(file.path))
		) {
			return;
		}

		if (!file || file.extension !== 'md') {
			return;
		}

		const activeFilePath = this.app.workspace.getActiveFile()?.path ?? '';
		if (!isPathInScope(file.path, activeFilePath, this.settings)) {
			return;
		}

		if (this.editorAutoOrganizeTimeout !== null) {
			window.clearTimeout(this.editorAutoOrganizeTimeout);
		}

		this.editorAutoOrganizePath = file.path;
		this.editorAutoOrganizeTimeout = window.setTimeout(() => {
			this.editorAutoOrganizeTimeout = null;
			this.editorAutoOrganizePath = null;
			this.autoOrganizeEditor(editor);
		}, this.settings.autoOrganizeDelayMs);
	}

	private autoOrganizeEditor(editor: Editor): void {
		if (this.isAutoOrganizing || this.isInternalVaultWrite) {
			return;
		}

		const lines = getEditorLines(editor);
		const organizedLines = organizeCompletedTasks(lines);
		if (organizedLines.join('\n') === lines.join('\n')) {
			return;
		}

		this.isAutoOrganizing = true;
		try {
			replaceEditorContent(editor, organizedLines);
		} finally {
			this.isAutoOrganizing = false;
		}
	}

	private scheduleCheckboxCompletionUpdate(event: Event): void {
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}

		const checkbox = target.closest('input.task-list-item-checkbox[type="checkbox"]');
		if (!(checkbox instanceof HTMLInputElement)) {
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!view || !(file instanceof TFile)) {
			return;
		}

		this.cancelAutoOrganizeForPath(file.path);
		this.checkboxCoordinator.begin({
			path: file.path,
			beforeContent: view.editor.getValue(),
			completedAt: new Date(),
		});
	}

	private async recordManualCheckboxOperation(
		attempt: ManualCheckboxAttempt,
		nativeChangedContent: string,
	): Promise<void> {
		const beforeContent = attempt.beforeContent;
		const beforeLines = beforeContent.split('\n');
		const afterLines = nativeChangedContent.split('\n');

		const synchronizedLines = synchronizeCheckboxCompletionDates(
			beforeLines,
			afterLines,
			attempt.completedAt,
		);
		const activeFilePath = this.app.workspace.getActiveFile()?.path ?? '';
		const shouldOrganize =
			this.settings.autoOrganizeEnabled &&
			isPathInScope(attempt.path, activeFilePath, this.settings);
		const updatedLines = shouldOrganize
			? organizeCompletedTasks(synchronizedLines, attempt.completedAt)
			: synchronizedLines;
		const afterContent = updatedLines.join('\n');
		if (beforeContent === afterContent) {
			return;
		}

		await this.executePlannedChanges(
			'manual-checkbox',
			[{ path: attempt.path, beforeContent, afterContent }],
			attempt.completedAt,
			new Map([[attempt.path, nativeChangedContent]]),
		);
	}

	private scheduleAutoOrganizeVaultFile(file: TFile): void {
		if (
			this.isAutoOrganizing ||
			this.isInternalVaultWrite ||
			!this.settings.autoOrganizeEnabled ||
			file.extension !== 'md' ||
			this.checkboxCoordinator.has(file.path)
		) {
			return;
		}

		const activeFilePath = this.app.workspace.getActiveFile()?.path ?? '';
		if (!isPathInScope(file.path, activeFilePath, this.settings)) {
			return;
		}

		const existingTimeout = this.vaultAutoOrganizeTimeouts.get(file.path);
		if (existingTimeout !== undefined) {
			window.clearTimeout(existingTimeout);
		}

		const timeout = window.setTimeout(() => {
			this.vaultAutoOrganizeTimeouts.delete(file.path);
			this.autoOrganizeVaultFile(file).catch((error) => {
				console.error('Task Journal Checkbox Sink failed to auto organize file', error);
				new Notice('自动整理任务失败，请打开开发者控制台查看错误');
			});
		}, this.settings.autoOrganizeDelayMs);

		this.vaultAutoOrganizeTimeouts.set(file.path, timeout);
	}

	private cancelAutoOrganizeForPath(path: string): void {
		if (this.editorAutoOrganizePath === path && this.editorAutoOrganizeTimeout !== null) {
			window.clearTimeout(this.editorAutoOrganizeTimeout);
			this.editorAutoOrganizeTimeout = null;
			this.editorAutoOrganizePath = null;
		}

		const vaultTimeout = this.vaultAutoOrganizeTimeouts.get(path);
		if (vaultTimeout !== undefined) {
			window.clearTimeout(vaultTimeout);
			this.vaultAutoOrganizeTimeouts.delete(path);
		}
	}

	private async observePendingCheckboxVaultFile(file: TFile): Promise<void> {
		try {
			const currentContent = await this.readFileContent(file);
			this.checkboxCoordinator.observe(file.path, currentContent);
		} catch (error) {
			console.error(`Failed to observe checkbox change for ${file.path}`, error);
			this.checkboxCoordinator.cancel(file.path);
		}
	}

	private async readActiveEditorContent(path: string): Promise<string | null> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file?.path !== path) {
			return null;
		}

		if (activeView.getMode() === 'preview') {
			return this.app.vault.read(activeView.file);
		}

		return activeView.editor.getValue();
	}

	private async autoOrganizeVaultFile(file: TFile): Promise<void> {
		if (this.isAutoOrganizing || this.isInternalVaultWrite) {
			return;
		}

		const content = await this.app.vault.read(file);
		const lines = content.replace(/\r\n/g, '\n').split('\n');
		const organizedContent = organizeCompletedTasks(lines).join('\n');
		if (organizedContent === content.replace(/\r\n/g, '\n')) {
			return;
		}

		this.isAutoOrganizing = true;
		try {
			await this.modifyVaultFile(file, organizedContent);
		} finally {
			this.isAutoOrganizing = false;
		}
	}

	private async executePlannedChanges(
		operation: UndoOperationType,
		changes: PlannedFileChange[],
		createdAt: Date,
		alreadyAppliedContents = new Map<string, string>(),
	): Promise<void> {
		const effectiveChanges = changes.filter(
			(change) => change.beforeContent !== change.afterContent,
		);
		if (effectiveChanges.length === 0) {
			return;
		}

		const uniquePaths = new Set(effectiveChanges.map((change) => change.path));
		if (uniquePaths.size !== effectiveChanges.length) {
			throw new Error('同一次任务操作包含重复文件路径');
		}

		for (const change of effectiveChanges) {
			const existing = this.app.vault.getAbstractFileByPath(change.path);
			if (change.beforeContent === null) {
				if (existing) {
					throw new Error(`目标文件已存在，无法安全写入：${change.path}`);
				}
				continue;
			}

			if (!(existing instanceof TFile)) {
				throw new Error(`目标 Markdown 文件不存在：${change.path}`);
			}

			const alreadyAppliedContent = alreadyAppliedContents.get(change.path);
			if (alreadyAppliedContent !== undefined) {
				const currentContent = await this.readFileContent(existing);
				if (currentContent !== alreadyAppliedContent) {
					throw new Error(`文件在 checkbox 操作后又发生变化：${change.path}`);
				}
				continue;
			}

			const currentContent = await this.readFileContent(existing);
			if (currentContent !== change.beforeContent) {
				throw new Error(`文件在操作前已发生变化：${change.path}`);
			}
		}

		const previousUndoRecord = this.lastUndoRecord;
		const appliedChanges: PlannedFileChange[] = [];
		try {
			for (const change of effectiveChanges) {
				await this.writePlannedFileChange(change);
				appliedChanges.push(change);
			}

			this.lastUndoRecord = createUndoRecord(operation, effectiveChanges, createdAt);
			await this.savePluginData();
		} catch (error) {
			await this.rollbackPlannedChanges(appliedChanges);
			this.lastUndoRecord = previousUndoRecord;
			throw error;
		}
	}

	private async undoLastTaskOperation(): Promise<void> {
		const record = this.lastUndoRecord;
		if (!record) {
			new Notice('没有可撤销的任务操作');
			return;
		}

		const targets: Array<{
			change: UndoRecord['files'][number];
			currentContent: string;
			restoredContent: string | null;
		}> = [];
		const conflicts: string[] = [];

		for (const change of record.files) {
			const existing = this.app.vault.getAbstractFileByPath(change.path);
			if (!(existing instanceof TFile)) {
				conflicts.push(change.path);
				continue;
			}

			const currentContent = await this.readFileContent(existing);
			if (hashContent(currentContent) !== change.afterHash) {
				conflicts.push(change.path);
				continue;
			}

			if (change.created) {
				targets.push({ change, currentContent, restoredContent: null });
				continue;
			}

			const restoredContent = change.reversePatch
				? applyReversePatch(currentContent, change.reversePatch)
				: null;
			if (restoredContent === null) {
				conflicts.push(change.path);
				continue;
			}

			targets.push({ change, currentContent, restoredContent });
		}

		if (conflicts.length > 0) {
			new Notice(`无法撤销，以下文件已发生变化：${conflicts.join('、')}`);
			return;
		}

		const appliedTargets: typeof targets = [];
		try {
			for (const target of targets) {
				if (target.restoredContent === null) {
					await this.deleteVaultFile(target.change.path);
				} else {
					await this.writeFileContent(target.change.path, target.restoredContent);
				}
				appliedTargets.push(target);
			}

			this.lastUndoRecord = null;
			await this.savePluginData();
		} catch (error) {
			await this.rollbackUndoTargets(appliedTargets);
			this.lastUndoRecord = record;
			throw error;
		}

		new Notice('已撤销上一次任务操作');
	}

	private async writePlannedFileChange(change: PlannedFileChange): Promise<void> {
		if (change.beforeContent === null) {
			await this.ensureParentFolders(change.path);
			await this.createVaultFile(change.path, change.afterContent);
			return;
		}

		await this.writeFileContent(change.path, change.afterContent);
	}

	private async rollbackPlannedChanges(changes: PlannedFileChange[]): Promise<void> {
		for (const change of [...changes].reverse()) {
			try {
				if (change.beforeContent === null) {
					await this.deleteVaultFile(change.path);
				} else {
					await this.writeFileContent(change.path, change.beforeContent);
				}
			} catch (error) {
				console.error(`Failed to roll back task operation for ${change.path}`, error);
			}
		}
	}

	private async rollbackUndoTargets(
		targets: Array<{
			change: UndoRecord['files'][number];
			currentContent: string;
			restoredContent: string | null;
		}>,
	): Promise<void> {
		for (const target of [...targets].reverse()) {
			try {
				const existing = this.app.vault.getAbstractFileByPath(target.change.path);
				if (existing instanceof TFile) {
					await this.writeFileContent(target.change.path, target.currentContent);
				} else {
					await this.ensureParentFolders(target.change.path);
					await this.createVaultFile(target.change.path, target.currentContent);
				}
			} catch (error) {
				console.error(`Failed to roll back undo for ${target.change.path}`, error);
			}
		}
	}

	private async readFileContent(file: TFile): Promise<string> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file?.path === file.path) {
			if (activeView.getMode() === 'preview') {
				return this.app.vault.read(file);
			}

			return activeView.editor.getValue();
		}

		return this.app.vault.read(file);
	}

	private async writeFileContent(path: string, content: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!(existing instanceof TFile)) {
			throw new Error(`目标 Markdown 文件不存在：${path}`);
		}

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.file?.path === path) {
			this.isInternalVaultWrite = true;
			try {
				activeView.editor.setValue(content);
			} finally {
				this.isInternalVaultWrite = false;
			}
			return;
		}

		await this.modifyVaultFile(existing, content);
	}

	private async deleteVaultFile(path: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (!existing) {
			return;
		}

		if (!(existing instanceof TFile)) {
			throw new Error(`撤销目标不是文件：${path}`);
		}

		this.isInternalVaultWrite = true;
		try {
			await trashVaultFile(this.app.fileManager, existing);
		} finally {
			this.isInternalVaultWrite = false;
		}
	}

	private async modifyVaultFile(file: TFile, content: string): Promise<void> {
		this.isInternalVaultWrite = true;
		try {
			await replaceVaultFileContent(this.app.vault, file, content);
		} finally {
			this.isInternalVaultWrite = false;
		}
	}

	private async createVaultFile(path: string, content: string): Promise<void> {
		this.isInternalVaultWrite = true;
		try {
			await this.app.vault.create(path, content);
		} finally {
			this.isInternalVaultWrite = false;
		}
	}

	private async ensureParentFolders(path: string): Promise<void> {
		const parts = path.split('/');
		parts.pop();

		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}
}

class StatusChoiceModal extends Modal {
	private resolver: ((choice: StatusChoice | null) => void) | null = null;
	private selected = false;

	choose(): Promise<StatusChoice | null> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('task-journal-modal');
		contentEl.empty();
		contentEl.createEl('h2', { text: '记录任务状态' });

		const listEl = contentEl.createDiv({ cls: 'task-journal-status-list' });
		for (const choice of STATUS_CHOICES) {
			new ButtonComponent(listEl)
				.setButtonText(choice.label)
				.onClick(() => {
					this.chooseStatus(choice);
				});
		}
	}

	private chooseStatus(choice: StatusChoice): void {
		this.selected = true;
		this.resolver?.(choice);
		this.resolver = null;
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();

		if (!this.selected) {
			this.resolver?.(null);
		}
		this.resolver = null;
	}
}

class SummaryModal extends Modal {
	private resolver: ((summary: string | null) => void) | null = null;
	private summary = '';
	private submitted = false;
	private focusFrame: number | null = null;

	requestSummary(): Promise<string | null> {
		return new Promise((resolve) => {
			this.resolver = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('task-journal-modal');
		this.modalEl.addClass('task-journal-summary-modal');
		contentEl.empty();
		contentEl.createEl('h2', { text: '填写任务总结' });

		new Setting(contentEl)
			.setName('总结')
			.setDesc('可以留空。')
			.addTextArea((text) => {
				text
					.setPlaceholder('今天完成了什么？')
					.onChange((value) => {
						this.summary = value;
				});
				text.inputEl.rows = 4;
				if (!Platform.isMobile) {
					text.inputEl.focus();
					const ownerWindow = text.inputEl.ownerDocument.defaultView;
					if (ownerWindow) {
						this.focusFrame = ownerWindow.requestAnimationFrame(() => {
							this.focusFrame = null;
							text.inputEl.focus();
						});
					}
				}
			});

		const buttonRow = contentEl.createDiv({ cls: 'task-journal-modal-buttons' });

		new ButtonComponent(buttonRow)
			.setButtonText('取消')
			.onClick(() => {
				this.close();
			});

		new ButtonComponent(buttonRow)
			.setButtonText('确定')
			.setCta()
			.onClick(() => {
				this.submitted = true;
				this.resolver?.(this.summary);
				this.resolver = null;
				this.close();
			});
	}

	onClose(): void {
		const { contentEl } = this;
		const ownerWindow = contentEl.ownerDocument.defaultView;
		if (ownerWindow && this.focusFrame !== null) {
			ownerWindow.cancelAnimationFrame(this.focusFrame);
			this.focusFrame = null;
		}
		contentEl.empty();

		if (!this.submitted) {
			this.resolver?.(null);
		}
		this.resolver = null;
	}
}

function getEditorLines(editor: Editor): string[] {
	const lines: string[] = [];
	for (let line = 0; line < editor.lineCount(); line += 1) {
		lines.push(editor.getLine(line));
	}
	return lines;
}

function replaceEditorContent(editor: Editor, lines: string[]): void {
	const lastLine = editor.lineCount() - 1;
	editor.replaceRange(
		lines.join('\n'),
		{ line: 0, ch: 0 },
		{ line: lastLine, ch: editor.getLine(lastLine).length },
	);
}
