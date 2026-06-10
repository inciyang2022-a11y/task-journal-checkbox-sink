import { App, PluginSettingTab, Setting } from 'obsidian';
import TaskJournalCheckboxSinkPlugin from './main';
import type { ArchiveGroupMode, ScopeMode, ScopeSettingsLike } from './task';

export type ArchiveTargetMode = 'file' | 'heading';

export interface TaskJournalCheckboxSinkSettings extends ScopeSettingsLike {
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

export const DEFAULT_SETTINGS: TaskJournalCheckboxSinkSettings = {
	dailyNotePathFormat: 'YYYY-MM-DD.md',
	dailyNoteDateFormat: 'YYYY-MM-DD',
	dailyNoteHeading: '## 任务记录',
	autoOrganizeEnabled: false,
	autoOrganizeDelayMs: 1000,
	scopeMode: 'specified-file',
	specifiedFilePath: '',
	specifiedFolderPath: '',
	excludedFolderPaths: 'Templates/\nArchive/',
	archiveTargetMode: 'file',
	archiveFilePath: 'Archive/Done Tasks.md',
	archiveHeading: '## 已完成任务归档',
	archiveGroupMode: 'day',
};

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
			.setName('Daily note 设置')
			.setHeading();

		new Setting(containerEl)
			.setName('Daily note 路径格式')
			.setDesc('支持 YYYY、MM、DD 或 {{date}}。默认：YYYY-MM-DD.md')
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
			.setName('日期格式')
			.setDesc('用于路径格式中的 {{date}}。V1 支持 YYYY、MM、DD。默认：YYYY-MM-DD')
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
			.setName('Daily note 记录标题')
			.setDesc('记录会追加到这个标题下。默认：## 任务记录')
			.addText((text) =>
				text
					.setPlaceholder('## 任务记录')
					.setValue(this.plugin.settings.dailyNoteHeading)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteHeading = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('自动整理设置')
			.setHeading();

		new Setting(containerEl)
			.setName('启用自动整理')
			.setDesc('默认关闭。开启后会在编辑停止一小段时间后整理当前 Markdown 文件。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoOrganizeEnabled)
					.onChange(async (value) => {
						this.plugin.settings.autoOrganizeEnabled = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('整理延迟时间')
			.setDesc('编辑停止后等待多少毫秒再整理。默认：1000ms')
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
			.setName('作用范围设置')
			.setHeading();

		new Setting(containerEl)
			.setName('作用范围')
			.setDesc('默认是指定文件，但路径留空时不会处理任何文件。')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('current-file', '仅当前文件')
					.addOption('specified-file', '仅指定文件')
					.addOption('folder', '指定文件夹')
					.addOption('vault', '全库')
					.setValue(this.plugin.settings.scopeMode)
					.onChange(async (value) => {
						this.plugin.settings.scopeMode = value as ScopeMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('指定文件路径')
			.setDesc('例如：home-mobile.md。留空时，指定文件模式不会处理任何文件。')
			.addText((text) =>
				text
					.setPlaceholder('Home-Mobile.md')
					.setValue(this.plugin.settings.specifiedFilePath)
					.onChange(async (value) => {
						this.plugin.settings.specifiedFilePath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('指定文件夹路径')
			.setDesc('例如：00 home/。留空时，指定文件夹模式不会处理任何文件。')
			.addText((text) =>
				text
					.setPlaceholder('00 Home/')
					.setValue(this.plugin.settings.specifiedFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.specifiedFolderPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('排除文件夹')
			.setDesc('每行一个文件夹路径。排除规则优先于作用范围。')
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
			.setName('归档设置')
			.setHeading();

		new Setting(containerEl)
			.setName('归档位置')
			.setDesc('归档命令只处理当前文件；这里决定已完成任务移动到哪里。')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('file', '指定文件')
					.addOption('heading', '当前页指定标题')
					.setValue(this.plugin.settings.archiveTargetMode)
					.onChange(async (value) => {
						this.plugin.settings.archiveTargetMode = value as ArchiveTargetMode;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('归档文件路径')
			.setDesc('归档位置为指定文件时使用。默认：Archive/Done Tasks.md')
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
			.setName('归档标题')
			.setDesc('归档内容会追加到这个标题下。默认：## 已完成任务归档')
			.addText((text) =>
				text
					.setPlaceholder('## 已完成任务归档')
					.setValue(this.plugin.settings.archiveHeading)
					.onChange(async (value) => {
						this.plugin.settings.archiveHeading = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('归档分组')
			.setDesc('默认按天分组，也可以改为按周、按月或不分组。')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('day', '按天')
					.addOption('week', '按周')
					.addOption('month', '按月')
					.addOption('none', '不分组')
					.setValue(this.plugin.settings.archiveGroupMode)
					.onChange(async (value) => {
						this.plugin.settings.archiveGroupMode = value as ArchiveGroupMode;
						await this.plugin.saveSettings();
					}),
			);
	}
}
