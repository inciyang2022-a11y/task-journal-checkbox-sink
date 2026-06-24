import type { TaskJournalCheckboxSinkSettings } from './settings';
import { getLocalizedDefaultHeadings, type SupportedLanguage } from './i18n';

export function createDefaultSettings(
	language: SupportedLanguage,
): TaskJournalCheckboxSinkSettings {
	const headings = getLocalizedDefaultHeadings(language);
	return {
		language: 'auto',
		dailyNotePathFormat: 'YYYY-MM-DD.md',
		dailyNoteDateFormat: 'YYYY-MM-DD',
		dailyNoteHeading: headings.dailyNoteHeading,
		autoOrganizeEnabled: true,
		autoOrganizeDelayMs: 1000,
		scopeMode: 'vault',
		specifiedFilePath: '',
		specifiedFolderPath: '',
		excludedFolderPaths: 'Templates/\nArchive/',
		archiveTargetMode: 'file',
		archiveFilePath: 'Archive/Done Tasks.md',
		archiveHeading: headings.archiveHeading,
		archiveGroupMode: 'day',
	};
}

export function mergeSettingsWithDefaults(
	savedSettings: Partial<TaskJournalCheckboxSinkSettings>,
	language: SupportedLanguage,
): TaskJournalCheckboxSinkSettings {
	return Object.assign(createDefaultSettings(language), savedSettings);
}

export const DEFAULT_SETTINGS = createDefaultSettings('zh-CN');
