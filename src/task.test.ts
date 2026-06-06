import { describe, expect, it } from 'vitest';
import {
	appendUnderHeading,
	appendArchiveEntries,
	appendCompletedTaskBlocks,
	collectCompletedTaskBlocks,
	extractTaskText,
	formatArchiveGroupHeading,
	findSiblingTaskListRange,
	findTaskBlock,
	formatJournalEntry,
	formatDailyNotePath,
	getTaskCompletionDate,
	getTaskIndent,
	isCompletedTask,
	isLineInFencedCodeBlock,
	isLineInHtmlComment,
	isPathInScope,
	isSingleCheckboxToggle,
	moveTaskBlockToSiblingEnd,
	organizeCompletedTasks,
	parseTaskLine,
	removeLineRanges,
	setTaskBlockCompleted,
	setTaskCompleted,
	setTaskCompletedAt,
	setTaskPartial,
	synchronizeCheckboxCompletionDates,
} from './task';

describe('parseTaskLine', () => {
	it('parses unchecked tasks', () => {
		expect(parseTaskLine('- [ ] 学习 CODEX')).toEqual({
			indent: '',
			marker: '-',
			checkbox: ' ',
			text: '学习 CODEX',
		});
	});

	it('parses checked tasks with indentation and alternate markers', () => {
		expect(parseTaskLine('  * [x] 子任务')).toEqual({
			indent: '  ',
			marker: '*',
			checkbox: 'x',
			text: '子任务',
		});
		expect(parseTaskLine('+ [X] 大写完成')).toMatchObject({ checkbox: 'x' });
	});

	it('rejects non-task lines', () => {
		expect(parseTaskLine('- 普通列表')).toBeNull();
		expect(parseTaskLine('正文')).toBeNull();
	});
});

describe('task state updates', () => {
	it('marks only the checkbox as completed', () => {
		expect(setTaskCompleted('  - [ ] 写插件 #partial')).toBe('  - [x] 写插件 #partial');
	});

	it('stores and reads a hidden completion date', () => {
		const date = new Date(2026, 5, 5, 14, 35);
		const line = setTaskCompletedAt('- [ ] 写插件', date);

		expect(line).toBe('- [x] 写插件 %%task-journal-completed:2026-06-05%%');
		expect(getTaskCompletionDate(line)).toEqual(new Date(2026, 5, 5));
	});

	it('adds partial tag once', () => {
		expect(setTaskPartial('- [ ] 写插件')).toBe('- [ ] 写插件 #partial');
		expect(setTaskPartial('- [ ] 写插件 #partial')).toBe('- [ ] 写插件 #partial');
	});

	it('does not turn completed tasks into partial tasks', () => {
		expect(setTaskPartial('- [x] 写插件')).toBe('- [x] 写插件');
	});
});

describe('task block movement', () => {
	it('gets task indentation and completion state', () => {
		expect(getTaskIndent('  - [ ] 子任务')).toBe(2);
		expect(getTaskIndent('普通文本')).toBeNull();
		expect(isCompletedTask('- [x] 完成')).toBe(true);
		expect(isCompletedTask('- [ ] 未完成')).toBe(false);
	});

	it('finds a task block with child tasks and attached content', () => {
		const lines = [
			'- [ ] A',
			'- [x] B',
			'  - [ ] B1',
			'    附属说明',
			'- [ ] C',
		];

		expect(findTaskBlock(lines, 1)).toEqual({ start: 1, end: 4 });
	});

	it('finds the current same-level task list range', () => {
		const lines = [
			'# 今日',
			'- [ ] A',
			'- [x] B',
			'  - [ ] B1',
			'- [ ] C',
			'## 其他',
			'- [ ] D',
		];

		expect(findSiblingTaskListRange(lines, 2)).toEqual({ start: 1, end: 5 });
	});

	it('moves a completed top-level task to the same-level end', () => {
		const lines = ['- [ ] A', '- [x] B', '- [ ] C'];

		expect(moveTaskBlockToSiblingEnd(lines, 1)).toEqual(['- [ ] A', '- [ ] C', '- [x] B']);
	});

	it('moves a completed child task only within its parent', () => {
		const lines = ['- [ ] A', '  - [ ] A1', '  - [x] A2', '  - [ ] A3', '- [ ] B'];

		expect(moveTaskBlockToSiblingEnd(lines, 2)).toEqual([
			'- [ ] A',
			'  - [ ] A1',
			'  - [ ] A3',
			'  - [x] A2',
			'- [ ] B',
		]);
	});

	it('moves a whole task block with children and attached content', () => {
		const lines = [
			'- [ ] A',
			'- [x] B',
			'  - [ ] B1',
			'    附属说明',
			'- [ ] C',
		];

		expect(moveTaskBlockToSiblingEnd(lines, 1)).toEqual([
			'- [ ] A',
			'- [ ] C',
			'- [x] B',
			'  - [ ] B1',
			'    附属说明',
		]);
	});

	it('does not reorder a task that is already at the same-level end', () => {
		const lines = ['- [ ] A', '- [ ] B', '- [x] C'];

		expect(moveTaskBlockToSiblingEnd(lines, 2)).toEqual(lines);
	});

	it('does not move tasks across headings', () => {
		const lines = ['# 今日', '- [x] A', '## 其他', '- [ ] B'];

		expect(moveTaskBlockToSiblingEnd(lines, 1)).toEqual(lines);
	});

	it('does not move child tasks across parent boundaries', () => {
		const lines = ['- [ ] A', '  - [x] A1', '- [ ] B', '  - [ ] B1'];

		expect(moveTaskBlockToSiblingEnd(lines, 1)).toEqual(lines);
	});

	it('keeps partial task updates as a single-line change', () => {
		const lines = ['- [ ] A', '- [ ] B', '- [ ] C'];
		const updatedLines = [...lines];
		updatedLines[1] = setTaskPartial(updatedLines[1] ?? '');

		expect(updatedLines).toEqual(['- [ ] A', '- [ ] B #partial', '- [ ] C']);
	});

	it('marks a parent task block and all nested tasks as completed', () => {
		const lines = [
			'- [ ] A',
			'  - [ ] A1',
			'    - [ ] A1a',
			'    附属说明',
			'- [ ] B',
		];

		expect(setTaskBlockCompleted(lines, 0)).toEqual([
			'- [x] A',
			'  - [x] A1',
			'    - [x] A1a',
			'    附属说明',
			'- [ ] B',
		]);
	});

	it('marks only the selected child task block as completed', () => {
		const lines = [
			'- [ ] A',
			'  - [ ] A1',
			'    - [ ] A1a',
			'  - [ ] A2',
			'- [ ] B',
		];

		expect(setTaskBlockCompleted(lines, 1)).toEqual([
			'- [ ] A',
			'  - [x] A1',
			'    - [x] A1a',
			'  - [ ] A2',
			'- [ ] B',
		]);
	});

	it('marks a task block completed before moving it to the same-level end', () => {
		const lines = [
			'- [ ] A',
			'- [ ] B',
			'  - [ ] B1',
			'- [ ] C',
		];

		expect(moveTaskBlockToSiblingEnd(setTaskBlockCompleted(lines, 1), 1)).toEqual([
			'- [ ] A',
			'- [ ] C',
			'- [x] B',
			'  - [x] B1',
		]);
	});
});

describe('extractTaskText', () => {
	it('removes checkbox syntax and trailing partial tag', () => {
		expect(extractTaskText('- [ ] 歌词写作 #partial')).toBe('歌词写作');
	});

	it('removes hidden completion metadata', () => {
		expect(
			extractTaskText('- [x] 歌词写作 %%task-journal-completed:2026-06-05%%'),
		).toBe('歌词写作');
	});
});

describe('manual checkbox completion dates', () => {
	const date = new Date(2026, 5, 5, 14, 35);

	it('adds a date only to a task that changed to completed', () => {
		expect(
			synchronizeCheckboxCompletionDates(
				['- [ ] A', '- [x] old'],
				['- [x] A', '- [x] old'],
				date,
			),
		).toEqual([
			'- [x] A %%task-journal-completed:2026-06-05%%',
			'- [x] old',
		]);
	});

	it('removes the stored date when a task is unchecked', () => {
		expect(
			synchronizeCheckboxCompletionDates(
				['- [x] A %%task-journal-completed:2026-06-04%%'],
				['- [ ] A %%task-journal-completed:2026-06-04%%'],
				date,
			),
		).toEqual(['- [ ] A']);
	});

	it('accepts only one checkbox toggle without unrelated edits', () => {
		expect(isSingleCheckboxToggle(['- [ ] A', '- [ ] B'], ['- [x] A', '- [ ] B'])).toBe(true);
		expect(isSingleCheckboxToggle(['- [ ] A'], ['- [x] changed'])).toBe(false);
		expect(isSingleCheckboxToggle(['- [ ] A', '- [ ] B'], ['- [x] A', '- [x] B'])).toBe(false);
	});
});

describe('safe line checks', () => {
	it('detects fenced code blocks', () => {
		const lines = ['```markdown', '- [ ] code task', '```', '- [ ] real task'];
		expect(isLineInFencedCodeBlock(lines, 1)).toBe(true);
		expect(isLineInFencedCodeBlock(lines, 3)).toBe(false);
	});

	it('detects html comments', () => {
		const lines = ['<!--', '- [ ] hidden task', '-->', '- [ ] real task'];
		expect(isLineInHtmlComment(lines, 1)).toBe(true);
		expect(isLineInHtmlComment(lines, 3)).toBe(false);
	});
});

describe('path scope checks', () => {
	const baseSettings = {
		scopeMode: 'specified-file' as const,
		specifiedFilePath: '',
		specifiedFolderPath: '',
		excludedFolderPaths: 'Templates/\nArchive/',
	};

	it('does not process files when the default specified file path is empty', () => {
		expect(isPathInScope('Home-Mobile.md', 'Home-Mobile.md', baseSettings)).toBe(false);
	});

	it('matches only the active file in current-file mode', () => {
		expect(
			isPathInScope('Home-Mobile.md', 'Home-Mobile.md', {
				...baseSettings,
				scopeMode: 'current-file',
			}),
		).toBe(true);
		expect(
			isPathInScope('Other.md', 'Home-Mobile.md', {
				...baseSettings,
				scopeMode: 'current-file',
			}),
		).toBe(false);
	});

	it('matches an explicitly specified file', () => {
		expect(
			isPathInScope('Home-Mobile.md', '', {
				...baseSettings,
				specifiedFilePath: 'Home-Mobile.md',
			}),
		).toBe(true);
	});

	it('matches a specified file name when the note is inside a folder', () => {
		expect(
			isPathInScope('00 Home/Home-Mobile.md', '', {
				...baseSettings,
				specifiedFilePath: 'Home-Mobile',
			}),
		).toBe(true);
		expect(
			isPathInScope('00 Home/Home-Mobile.md', '', {
				...baseSettings,
				specifiedFilePath: 'Home-Mobile.md',
			}),
		).toBe(true);
	});

	it('matches markdown files under the specified folder', () => {
		expect(
			isPathInScope('00 Home/Home-Mobile.md', '', {
				...baseSettings,
				scopeMode: 'folder',
				specifiedFolderPath: '00 Home/',
			}),
		).toBe(true);
		expect(
			isPathInScope('01 Projects/Plan.md', '', {
				...baseSettings,
				scopeMode: 'folder',
				specifiedFolderPath: '00 Home/',
			}),
		).toBe(false);
	});

	it('matches vault markdown files unless excluded', () => {
		expect(
			isPathInScope('Notes/A.md', '', {
				...baseSettings,
				scopeMode: 'vault',
			}),
		).toBe(true);
		expect(
			isPathInScope('Templates/A.md', '', {
				...baseSettings,
				scopeMode: 'vault',
			}),
		).toBe(false);
	});

	it('rejects non-markdown files', () => {
		expect(
			isPathInScope('Home-Mobile.canvas', 'Home-Mobile.canvas', {
				...baseSettings,
				scopeMode: 'current-file',
			}),
		).toBe(false);
	});
});

describe('auto organize completed tasks', () => {
	it('moves multiple top-level completed tasks to the end while preserving order', () => {
		const lines = ['- [x] A', '- [ ] B', '- [x] C', '- [ ] D'];

		expect(organizeCompletedTasks(lines)).toEqual(['- [ ] B', '- [ ] D', '- [x] A', '- [x] C']);
	});

	it('moves completed child tasks only within the parent task', () => {
		const lines = ['- [ ] A', '  - [x] A1', '  - [ ] A2', '- [ ] B'];

		expect(organizeCompletedTasks(lines)).toEqual(['- [ ] A', '  - [ ] A2', '  - [x] A1', '- [ ] B']);
	});

	it('moves completed task blocks with attached content intact', () => {
		const lines = ['- [x] A', '  - [ ] A1', '    附属说明', '- [ ] B'];

		expect(organizeCompletedTasks(lines)).toEqual(['- [ ] B', '- [x] A', '  - [x] A1', '    附属说明']);
	});

	it('marks nested tasks completed when a parent was manually checked', () => {
		const lines = ['- [x] A', '  - [ ] A1', '    - [ ] A1a'];

		expect(organizeCompletedTasks(lines)).toEqual(['- [x] A', '  - [x] A1', '    - [x] A1a']);
	});

	it('marks nested tasks completed before moving a parent block', () => {
		const lines = ['- [x] A', '  - [ ] A1', '- [ ] B'];

		expect(organizeCompletedTasks(lines)).toEqual(['- [ ] B', '- [x] A', '  - [x] A1']);
	});

	it('does not move tasks across headings', () => {
		const lines = ['# 今日', '- [x] A', '## 其他', '- [ ] B'];

		expect(organizeCompletedTasks(lines)).toEqual(lines);
	});

	it('does not process tasks inside fenced code blocks or html comments', () => {
		const lines = [
			'```markdown',
			'- [x] code task',
			'- [ ] code open',
			'```',
			'<!--',
			'- [x] hidden',
			'- [ ] visible-looking',
			'-->',
			'- [x] A',
			'- [ ] B',
		];

		expect(organizeCompletedTasks(lines)).toEqual([
			'```markdown',
			'- [x] code task',
			'- [ ] code open',
			'```',
			'<!--',
			'- [x] hidden',
			'- [ ] visible-looking',
			'-->',
			'- [ ] B',
			'- [x] A',
		]);
	});

	it('does not move unfinished partial tasks', () => {
		const lines = ['- [ ] A #partial', '- [x] B', '- [ ] C'];

		expect(organizeCompletedTasks(lines)).toEqual(['- [ ] A #partial', '- [ ] C', '- [x] B']);
	});
});

describe('archive completed tasks', () => {
	it('collects top-level completed tasks and removes them from source lines', () => {
		const lines = ['- [ ] A', '- [x] B', '- [ ] C', '- [x] D'];

		expect(collectCompletedTaskBlocks(lines)).toEqual({
			entries: [
				{ content: '- [x] B', completedAt: null },
				{ content: '- [x] D', completedAt: null },
			],
			ranges: [
				{ start: 1, end: 2 },
				{ start: 3, end: 4 },
			],
			remainingLines: ['- [ ] A', '- [ ] C'],
		});
	});

	it('collects completed task blocks with children and attached content', () => {
		const lines = ['- [x] A', '  - [ ] A1', '    附属说明', '- [ ] B'];

		expect(collectCompletedTaskBlocks(lines)).toMatchObject({
			entries: [{ content: '- [x] A\n  - [ ] A1\n    附属说明', completedAt: null }],
			remainingLines: ['- [ ] B'],
		});
	});

	it('does not collect unfinished partial tasks', () => {
		const lines = ['- [ ] A #partial', '- [x] B'];

		expect(collectCompletedTaskBlocks(lines).entries).toEqual([
			{ content: '- [x] B', completedAt: null },
		]);
	});

	it('does not collect tasks inside fenced code blocks or html comments', () => {
		const lines = [
			'```markdown',
			'- [x] code task',
			'```',
			'<!--',
			'- [x] hidden task',
			'-->',
			'- [x] real task',
		];

		expect(collectCompletedTaskBlocks(lines)).toMatchObject({
			entries: [{ content: '- [x] real task', completedAt: null }],
			remainingLines: [
				'```markdown',
				'- [x] code task',
				'```',
				'<!--',
				'- [x] hidden task',
				'-->',
			],
		});
	});

	it('removes line ranges without changing other line order', () => {
		expect(removeLineRanges(['A', 'B', 'C', 'D'], [{ start: 1, end: 3 }])).toEqual(['A', 'D']);
	});

	it('skips completed tasks inside an existing archive heading', () => {
		const lines = [
			'- [x] A',
			'## 已完成任务归档',
			'### 2026-06-05',
			'- [x] old',
		];

		expect(collectCompletedTaskBlocks(lines, '## 已完成任务归档')).toMatchObject({
			entries: [{ content: '- [x] A', completedAt: null }],
			remainingLines: [
				'## 已完成任务归档',
				'### 2026-06-05',
				'- [x] old',
			],
		});
	});

	it('collects each task block with its own completion date', () => {
		const lines = [
			'- [x] A %%task-journal-completed:2026-06-03%%',
			'- [x] B %%task-journal-completed:2026-06-05%%',
		];

		expect(collectCompletedTaskBlocks(lines).entries).toEqual([
			{
				content: '- [x] A %%task-journal-completed:2026-06-03%%',
				completedAt: new Date(2026, 5, 3),
			},
			{
				content: '- [x] B %%task-journal-completed:2026-06-05%%',
				completedAt: new Date(2026, 5, 5),
			},
		]);
	});

	it('creates archive heading and nested day group before appending entries', () => {
		const content = '# Home\n';

		expect(
			appendArchiveEntries(content, '## 已完成任务归档', '## 2026-06-05', ['- [x] A']),
		).toBe('# Home\n\n## 已完成任务归档\n\n### 2026-06-05\n\n- [x] A\n');
	});

	it('appends archive entries without a group when grouping is disabled', () => {
		expect(
			appendArchiveEntries('## 已完成任务归档\n', '## 已完成任务归档', null, ['- [x] A']),
		).toBe('## 已完成任务归档\n\n- [x] A\n');
	});

	it('formats archive group headings for day, week, month, and none', () => {
		const date = new Date(2026, 5, 5, 14, 35);

		expect(formatArchiveGroupHeading('day', date)).toBe('## 2026-06-05');
		expect(formatArchiveGroupHeading('week', date)).toBe('## 2026-W23');
		expect(formatArchiveGroupHeading('month', date)).toBe('## 2026-06');
		expect(formatArchiveGroupHeading('none', date)).toBeNull();
	});

	it('archives tasks under their individual completion dates', () => {
		const result = appendCompletedTaskBlocks(
			'',
			'## 已完成任务归档',
			'day',
			[
				{ content: '- [x] A', completedAt: new Date(2026, 5, 3) },
				{ content: '- [x] B', completedAt: new Date(2026, 5, 5) },
				{ content: '- [x] legacy', completedAt: null },
			],
			new Date(2026, 5, 6),
		);

		expect(result.missingCompletionDateCount).toBe(1);
		expect(result.content).toContain('### 2026-06-03\n\n- [x] A');
		expect(result.content).toContain('### 2026-06-05\n\n- [x] B');
		expect(result.content).toContain('### 2026-06-06\n\n- [x] legacy');
	});
});

describe('journal entries', () => {
	it('formats completed entries with fixed time', () => {
		const date = new Date(2026, 5, 5, 14, 35);
		expect(formatJournalEntry('completed', '学习 CODEX 和 Claude', '完成了基本配置', date)).toBe(
			'- 14:35 已完成「学习 CODEX 和 Claude」：完成了基本配置',
		);
	});

	it('formats daily note paths with direct tokens and date placeholder', () => {
		const date = new Date(2026, 5, 5, 14, 35);
		expect(formatDailyNotePath('00 Journal/Daily/YYYY-MM-DD.md', 'YYYY-MM-DD', date)).toBe(
			'00 Journal/Daily/2026-06-05.md',
		);
		expect(formatDailyNotePath('00 Journal/Daily/{{date}}.md', 'YYYY.MM.DD', date)).toBe(
			'00 Journal/Daily/2026.06.05.md',
		);
	});

	it('appends to empty content', () => {
		expect(appendUnderHeading('', '## 任务记录', '- 14:35 已完成「A」：')).toBe(
			'## 任务记录\n\n- 14:35 已完成「A」：\n',
		);
	});

	it('creates missing heading', () => {
		expect(appendUnderHeading('# Daily\n', '## 任务记录', '- 14:35 已完成「A」：')).toBe(
			'# Daily\n\n## 任务记录\n\n- 14:35 已完成「A」：\n',
		);
	});

	it('appends under existing heading before the next same-level heading', () => {
		const content = '# Daily\n\n## 任务记录\n\n- old\n\n## Other\n';
		expect(appendUnderHeading(content, '## 任务记录', '- new')).toBe(
			'# Daily\n\n## 任务记录\n\n- old\n\n- new\n\n## Other\n',
		);
	});
});
