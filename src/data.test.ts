import { describe, expect, it } from 'vitest';
import { parsePersistedPluginData } from './data';
import { createUndoRecord } from './undo';

describe('persisted plugin data migration', () => {
	it('loads legacy flat settings without an undo record', () => {
		const parsed = parsePersistedPluginData({
			dailyNotePathFormat: 'Daily/YYYY-MM-DD.md',
			autoOrganizeEnabled: true,
		});

		expect(parsed.settings).toMatchObject({
			dailyNotePathFormat: 'Daily/YYYY-MM-DD.md',
			autoOrganizeEnabled: true,
		});
		expect(parsed.lastUndoRecord).toBeNull();
	});

	it('loads V6 wrapped settings and a persisted undo record', () => {
		const undoRecord = createUndoRecord(
			'manual-checkbox',
			[{ path: 'Home.md', beforeContent: '- [ ] A', afterContent: '- [x] A' }],
			new Date('2026-06-06T10:00:00.000Z'),
		);
		const parsed = parsePersistedPluginData({
			settings: { dailyNotePathFormat: 'YYYY-MM-DD.md' },
			lastUndoRecord: undoRecord,
		});

		expect(parsed.settings).toMatchObject({ dailyNotePathFormat: 'YYYY-MM-DD.md' });
		expect(parsed.lastUndoRecord).toEqual(undoRecord);
	});

	it('preserves explicit legacy auto-organize and scope choices', () => {
		const parsed = parsePersistedPluginData({
			settings: {
				autoOrganizeEnabled: false,
				scopeMode: 'specified-file',
				specifiedFilePath: 'HOME.md',
			},
			lastUndoRecord: null,
		});

		expect(parsed.settings).toMatchObject({
			autoOrganizeEnabled: false,
			scopeMode: 'specified-file',
			specifiedFilePath: 'HOME.md',
		});
	});
});
