import * as Obsidian from 'obsidian';
import {
	ButtonComponent,
	Command,
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
import { mergeSettingsWithDefaults } from './default-settings';
import { parsePersistedPluginData, PersistedPluginData } from './data';
import {
	LanguageSetting,
	getLocalizedDefaultHeadings,
	resolveLanguage,
	SupportedLanguage,
	translate,
	TranslationKey,
} from './i18n';
import { hideCompletionDateExtension } from './editor';
import { updatePartialTaskClasses } from './reading-view';
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
}

const STATUS_CHOICES: StatusChoice[] = [
	{ id: 'completed' },
	{ id: 'partial' },
	{ id: 'cancel' },
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
	private effectiveLanguage: SupportedLanguage = 'en';
	private localizedCommands: Array<{ command: Command; key: TranslationKey }> = [];
	private ribbonIconEl: HTMLElement | null = null;
	private settingTab!: TaskJournalCheckboxSinkSettingTab;

	async onload() {
		await this.loadSettings();
		this.registerEditorExtension(hideCompletionDateExtension);
		this.registerMarkdownPostProcessor((element) => {
			updatePartialTaskClasses(element);
		});
		this.checkboxCoordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async (path) => this.readActiveEditorContent(path),
			commit: async (attempt, nativeChangedContent) => {
				await this.recordManualCheckboxOperation(attempt, nativeChangedContent);
			},
			onError: (error) => {
				console.error('Task Journal Checkbox Sink failed to record checkbox operation', error);
				new Notice(this.t('notice.checkboxFailed'));
			},
		});

		const recordTaskStatusCommand = this.addCommand({
			id: 'record-task-status',
			name: this.t('command.recordTaskStatus'),
			editorCallback: async (editor: Editor) => {
				try {
					await this.recordTaskStatus(editor);
				} catch (error) {
					console.error('Task Journal Checkbox Sink failed to record task status', error);
					new Notice(this.t('notice.recordFailed'));
				}
			},
		});
		this.localizedCommands.push({
			command: recordTaskStatusCommand,
			key: 'command.recordTaskStatus',
		});

		const archiveCommand = this.addCommand({
			id: 'archive-completed-tasks',
			name: this.t('command.archiveCompletedTasks'),
			callback: async () => {
				try {
					await this.archiveCompletedTasks();
				} catch (error) {
					console.error('Task Journal Checkbox Sink failed to archive completed tasks', error);
					new Notice(this.t('notice.archiveFailed'));
				}
			},
		});
		this.localizedCommands.push({
			command: archiveCommand,
			key: 'command.archiveCompletedTasks',
		});

		const undoCommand = this.addCommand({
			id: 'undo-last-task-operation',
			name: this.t('command.undoLastTaskOperation'),
			callback: async () => {
				try {
					await this.undoLastTaskOperation();
				} catch (error) {
					console.error('Task Journal Checkbox Sink failed to undo task operation', error);
					new Notice(this.t('notice.undoFailed'));
				}
			},
		});
		this.localizedCommands.push({
			command: undoCommand,
			key: 'command.undoLastTaskOperation',
		});

		if (Platform.isDesktop) {
			this.ribbonIconEl = this.addRibbonIcon(
				'list-checks',
				this.t('ribbon.recordTaskStatus'),
				() => {
					void this.recordTaskStatusFromRibbon();
				},
			);
		}

		this.settingTab = new TaskJournalCheckboxSinkSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

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
		const ownerDocument = this.app.workspace.containerEl.ownerDocument;
		const appLanguage = detectAppLanguage(ownerDocument);
		const automaticLanguage = resolveLanguage('auto', appLanguage);
		this.settings = mergeSettingsWithDefaults(persistedData.settings, automaticLanguage);
		this.effectiveLanguage = resolveLanguage(this.settings.language, appLanguage);
		this.lastUndoRecord = persistedData.lastUndoRecord;

		if (this.settings.dailyNotePathFormat === LEGACY_DEFAULT_DAILY_NOTE_PATH_FORMAT) {
			this.settings.dailyNotePathFormat = DEFAULT_SETTINGS.dailyNotePathFormat;
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.savePluginData();
	}

	getEffectiveLanguage(): SupportedLanguage {
		return this.effectiveLanguage;
	}

	t(
		key: TranslationKey,
		values: Record<string, string | number> = {},
	): string {
		return translate(this.effectiveLanguage, key, values);
	}

	async changeLanguage(language: LanguageSetting): Promise<void> {
		this.settings.language = language;
		this.effectiveLanguage = resolveLanguage(
			language,
			detectAppLanguage(this.app.workspace.containerEl.ownerDocument),
		);
		await this.saveSettings();
		this.refreshLocalizedUi();
	}

	private refreshLocalizedUi(): void {
		for (const localizedCommand of this.localizedCommands) {
			localizedCommand.command.name = this.t(localizedCommand.key);
		}

		if (this.ribbonIconEl) {
			this.ribbonIconEl.setAttribute('aria-label', this.t('ribbon.recordTaskStatus'));
		}

		this.settingTab?.display();
	}

	private async recordTaskStatusFromRibbon(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file || view.file.extension !== 'md' || view.getMode() === 'preview') {
			new Notice(this.t('notice.notMarkdownFile'));
			return;
		}

		try {
			await this.recordTaskStatus(view.editor);
		} catch (error) {
			console.error('Task Journal Checkbox Sink failed to record task status', error);
			new Notice(this.t('notice.recordFailed'));
		}
	}

	private async savePluginData(): Promise<void> {
		const data: PersistedPluginData = {
			settings: this.settings,
			lastUndoRecord: this.lastUndoRecord,
		};
		await this.saveData(data);
	}

	private async recordTaskStatus(editor: Editor): Promise<void> {
		new Notice(this.t('notice.recording'));
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		const lines = getEditorLines(editor);

		if (
			!parseTaskLine(currentLine) ||
			isLineInFencedCodeBlock(lines, cursor.line) ||
			isLineInHtmlComment(lines, cursor.line)
		) {
			new Notice(this.t('notice.notTaskLine'));
			return;
		}

		const choice = await new StatusChoiceModal(this.app, this.effectiveLanguage).choose();
		if (!choice || choice.id === 'cancel') {
			return;
		}

		const summary = await new SummaryModal(this.app, this.effectiveLanguage).requestSummary();
		if (summary === null) {
			return;
		}

		const now = new Date();
		const sourceFile = this.app.workspace.getActiveFile();
		if (!(sourceFile instanceof TFile) || sourceFile.extension !== 'md') {
			new Notice(this.t('notice.notMarkdownFile'));
			return;
		}

		const sourceBefore = editor.getValue();
		const update = this.calculateTaskStatusUpdate(lines, cursor.line, choice.id, now);
		const updatedLine = update.updatedLine;
		const taskText = extractTaskText(updatedLine);
		const entry = formatJournalEntry(
			choice.id,
			taskText,
			summary,
			now,
			this.effectiveLanguage,
		);
		const changes = await this.planStatusRecordChanges(
			sourceFile.path,
			sourceBefore,
			update.content,
			entry,
			now,
		);
		await this.executePlannedChanges('status-record', changes, now);
		new Notice(this.t('notice.recorded'));
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
		const heading =
			this.settings.dailyNoteHeading ||
			getLocalizedDefaultHeadings(this.effectiveLanguage).dailyNoteHeading;
		const existing = this.app.vault.getAbstractFileByPath(dailyNotePath);
		if (existing && !(existing instanceof TFile)) {
			throw new Error(this.t('error.dailyNoteNotMarkdown', { path: dailyNotePath }));
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
			new Notice(this.t('notice.notMarkdownFile'));
			return;
		}

		const archiveHeading =
			this.settings.archiveHeading ||
			getLocalizedDefaultHeadings(this.effectiveLanguage).archiveHeading;
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
			new Notice(this.t('notice.noArchiveTasks'));
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
			new Notice(this.t('error.archiveNotMarkdown', { path: archiveFilePath }));
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
				? this.t('notice.archiveMissingDates', { count: missingCompletionDateCount })
				: '';
		new Notice(this.t('notice.archiveComplete', {
			count: archivedCount,
			fallback: fallbackMessage,
		}));
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
				new Notice(this.t('notice.autoOrganizeFailed'));
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
			throw new Error(this.t('error.duplicatePaths'));
		}

		for (const change of effectiveChanges) {
			const existing = this.app.vault.getAbstractFileByPath(change.path);
			if (change.beforeContent === null) {
				if (existing) {
					throw new Error(this.t('error.targetExists', { path: change.path }));
				}
				continue;
			}

			if (!(existing instanceof TFile)) {
				throw new Error(this.t('error.targetMissing', { path: change.path }));
			}

			const alreadyAppliedContent = alreadyAppliedContents.get(change.path);
			if (alreadyAppliedContent !== undefined) {
				const currentContent = await this.readFileContent(existing);
				if (currentContent !== alreadyAppliedContent) {
					throw new Error(this.t('error.changedAfterCheckbox', { path: change.path }));
				}
				continue;
			}

			const currentContent = await this.readFileContent(existing);
			if (currentContent !== change.beforeContent) {
				throw new Error(this.t('error.changedBeforeOperation', { path: change.path }));
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
			new Notice(this.t('notice.noUndo'));
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
			new Notice(this.t('notice.undoConflict', {
				paths: conflicts.join(this.effectiveLanguage === 'zh-CN' ? '、' : ', '),
			}));
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

		new Notice(this.t('notice.undoComplete'));
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
			throw new Error(this.t('error.targetMissing', { path }));
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
			throw new Error(this.t('error.undoTargetNotFile', { path }));
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

	constructor(app: TaskJournalCheckboxSinkPlugin['app'], private language: SupportedLanguage) {
		super(app);
	}

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
		contentEl.createEl('h2', {
			text: translate(this.language, 'modal.status.title'),
		});

		const listEl = contentEl.createDiv({ cls: 'task-journal-status-list' });
		for (const choice of STATUS_CHOICES) {
			const labelKey: TranslationKey =
				choice.id === 'completed'
					? 'status.completed'
					: choice.id === 'partial'
						? 'status.partial'
						: 'action.cancel';
			new ButtonComponent(listEl)
				.setButtonText(translate(this.language, labelKey))
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

	constructor(app: TaskJournalCheckboxSinkPlugin['app'], private language: SupportedLanguage) {
		super(app);
	}

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
		contentEl.createEl('h2', {
			text: translate(this.language, 'modal.summary.title'),
		});

		new Setting(contentEl)
			.setName(translate(this.language, 'modal.summary.name'))
			.setDesc(translate(this.language, 'modal.summary.description'))
			.addTextArea((text) => {
				text
					.setPlaceholder(translate(this.language, 'modal.summary.placeholder'))
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
			.setButtonText(translate(this.language, 'action.cancel'))
			.onClick(() => {
				this.close();
			});

		new ButtonComponent(buttonRow)
			.setButtonText(translate(this.language, 'action.confirm'))
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

function detectAppLanguage(ownerDocument: Document): string {
	try {
		const languageGetter = (
			Obsidian as unknown as Record<string, unknown>
		)['getLanguage'];
		if (typeof languageGetter === 'function') {
			return (languageGetter as () => string)();
		}
	} catch {
		// Obsidian versions before getLanguage was introduced use the fallbacks below.
	}

	return (
		ownerDocument.documentElement.lang ||
		ownerDocument.defaultView?.navigator.language ||
		'en'
	);
}
