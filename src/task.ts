export type TaskStatus = 'completed' | 'partial';
export type ArchiveGroupMode = 'day' | 'week' | 'month' | 'none';

export interface ParsedTaskLine {
	indent: string;
	marker: '-' | '*' | '+';
	checkbox: ' ' | 'x';
	text: string;
}

export interface LineRange {
	start: number;
	end: number;
}

export interface CompletedTaskBlockCollection {
	entries: CompletedTaskBlockEntry[];
	ranges: LineRange[];
	remainingLines: string[];
}

export interface CompletedTaskBlockEntry {
	content: string;
	completedAt: Date | null;
}

export interface CompletedTaskArchiveResult {
	content: string;
	missingCompletionDateCount: number;
}

export type ScopeMode = 'current-file' | 'specified-file' | 'folder' | 'vault';

export interface ScopeSettingsLike {
	scopeMode: ScopeMode;
	specifiedFilePath: string;
	specifiedFolderPath: string;
	excludedFolderPaths: string;
}

const taskLinePattern = /^(\s*)([-*+])\s+\[([ xX])\]\s*(.*)$/;
const fencedCodePattern = /^\s*(```|~~~)/;
const headingPattern = /^(#{1,6})\s+/;
const completionDatePattern = /\s*%%task-journal-completed:(\d{4}-\d{2}-\d{2})%%/g;

export function parseTaskLine(line: string): ParsedTaskLine | null {
	const match = line.match(taskLinePattern);
	if (!match) {
		return null;
	}

	const marker = match[2];
	if (marker !== '-' && marker !== '*' && marker !== '+') {
		return null;
	}

	const checkbox = match[3]?.toLowerCase() === 'x' ? 'x' : ' ';

	return {
		indent: match[1] ?? '',
		marker,
		checkbox,
		text: match[4] ?? '',
	};
}

export function setTaskCompleted(line: string): string {
	if (!parseTaskLine(line)) {
		return line;
	}

	return line.replace(/^(\s*[-*+]\s+\[)[ xX](\])/, '$1x$2');
}

export function setTaskCompletedAt(line: string, completedAt: Date): string {
	const completedLine = setTaskCompleted(line);
	if (!parseTaskLine(completedLine)) {
		return line;
	}

	const lineWithoutDate = removeTaskCompletionDate(completedLine);
	return `${lineWithoutDate.trimEnd()} %%task-journal-completed:${formatDate(completedAt, 'YYYY-MM-DD')}%%`;
}

export function removeTaskCompletionDate(line: string): string {
	return line.replace(completionDatePattern, '').trimEnd();
}

export function getTaskCompletionDate(line: string): Date | null {
	completionDatePattern.lastIndex = 0;
	const match = completionDatePattern.exec(line);
	completionDatePattern.lastIndex = 0;
	const value = match?.[1];
	if (!value) {
		return null;
	}

	const [yearText, monthText, dayText] = value.split('-');
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = new Date(year, month - 1, day);
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null;
	}

	return date;
}

export function setTaskPartial(line: string): string {
	const parsed = parseTaskLine(line);
	if (!parsed || parsed.checkbox === 'x') {
		return line;
	}

	if (/(^|\s)#partial(?=\s|$)/.test(line)) {
		return line;
	}

	return `${line.trimEnd()} #partial`;
}

export function setTaskBlockCompleted(
	lines: string[],
	lineNumber: number,
	completedAt?: Date,
): string[] {
	const taskBlock = findTaskBlock(lines, lineNumber);
	if (!taskBlock) {
		return [...lines];
	}

	return lines.map((line, index) => {
		if (index < taskBlock.start || index >= taskBlock.end) {
			return line;
		}

		if (!parseTaskLine(line)) {
			return line;
		}

		return completedAt ? setTaskCompletedAt(line, completedAt) : setTaskCompleted(line);
	});
}

export function extractTaskText(line: string): string {
	const parsed = parseTaskLine(line);
	if (!parsed) {
		return '';
	}

	return removeTaskCompletionDate(parsed.text).replace(/\s+#partial(?=\s*$)/, '').trim();
}

export function getTaskIndent(line: string): number | null {
	const parsed = parseTaskLine(line);
	return parsed ? countIndentColumns(parsed.indent) : null;
}

export function isCompletedTask(line: string): boolean {
	return parseTaskLine(line)?.checkbox === 'x';
}

export function findTaskBlock(lines: string[], lineNumber: number): LineRange | null {
	const currentIndent = getTaskIndent(lines[lineNumber] ?? '');
	if (currentIndent === null) {
		return null;
	}

	let end = lineNumber + 1;
	while (end < lines.length) {
		const line = lines[end] ?? '';
		if (getLineIndent(line) <= currentIndent || getHeadingLevel(line) !== null) {
			break;
		}

		end += 1;
	}

	return { start: lineNumber, end };
}

export function findSiblingTaskListRange(lines: string[], lineNumber: number): LineRange | null {
	const currentIndent = getTaskIndent(lines[lineNumber] ?? '');
	const currentBlock = findTaskBlock(lines, lineNumber);
	if (currentIndent === null || !currentBlock) {
		return null;
	}

	let start = lineNumber;
	let beforeIndex = lineNumber - 1;
	while (beforeIndex >= 0) {
		const line = lines[beforeIndex] ?? '';
		const lineIndent = getLineIndent(line);
		const parsed = parseTaskLine(line);

		if (getHeadingLevel(line) !== null || lineIndent < currentIndent) {
			break;
		}

		if (lineIndent === currentIndent) {
			if (!parsed) {
				break;
			}

			start = beforeIndex;
		}

		beforeIndex -= 1;
	}

	let end = currentBlock.end;
	let afterIndex = currentBlock.end;
	while (afterIndex < lines.length) {
		const line = lines[afterIndex] ?? '';
		const lineIndent = getLineIndent(line);
		const parsed = parseTaskLine(line);

		if (getHeadingLevel(line) !== null || lineIndent < currentIndent) {
			break;
		}

		if (lineIndent === currentIndent) {
			if (!parsed) {
				break;
			}

			const nextBlock = findTaskBlock(lines, afterIndex);
			if (!nextBlock) {
				break;
			}

			end = nextBlock.end;
			afterIndex = nextBlock.end;
			continue;
		}

		break;
	}

	return { start, end };
}

export function moveTaskBlockToSiblingEnd(lines: string[], lineNumber: number): string[] {
	const currentIndent = getTaskIndent(lines[lineNumber] ?? '');
	const currentBlock = findTaskBlock(lines, lineNumber);
	const siblingRange = findSiblingTaskListRange(lines, lineNumber);
	if (currentIndent === null || !currentBlock || !siblingRange) {
		return [...lines];
	}

	let lastSiblingBlockEnd = currentBlock.end;
	let index = siblingRange.start;

	while (index < siblingRange.end) {
		const line = lines[index] ?? '';
		const lineIndent = getTaskIndent(line);
		if (lineIndent === currentIndent) {
			const block = findTaskBlock(lines, index);
			if (!block) {
				break;
			}

			lastSiblingBlockEnd = block.end;
			index = block.end;
			continue;
		}

		index += 1;
	}

	if (currentBlock.end === lastSiblingBlockEnd) {
		return [...lines];
	}

	const blockLines = lines.slice(currentBlock.start, currentBlock.end);
	const remainingLines = [
		...lines.slice(0, currentBlock.start),
		...lines.slice(currentBlock.end),
	];
	const insertionIndex =
		currentBlock.start < lastSiblingBlockEnd
			? lastSiblingBlockEnd - blockLines.length
			: lastSiblingBlockEnd;

	return [
		...remainingLines.slice(0, insertionIndex),
		...blockLines,
		...remainingLines.slice(insertionIndex),
	];
}

export function organizeCompletedTasks(lines: string[], completedAt?: Date): string[] {
	let organizedLines = [...lines];
	let index = 0;

	while (index < organizedLines.length) {
		const line = organizedLines[index] ?? '';
		if (
			!isCompletedTask(line) ||
			isLineInFencedCodeBlock(organizedLines, index) ||
			isLineInHtmlComment(organizedLines, index)
		) {
			index += 1;
			continue;
		}

		if (!hasIncompleteSiblingAfter(organizedLines, index)) {
			const completedLines = setTaskBlockCompleted(organizedLines, index, completedAt);
			if (!areLinesEqual(completedLines, organizedLines)) {
				organizedLines = completedLines;
			}

			index += 1;
			continue;
		}

		const completedLines = setTaskBlockCompleted(organizedLines, index, completedAt);
		const movedLines = moveTaskBlockToSiblingEnd(completedLines, index);
		if (areLinesEqual(movedLines, organizedLines)) {
			index += 1;
			continue;
		}

		organizedLines = movedLines;
	}

	return organizedLines;
}

export function collectCompletedTaskBlocks(
	lines: string[],
	skipHeading?: string,
): CompletedTaskBlockCollection {
	const ranges: LineRange[] = [];
	const entries: CompletedTaskBlockEntry[] = [];
	const skipRange = skipHeading ? findHeadingSectionRange(lines, skipHeading) : null;
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		const block = findTaskBlock(lines, index);
		if (
			!block ||
			!isCompletedTask(line) ||
			isLineInFencedCodeBlock(lines, index) ||
			isLineInHtmlComment(lines, index) ||
			isRangeInsideRange(block, skipRange)
		) {
			index += 1;
			continue;
		}

		ranges.push(block);
		entries.push({
			content: lines.slice(block.start, block.end).join('\n'),
			completedAt: getTaskCompletionDate(line),
		});
		index = block.end;
	}

	return {
		entries,
		ranges,
		remainingLines: removeLineRanges(lines, ranges),
	};
}

export function removeLineRanges(lines: string[], ranges: LineRange[]): string[] {
	if (ranges.length === 0) {
		return [...lines];
	}

	return lines.filter((_, index) =>
		!ranges.some((range) => index >= range.start && index < range.end),
	);
}

export function appendArchiveEntries(
	content: string,
	archiveHeading: string,
	groupHeading: string | null,
	entries: string[],
): string {
	if (entries.length === 0) {
		return ensureTrailingNewline(content.replace(/\r\n/g, '\n'));
	}

	const normalizedHeading = archiveHeading.trim();
	const normalizedContent = ensureTrailingNewline(content.replace(/\r\n/g, '\n'));
	const entryBlock = entries.join('\n');

	if (!groupHeading) {
		return appendUnderHeading(normalizedContent, normalizedHeading, entryBlock);
	}

	const nestedGroupHeading = normalizeNestedHeading(groupHeading, normalizedHeading);
	const contentWithArchiveHeading = ensureHeadingExists(normalizedContent, normalizedHeading);
	const contentWithGroupHeading = ensureHeadingUnderHeading(
		contentWithArchiveHeading,
		normalizedHeading,
		nestedGroupHeading,
	);

	return appendUnderHeading(contentWithGroupHeading, nestedGroupHeading, entryBlock);
}

export function appendCompletedTaskBlocks(
	content: string,
	archiveHeading: string,
	groupMode: ArchiveGroupMode,
	entries: CompletedTaskBlockEntry[],
	fallbackDate: Date,
): CompletedTaskArchiveResult {
	const groupedEntries = new Map<string | null, string[]>();
	let missingCompletionDateCount = 0;

	for (const entry of entries) {
		if (!entry.completedAt) {
			missingCompletionDateCount += 1;
		}

		const groupHeading = formatArchiveGroupHeading(
			groupMode,
			entry.completedAt ?? fallbackDate,
		);
		const groupEntries = groupedEntries.get(groupHeading) ?? [];
		groupEntries.push(entry.content);
		groupedEntries.set(groupHeading, groupEntries);
	}

	let archivedContent = content;
	for (const [groupHeading, groupEntries] of groupedEntries) {
		archivedContent = appendArchiveEntries(
			archivedContent,
			archiveHeading,
			groupHeading,
			groupEntries,
		);
	}

	return { content: archivedContent, missingCompletionDateCount };
}

export function synchronizeCheckboxCompletionDates(
	beforeLines: string[],
	afterLines: string[],
	completedAt: Date,
): string[] {
	if (beforeLines.length !== afterLines.length) {
		return [...afterLines];
	}

	return afterLines.map((line, index) => {
		const beforeTask = parseTaskLine(beforeLines[index] ?? '');
		const afterTask = parseTaskLine(line);
		if (!beforeTask || !afterTask) {
			return line;
		}

		if (beforeTask.checkbox === ' ' && afterTask.checkbox === 'x') {
			return setTaskCompletedAt(line, completedAt);
		}

		if (beforeTask.checkbox === 'x' && afterTask.checkbox === ' ') {
			return removeTaskCompletionDate(line);
		}

		return line;
	});
}

export function isSingleCheckboxToggle(beforeLines: string[], afterLines: string[]): boolean {
	if (beforeLines.length !== afterLines.length) {
		return false;
	}

	let changedTaskCount = 0;
	for (let index = 0; index < beforeLines.length; index += 1) {
		const beforeLine = beforeLines[index] ?? '';
		const afterLine = afterLines[index] ?? '';
		if (beforeLine === afterLine) {
			continue;
		}

		const beforeTask = parseTaskLine(beforeLine);
		const afterTask = parseTaskLine(afterLine);
		if (
			!beforeTask ||
			!afterTask ||
			beforeTask.checkbox === afterTask.checkbox ||
			normalizeCheckboxForComparison(beforeLine) !== normalizeCheckboxForComparison(afterLine)
		) {
			return false;
		}

		changedTaskCount += 1;
	}

	return changedTaskCount === 1;
}

export function formatArchiveGroupHeading(mode: ArchiveGroupMode, now: Date): string | null {
	if (mode === 'none') {
		return null;
	}

	if (mode === 'day') {
		return `## ${formatDate(now, 'YYYY-MM-DD')}`;
	}

	if (mode === 'month') {
		return `## ${formatDate(now, 'YYYY-MM')}`;
	}

	return `## ${formatIsoWeek(now)}`;
}

export function isPathInScope(
	path: string,
	activeFilePath: string,
	settings: ScopeSettingsLike,
): boolean {
	const normalizedPath = normalizeVaultPath(path);
	if (!normalizedPath.endsWith('.md') || isPathExcluded(normalizedPath, settings.excludedFolderPaths)) {
		return false;
	}

	if (settings.scopeMode === 'vault') {
		return true;
	}

	if (settings.scopeMode === 'current-file') {
		return normalizedPath === normalizeVaultPath(activeFilePath);
	}

	if (settings.scopeMode === 'specified-file') {
		const specifiedFilePath = normalizeVaultPath(settings.specifiedFilePath);
		return specifiedFilePath.length > 0 && isSameMarkdownPath(normalizedPath, specifiedFilePath);
	}

	const specifiedFolderPath = normalizeFolderPath(settings.specifiedFolderPath);
	return specifiedFolderPath.length > 0 && normalizedPath.startsWith(specifiedFolderPath);
}

export function isLineInFencedCodeBlock(lines: string[], lineNumber: number): boolean {
	let inFence = false;

	for (let index = 0; index <= lineNumber && index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		const isFenceLine = fencedCodePattern.test(line);

		if (index === lineNumber) {
			return inFence || isFenceLine;
		}

		if (isFenceLine) {
			inFence = !inFence;
		}
	}

	return false;
}

export function isLineInHtmlComment(lines: string[], lineNumber: number): boolean {
	let inComment = false;

	for (let index = 0; index <= lineNumber && index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		const startsComment = line.includes('<!--');
		const endsComment = line.includes('-->');

		if (index === lineNumber) {
			return inComment || startsComment;
		}

		if (startsComment && !endsComment) {
			inComment = true;
		}

		if (inComment && endsComment) {
			inComment = false;
		}
	}

	return false;
}

export function formatJournalEntry(
	status: TaskStatus,
	taskText: string,
	summary: string,
	now: Date,
	language: 'zh-CN' | 'en' = 'zh-CN',
): string {
	const time = formatDate(now, 'HH:mm');
	if (language === 'en') {
		const label = status === 'completed' ? 'Completed' : 'Partially completed';
		return `- ${time} ${label} “${taskText}”: ${summary.trim()}`.trimEnd();
	}

	const label = status === 'completed' ? '已完成' : '部分完成';
	return `- ${time} ${label}「${taskText}」：${summary.trim()}`;
}

export function appendUnderHeading(content: string, heading: string, entry: string): string {
	const normalizedHeading = heading.trim();
	const normalizedContent = content.replace(/\r\n/g, '\n');

	if (normalizedContent.trim().length === 0) {
		return `${normalizedHeading}\n\n${entry}\n`;
	}

	const lines = normalizedContent.split('\n');
	const headingIndex = lines.findIndex((line) => line.trim() === normalizedHeading);

	if (headingIndex === -1) {
		const base = normalizedContent.endsWith('\n') ? normalizedContent : `${normalizedContent}\n`;
		return `${base}\n${normalizedHeading}\n\n${entry}\n`;
	}

	const headingLevel = getHeadingLevel(normalizedHeading) ?? 6;
	let insertIndex = headingIndex + 1;

	while (insertIndex < lines.length) {
		const currentLevel = getHeadingLevel(lines[insertIndex] ?? '');
		if (currentLevel !== null && currentLevel <= headingLevel) {
			break;
		}
		insertIndex += 1;
	}

	const insertLines = insertIndex < lines.length ? [entry, ''] : [entry];

	lines.splice(insertIndex, 0, ...insertLines);
	return ensureTrailingNewline(lines.join('\n'));
}

export function formatDate(date: Date, format: string): string {
	const values: Record<string, string> = {
		YYYY: String(date.getFullYear()),
		MM: String(date.getMonth() + 1).padStart(2, '0'),
		DD: String(date.getDate()).padStart(2, '0'),
		HH: String(date.getHours()).padStart(2, '0'),
		mm: String(date.getMinutes()).padStart(2, '0'),
	};

	return format.replace(/YYYY|MM|DD|HH|mm/g, (token) => values[token] ?? token);
}

export function formatDailyNotePath(
	pathFormat: string,
	dateFormat: string,
	date: Date,
): string {
	const formattedDate = formatDate(date, dateFormat);
	return formatDate(date, pathFormat).replace(/\{\{date\}\}/g, formattedDate);
}

function getHeadingLevel(line: string): number | null {
	const match = line.trim().match(headingPattern);
	return match?.[1] ? match[1].length : null;
}

function findHeadingSectionRange(lines: string[], heading: string): LineRange | null {
	const normalizedHeading = heading.trim();
	const headingIndex = lines.findIndex((line) => line.trim() === normalizedHeading);
	if (headingIndex === -1) {
		return null;
	}

	const headingLevel = getHeadingLevel(normalizedHeading) ?? 6;
	let end = headingIndex + 1;
	while (end < lines.length) {
		const currentLevel = getHeadingLevel(lines[end] ?? '');
		if (currentLevel !== null && currentLevel <= headingLevel) {
			break;
		}
		end += 1;
	}

	return { start: headingIndex, end };
}

function isRangeInsideRange(range: LineRange, container: LineRange | null): boolean {
	return container !== null && range.start >= container.start && range.end <= container.end;
}

function ensureHeadingExists(content: string, heading: string): string {
	const normalizedContent = content.replace(/\r\n/g, '\n');
	const lines = normalizedContent.split('\n');
	if (lines.some((line) => line.trim() === heading)) {
		return ensureTrailingNewline(normalizedContent);
	}

	if (normalizedContent.trim().length === 0) {
		return `${heading}\n`;
	}

	const base = ensureTrailingNewline(normalizedContent);
	const separator = base.endsWith('\n\n') ? '' : '\n';
	return `${base}${separator}${heading}\n`;
}

function ensureHeadingUnderHeading(content: string, parentHeading: string, childHeading: string): string {
	const normalizedContent = ensureTrailingNewline(content.replace(/\r\n/g, '\n'));
	const lines = normalizedContent.split('\n');
	const parentIndex = lines.findIndex((line) => line.trim() === parentHeading);
	if (parentIndex === -1 || lines.some((line) => line.trim() === childHeading)) {
		return normalizedContent;
	}

	const parentLevel = getHeadingLevel(parentHeading) ?? 6;
	let insertIndex = parentIndex + 1;
	while (insertIndex < lines.length) {
		const currentLevel = getHeadingLevel(lines[insertIndex] ?? '');
		if (currentLevel !== null && currentLevel <= parentLevel) {
			break;
		}
		insertIndex += 1;
	}

	if (insertIndex === lines.length && lines[lines.length - 1] === '') {
		insertIndex -= 1;
	}

	lines.splice(insertIndex, 0, '', childHeading);
	return ensureTrailingNewline(lines.join('\n'));
}

function normalizeNestedHeading(heading: string, parentHeading: string): string {
	const trimmedHeading = heading.trim();
	const headingText = trimmedHeading.replace(/^#{1,6}\s+/, '').trim();
	const parentLevel = getHeadingLevel(parentHeading) ?? 2;
	const childLevel = Math.min(parentLevel + 1, 6);
	return `${'#'.repeat(childLevel)} ${headingText}`;
}

function formatIsoWeek(date: Date): string {
	const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const day = utcDate.getUTCDay() || 7;
	utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
	const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getLineIndent(line: string): number {
	const match = line.match(/^\s*/);
	return countIndentColumns(match?.[0] ?? '');
}

function countIndentColumns(indent: string): number {
	let columns = 0;
	for (const character of indent) {
		columns += character === '\t' ? 4 : 1;
	}
	return columns;
}

function normalizeVaultPath(path: string): string {
	return path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function normalizeFolderPath(path: string): string {
	const normalizedPath = normalizeVaultPath(path);
	if (!normalizedPath) {
		return '';
	}

	return normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`;
}

function isPathExcluded(path: string, excludedFolderPaths: string): boolean {
	return excludedFolderPaths
		.split(/\r?\n/)
		.map(normalizeFolderPath)
		.filter((excludedPath) => excludedPath.length > 0)
		.some((excludedPath) => path.startsWith(excludedPath));
}

function isSameMarkdownPath(path: string, candidatePath: string): boolean {
	if (path === candidatePath) {
		return true;
	}

	if (!candidatePath.endsWith('.md')) {
		const markdownCandidatePath = `${candidatePath}.md`;
		return path === markdownCandidatePath || isSameBasename(path, markdownCandidatePath);
	}

	return isSameBasename(path, candidatePath);
}

function isSameBasename(path: string, candidatePath: string): boolean {
	if (candidatePath.includes('/')) {
		return false;
	}

	return getPathBasename(path) === candidatePath;
}

function getPathBasename(path: string): string {
	return path.split('/').pop() ?? path;
}

function hasIncompleteSiblingAfter(lines: string[], lineNumber: number): boolean {
	const currentIndent = getTaskIndent(lines[lineNumber] ?? '');
	const currentBlock = findTaskBlock(lines, lineNumber);
	const siblingRange = findSiblingTaskListRange(lines, lineNumber);
	if (currentIndent === null || !currentBlock || !siblingRange) {
		return false;
	}

	let index = currentBlock.end;
	while (index < siblingRange.end) {
		const line = lines[index] ?? '';
		const lineIndent = getTaskIndent(line);
		if (lineIndent === currentIndent) {
			if (!isCompletedTask(line)) {
				return true;
			}

			const block = findTaskBlock(lines, index);
			if (!block) {
				return false;
			}

			index = block.end;
			continue;
		}

		index += 1;
	}

	return false;
}

function areLinesEqual(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((line, index) => line === right[index]);
}

function ensureTrailingNewline(value: string): string {
	return value.endsWith('\n') ? value : `${value}\n`;
}

function normalizeCheckboxForComparison(line: string): string {
	return line.replace(/^(\s*[-*+]\s+\[)[ xX](\])/, '$1?$2');
}
