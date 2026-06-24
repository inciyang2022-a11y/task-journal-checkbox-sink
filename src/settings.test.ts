import { describe, expect, it } from 'vitest';
import { createDefaultSettings, mergeSettingsWithDefaults } from './default-settings';

describe('default settings', () => {
	it('enables vault-wide auto-organize for new installations', () => {
		const settings = createDefaultSettings('en');

		expect(settings.autoOrganizeEnabled).toBe(true);
		expect(settings.scopeMode).toBe('vault');
		expect(settings.language).toBe('auto');
	});

	it('uses localized headings for new installations', () => {
		expect(createDefaultSettings('en')).toMatchObject({
			dailyNoteHeading: '## Task journal',
			archiveHeading: '## Completed tasks archive',
		});
		expect(createDefaultSettings('zh-CN')).toMatchObject({
			dailyNoteHeading: '## 任务记录',
			archiveHeading: '## 已完成任务归档',
		});
	});

	it('keeps saved values while filling missing fields from localized defaults', () => {
		const settings = mergeSettingsWithDefaults(
			{
				autoOrganizeEnabled: false,
				scopeMode: 'specified-file',
				dailyNoteHeading: '## My existing journal',
				archiveHeading: '## My existing archive',
			},
			'en',
		);

		expect(settings).toMatchObject({
			language: 'auto',
			autoOrganizeEnabled: false,
			scopeMode: 'specified-file',
			dailyNoteHeading: '## My existing journal',
			archiveHeading: '## My existing archive',
		});
	});
});
