import { App, PluginSettingTab, Setting } from 'obsidian';
import TaskJournalCheckboxSinkPlugin from './main';
import type { ArchiveGroupMode, ScopeMode, ScopeSettingsLike } from './task';
import type { LanguageSetting } from './i18n';
import { DEFAULT_SETTINGS } from './default-settings';
import { getLocalizedDefaultHeadings } from './i18n';

export type ArchiveTargetMode = 'file' | 'heading';

export interface TaskJournalCheckboxSinkSettings extends ScopeSettingsLike {
	language: LanguageSetting;
	dailyNotePathFormat: string;
	dailyNoteDateFormat: string;
	dailyNoteHeading: string;
	autoOrganizeEnabled: boolean;
	autoOrganizeDelayMs: number;
	archiveTargetMode: ArchiveTargetMode;
	archiveFilePath: string;
	archiveHeading: string;
	archiveGroupMode: ArchiveGroupMode;
}

export { DEFAULT_SETTINGS } from './default-settings';

export class TaskJournalCheckboxSinkSettingTab extends PluginSettingTab {
	plugin: TaskJournalCheckboxSinkPlugin;

	constructor(app: App, plugin: TaskJournalCheckboxSinkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('task-journal-settings');

		new Setting(containerEl)
			.setName(this.plugin.t('settings.language.heading'))
			.setHeading();

		new Setting(containerEl)
			.setName(this.plugin.t('settings.language.name'))
			.setDesc(this.plugin.t('settings.language.description'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('auto', this.plugin.t('settings.language.auto'))
					.addOption('zh-CN', this.plugin.t('settings.language.zhCN'))
					.addOption('en', this.plugin.t('settings.language.en'))
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						await this.plugin.changeLanguage(value as LanguageSetting);
					}),
			);

		const localizedHeadings = getLocalizedDefaultHeadings(this.plugin.getEffectiveLanguage());

		new Setting(containerEl)
			.setName(this.plugin.t('settings.dailyNote.heading'))
			.setHeading();

		new Setting(containerEl)
			.setName(this.plugin.t('settings.dailyNote.path.name'))
			.setDesc(this.plugin.t('settings.dailyNote.path.description'))
			.addText((text) =>
				text
					.setPlaceholder('YYYY-MM-DD.md')
					.setValue(this.plugin.settings.dailyNotePathFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNotePathFormat = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.dailyNote.date.name'))
			.setDesc(this.plugin.t('settings.dailyNote.date.description'))
			.addText((text) =>
				text
					.setPlaceholder('Yyyy-mm-dd')
					.setValue(this.plugin.settings.dailyNoteDateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteDateFormat = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.dailyNote.recordHeading.name'))
			.setDesc(this.plugin.t('settings.dailyNote.recordHeading.description', {
				heading: localizedHeadings.dailyNoteHeading,
			}))
			.addText((text) =>
				text
					.setPlaceholder(localizedHeadings.dailyNoteHeading)
					.setValue(this.plugin.settings.dailyNoteHeading)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteHeading = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.auto.heading'))
			.setHeading();

		new Setting(containerEl)
			.setName(this.plugin.t('settings.auto.enabled.name'))
			.setDesc(this.plugin.t('settings.auto.enabled.description'))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoOrganizeEnabled)
					.onChange(async (value) => {
						this.plugin.settings.autoOrganizeEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.auto.delay.name'))
			.setDesc(this.plugin.t('settings.auto.delay.description'))
			.addText((text) =>
				text
					.setPlaceholder('1000')
					.setValue(String(this.plugin.settings.autoOrganizeDelayMs))
					.onChange(async (value) => {
						const delay = Number.parseInt(value, 10);
						this.plugin.settings.autoOrganizeDelayMs = Number.isFinite(delay) && delay >= 300
							? delay
							: DEFAULT_SETTINGS.autoOrganizeDelayMs;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.scope.heading'))
			.setHeading();

		new Setting(containerEl)
			.setName(this.plugin.t('settings.scope.mode.name'))
			.setDesc(this.plugin.t('settings.scope.mode.description'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('current-file', this.plugin.t('settings.scope.currentFile'))
					.addOption('specified-file', this.plugin.t('settings.scope.specifiedFile'))
					.addOption('folder', this.plugin.t('settings.scope.folder'))
					.addOption('vault', this.plugin.t('settings.scope.vault'))
					.setValue(this.plugin.settings.scopeMode)
					.onChange(async (value) => {
						this.plugin.settings.scopeMode = value as ScopeMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.scope.file.name'))
			.setDesc(this.plugin.t('settings.scope.file.description'))
			.addText((text) =>
				text
					.setPlaceholder('HOME.md')
					.setValue(this.plugin.settings.specifiedFilePath)
					.onChange(async (value) => {
						this.plugin.settings.specifiedFilePath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.scope.folderPath.name'))
			.setDesc(this.plugin.t('settings.scope.folderPath.description'))
			.addText((text) =>
				text
					.setValue(this.plugin.settings.specifiedFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.specifiedFolderPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.scope.excluded.name'))
			.setDesc(this.plugin.t('settings.scope.excluded.description'))
			.addTextArea((text) => {
				text
					.setPlaceholder('Templates/\narchive/')
					.setValue(this.plugin.settings.excludedFolderPaths)
					.onChange(async (value) => {
						this.plugin.settings.excludedFolderPaths = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName(this.plugin.t('settings.archive.heading'))
			.setHeading();

		new Setting(containerEl)
			.setName(this.plugin.t('settings.archive.location.name'))
			.setDesc(this.plugin.t('settings.archive.location.description'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('file', this.plugin.t('settings.archive.location.file'))
					.addOption('heading', this.plugin.t('settings.archive.location.heading'))
					.setValue(this.plugin.settings.archiveTargetMode)
					.onChange(async (value) => {
						this.plugin.settings.archiveTargetMode = value as ArchiveTargetMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.archive.file.name'))
			.setDesc(this.plugin.t('settings.archive.file.description'))
			.addText((text) =>
				text
					.setPlaceholder('Archive/Done Tasks.md')
					.setValue(this.plugin.settings.archiveFilePath)
					.onChange(async (value) => {
						this.plugin.settings.archiveFilePath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.archive.headingName.name'))
			.setDesc(this.plugin.t('settings.archive.headingName.description', {
				heading: localizedHeadings.archiveHeading,
			}))
			.addText((text) =>
				text
					.setPlaceholder(localizedHeadings.archiveHeading)
					.setValue(this.plugin.settings.archiveHeading)
					.onChange(async (value) => {
						this.plugin.settings.archiveHeading = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.plugin.t('settings.archive.group.name'))
			.setDesc(this.plugin.t('settings.archive.group.description'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('day', this.plugin.t('settings.archive.group.day'))
					.addOption('week', this.plugin.t('settings.archive.group.week'))
					.addOption('month', this.plugin.t('settings.archive.group.month'))
					.addOption('none', this.plugin.t('settings.archive.group.none'))
					.setValue(this.plugin.settings.archiveGroupMode)
					.onChange(async (value) => {
						this.plugin.settings.archiveGroupMode = value as ArchiveGroupMode;
						await this.plugin.saveSettings();
					}),
			);
	}
}
