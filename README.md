# Task Journal Checkbox Sink

[中文](#中文说明) | [English](#english)

An Obsidian plugin for managing tasks on a central page, recording task outcomes in Daily Notes, sinking completed tasks, archiving them by completion date, and undoing the latest task operation.

- Desktop, Android, and iOS
- Local and offline
- No account, network request, telemetry, advertising, or payment
- Minimum Obsidian version: `1.6.6`

## 中文说明

### 功能

Task Journal Checkbox Sink 适合把任务集中放在一个页面中管理，例如 `Home-Mobile.md`。

- **记录任务状态**：在光标所在任务行选择“已完成”或“部分完成”，填写可选总结，并写入当天 Daily Note。
- **已完成任务沉底**：只移动到当前缩进层级的同级任务列表末尾；子任务和附属内容会随任务块整体移动。
- **部分完成**：保留未勾选状态并添加 `#partial`，任务文字显示为与已完成任务一致的灰度，但不沉底。
- **手动 checkbox 支持**：直接点击 Obsidian checkbox 时记录完成日期，可按设置自动沉底。
- **归档已完成任务**：归档到指定文件或当前页面标题，并按真实完成日期进行日、周、月分组。
- **撤销上一次任务操作**：撤销最近一次状态记录、手动 checkbox 或归档操作，重启 Obsidian 后仍有效。
- **手机端优化**：支持 Android 和 iOS 的触控、软键盘、窄屏弹窗和设置页面。

### 安装

插件通过 Obsidian 官方审核后：

1. 打开 **设置 → 第三方插件**。
2. 关闭安全模式（如果尚未关闭）。
3. 选择 **浏览**，搜索 `Task Journal Checkbox Sink`。
4. 选择 **安装**，然后选择 **启用**。

审核通过前可手动安装：

1. 从 [GitHub Releases](https://github.com/inciyang2022-a11y/task-journal-checkbox-sink/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 在你的 Vault 中创建：
   `.obsidian/plugins/task-journal-checkbox-sink/`
3. 将三个文件放入该文件夹。
4. 重启 Obsidian，在 **设置 → 第三方插件** 中启用插件。

### 快速开始

1. 打开插件设置，填写 Daily Note 路径和记录标题。
2. 如果需要自动沉底，开启“启用自动整理”，并设置作用范围。该功能默认关闭。
3. 把光标放在标准 Markdown 任务行上，例如 `- [ ] 完成报告`。
4. 从命令面板、Commander 或手机工具栏运行 **记录任务状态**。
5. 选择状态并填写总结。总结可以留空。

### 命令

| 命令 | 作用 |
| --- | --- |
| 记录任务状态 | 更新当前任务、写入 Daily Note，并在已完成时沉底 |
| 归档已完成任务 | 归档当前活动 Markdown 文件中的已完成任务 |
| 撤销上一次任务操作 | 撤销最近一次插件任务操作 |

### 默认设置

- Daily Note 路径：`YYYY-MM-DD.md`
- 日期格式：`YYYY-MM-DD`
- 记录标题：`## 任务记录`
- 自动整理：关闭
- 整理延迟：`1000ms`
- 作用范围：指定文件（路径默认为空，不会自动修改任何文件）
- 排除文件夹：`Templates/`、`Archive/`
- 归档文件：`Archive/Done Tasks.md`
- 归档标题：`## 已完成任务归档`
- 归档分组：按天

### 安全规则

- 不处理 fenced code block 或 HTML 注释中的任务。
- 不跨标题或父任务移动任务。
- 移动任务时保留完整任务块。
- 自动整理默认关闭，不扫描全库。
- 撤销前检查相关文件是否在操作后被再次修改；有冲突时整次撤销会拒绝执行。
- 完成日期保存在隐藏 Markdown 注释中：
  `%%task-journal-completed:YYYY-MM-DD%%`

### 隐私声明

插件完全在本地运行，只读写当前 Vault 中完成任务操作所需的 Markdown 文件和插件设置。插件不联网、不收集遥测、不投放广告、不要求账户，也不会访问 Vault 外部文件。

### 反馈问题

请前往 [GitHub Issues](https://github.com/inciyang2022-a11y/task-journal-checkbox-sink/issues)。

提交 Markdown 示例前，请删除姓名、日记、项目名称或其他私人内容。最好提供可以复现问题的最小文本。

## English

### Features

- Record a task as completed or partially completed and append an optional summary to today's Daily Note.
- Move completed task blocks to the end of their current sibling list without crossing headings or parents.
- Mark partial tasks with `#partial`, using a muted style without moving them.
- Track native checkbox clicks and optionally organize completed tasks.
- Archive completed task blocks by their actual completion date.
- Undo the latest status, checkbox, or archive operation, including after an Obsidian restart.
- Use the plugin on desktop, Android, and iOS.

### Install

After the plugin is accepted into the Community Plugins directory:

1. Open **Settings → Community plugins**.
2. Select **Browse** and search for `Task Journal Checkbox Sink`.
3. Select **Install**, then **Enable**.

For manual installation before approval:

1. Download `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/inciyang2022-a11y/task-journal-checkbox-sink/releases).
2. Place them in:
   `.obsidian/plugins/task-journal-checkbox-sink/`
3. Restart Obsidian and enable the plugin.

### Quick start

1. Configure the Daily Note path and heading in the plugin settings.
2. To enable automatic sinking, turn on auto-organize and select a scope. It is disabled by default.
3. Put the cursor on a Markdown task such as `- [ ] Finish report`.
4. Run **记录任务状态** from the command palette, Commander, or a mobile toolbar.
5. Select a status and enter an optional summary.

The current in-app interface is Chinese. English UI localization is planned for a future release.

### Privacy and safety

The plugin runs locally and offline. It only accesses Markdown files required by the requested task operation and its own settings. It does not use network services, telemetry, advertising, accounts, payments, or files outside the vault.

### Support

Open a [GitHub issue](https://github.com/inciyang2022-a11y/task-journal-checkbox-sink/issues). Remove personal information from all example notes and provide the smallest Markdown sample that reproduces the issue.

## Development

```bash
npm install
npm run lint
npm test
npm run build
npm run check:release
```

Release assets are `main.js`, `manifest.json`, and `styles.css`. The GitHub release tag must exactly match the version in `manifest.json` and must not start with `v`.

See [PUBLISHING.md](PUBLISHING.md) for the beginner-friendly release guide and [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)
