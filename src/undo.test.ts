import { describe, expect, it } from 'vitest';
import {
	applyReversePatch,
	createReversePatch,
	createUndoRecord,
	hashContent,
	isUndoRecord,
} from './undo';

describe('reverse patches', () => {
	it('restores a changed task block without storing unchanged text', () => {
		const before = '# Today\n\n- [ ] A\n- [ ] B\n';
		const after = '# Today\n\n- [ ] A\n- [x] B %%task-journal-completed:2026-06-06%%\n';
		const patch = createReversePatch(before, after);

		expect(applyReversePatch(after, patch)).toBe(before);
		expect(patch.removedText.length).toBeLessThan(before.length);
	});

	it('rejects a patch when its range is outside the current content', () => {
		const patch = createReversePatch('- [ ] A', '- [x] A');

		expect(applyReversePatch('', patch)).toBeNull();
	});
});

describe('undo records', () => {
	it('stores modified and created files with after hashes', () => {
		const record = createUndoRecord(
			'status-record',
			[
				{ path: 'Home.md', beforeContent: '- [ ] A', afterContent: '- [x] A' },
				{ path: '2026-06-06.md', beforeContent: null, afterContent: '## 任务记录\n' },
			],
			new Date('2026-06-06T10:00:00.000Z'),
		);

		expect(record.files[0]).toMatchObject({
			path: 'Home.md',
			created: false,
			afterHash: hashContent('- [x] A'),
		});
		expect(record.files[1]).toMatchObject({
			path: '2026-06-06.md',
			created: true,
			reversePatch: null,
		});
		expect(isUndoRecord(record)).toBe(true);
	});

	it('rejects malformed persisted data', () => {
		expect(isUndoRecord({ version: 1, operation: 'unknown', files: [] })).toBe(false);
	});

	it('survives JSON persistence across plugin restarts', () => {
		const record = createUndoRecord(
			'archive',
			[{ path: 'Home.md', beforeContent: '- [x] A', afterContent: '' }],
			new Date('2026-06-06T10:00:00.000Z'),
		);
		const restored = JSON.parse(JSON.stringify(record)) as unknown;

		expect(isUndoRecord(restored)).toBe(true);
	});
});

describe('V6 operation restoration', () => {
	it.each([
		{
			name: 'completed task with moved children and completion dates',
			before: '- [ ] A\n  - [ ] A1\n- [ ] B',
			after:
				'- [ ] B\n- [x] A %%task-journal-completed:2026-06-06%%\n  - [x] A1 %%task-journal-completed:2026-06-06%%',
		},
		{
			name: 'partial task status',
			before: '- [ ] A',
			after: '- [ ] A #partial',
		},
		{
			name: 'manual checkbox completion and sinking',
			before: '- [ ] A\n- [ ] B',
			after: '- [ ] B\n- [x] A %%task-journal-completed:2026-06-06%%',
		},
		{
			name: 'archive source removal',
			before: '- [ ] B\n- [x] A %%task-journal-completed:2026-06-05%%',
			after: '- [ ] B',
		},
	])('restores $name', ({ before, after }) => {
		const patch = createReversePatch(before, after);

		expect(applyReversePatch(after, patch)).toBe(before);
	});
});
