# 第一次发布插件：一步一步操作

> 本文保留 `1.1.0` 首次发布流程作为历史参考。当前待发布版本为 `1.2.0`；
> 标签、manifest、package 和 `versions.json` 必须统一为 `1.2.0`。

这份说明针对第一次使用 GitHub 发布 Obsidian 插件的作者。正式版本是 `1.1.0`，Release 标签也必须写成 `1.1.0`，不要写 `v1.1.0`。

## 你将完成什么

1. 创建自己的公开 GitHub 仓库。
2. 将本地插件上传到 GitHub。
3. 等待自动检查通过。
4. 创建 `1.1.0` Release。
5. 用 Release 文件测试安装。
6. 提交到 Obsidian Community Plugins。

## 第一阶段：发布前检查

在 PowerShell 中进入插件文件夹：

```powershell
cd "E:\06 project\OB Checklist\task-journal-checkbox-sink"
```

依次运行：

```powershell
npm ci
npm run lint
npm test
npm run build
npm run check:release
```

成功标志：

- lint 没有 error。
- 所有测试通过。
- build 没有报错。
- 最后一行显示 `Release metadata is consistent for 1.1.0.`
- 插件目录中出现新的 `main.js`。

不要把 `node_modules` 或 `main.js` 提交到 GitHub。`main.js` 只作为 Release 附件发布。

## 第二阶段：创建空白 GitHub 仓库

1. 登录 [GitHub](https://github.com/)。
2. 右上角选择 **+ → New repository**。
3. **Owner** 选择 `inciyang2022-a11y`。
4. **Repository name** 输入 `task-journal-checkbox-sink`。
5. **Description** 输入：
   `Manage centralized Obsidian task lists with status journals, automatic sinking, archiving, and undo.`
6. 选择 **Public**。
7. 不要勾选 README、`.gitignore` 或 License。这里必须创建空白仓库。
8. 选择 **Create repository**。

成功标志：浏览器打开以下地址，并显示空仓库的初始化提示：

`https://github.com/inciyang2022-a11y/task-journal-checkbox-sink`

## 第三阶段：上传本地项目

建议让 Codex 执行本地 Git 命令，以避免输错。目标状态如下：

- 默认分支为 `main`。
- `origin` 指向你的仓库。
- `upstream` 指向官方 sample plugin，仅用于参考。
- GitHub 上只有一次干净的项目首次提交，不包含 sample plugin 的历史。
- 本地旧 `master` 分支仍保留，不会删除。

推送完成后刷新 GitHub 页面。成功标志：

- 能看到 `README.md`、`LICENSE`、`CHANGELOG.md`、`PUBLISHING.md`、`src/` 等文件。
- README 正常显示。
- **Actions** 页面开始运行检查。

## 第四阶段：检查 GitHub Actions

1. 打开仓库顶部的 **Actions**。
2. 选择最新的 `Node.js build`。
3. 等待所有任务变成绿色。

如果失败，打开第一个红色步骤，将完整错误文字或截图发给 Codex，不要随机修改文件。

## 第五阶段：创建 1.1.0 Release

推荐让 Codex 创建并推送标签 `1.1.0`。标签推送后，GitHub Actions 会自动创建草稿 Release。

1. 打开仓库右侧 **Releases**。
2. 打开标题为 `1.1.0` 的 Draft。
3. 确认附件包含 `main.js`、`manifest.json`、`styles.css`。
4. 选择 **Edit**，粘贴以下说明：

```markdown
## Task Journal Checkbox Sink 1.1.0

First public release.

- Record completed and partial task outcomes in Daily Notes.
- Sink completed tasks within their current sibling list.
- Archive task blocks by their actual completion date.
- Undo the latest status, checkbox, or archive operation.
- Optimized for desktop, Android, and iOS.

中文说明请查看 README。
```

5. 选择 **Publish release**。

成功标志：Release 不再显示 Draft，三个附件都能下载。

## 第六阶段：用 Release 文件重新测试

1. 建立一个空白测试 Vault。
2. 创建 `.obsidian/plugins/task-journal-checkbox-sink/`。
3. 从 GitHub Release 下载三个附件并放入该文件夹。
4. 重启 Obsidian 并启用插件。
5. 至少验证：
   - 记录“已完成”和“部分完成”
   - 手动勾选与取消 checkbox
   - 归档与撤销
   - 重启后撤销
   - 手机端总结框不会自动弹出键盘

## 第七阶段：提交 Obsidian 官方目录

1. 打开 [Obsidian Community](https://community.obsidian.md/)。
2. 使用 Obsidian 账号登录，并在个人资料中关联 GitHub。
3. 左侧选择 **Plugins → New plugin**。
4. 输入：
   `https://github.com/inciyang2022-a11y/task-journal-checkbox-sink`
5. 阅读并同意开发者政策，确认愿意继续维护插件。
6. 选择 **Submit**。

官方会读取默认分支 HEAD 的 `manifest.json`，并下载与版本 `1.1.0` 同名 Release 中的附件。

如果审核要求修改，不要删除旧 Release。修复后使用新版本号，例如 `1.1.1`，并将完整审核提示发给 Codex。

## 第八阶段：设置仓库信息

在 GitHub 仓库首页右侧 **About → Edit**：

- Description：
  `Manage centralized Obsidian task lists with status journals, automatic sinking, archiving, and undo.`
- Topics：
  - `obsidian-plugin`
  - `task-management`
  - `daily-notes`
  - `mobile`
  - `typescript`

在 **Settings → General → Features** 确认 Issues 已开启。

## 后续版本编号

- 修复 bug 或小调整：`1.1.1`、`1.1.2`
- 增加向后兼容的新功能：`1.2.0`
- 出现不兼容的大改：`2.0.0`

每次发布都要更新 `CHANGELOG.md`，同步 manifest/package 版本，运行完整检查，并创建与 manifest 完全一致且没有 `v` 前缀的标签。

## 常见错误

### Release 找不到 main.js

检查 GitHub Actions 是否成功。不要把 `main.js` 提交到仓库来绕过构建失败。

### Obsidian 提示找不到版本

确认 `manifest.json`、Git 标签和 GitHub Release 标签都是 `1.1.0`。

### 插件安装后不出现

确认插件目录名是 `task-journal-checkbox-sink`，三个文件直接位于该目录中，没有多套一层文件夹。

### 审核要求修改代码

复制完整审核信息并创建 GitHub Issue，或直接发给 Codex。不要只发最后一行错误。
