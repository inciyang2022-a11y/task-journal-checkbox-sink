# Changelog

All notable changes to this project are documented here.

## [1.2.0] - 2026-06-24

### Added

- Added complete Simplified Chinese and English localization for commands, settings, dialogs, notices, errors, and generated Daily Note entries.
- Added an `auto` / Simplified Chinese / English language setting. Automatic mode follows Obsidian and falls back to English for non-Simplified-Chinese locales.
- Added a desktop `list-checks` ribbon button for recording the current task status.
- Added localized default Daily Note and archive headings for new installations.

### Changed

- New installations now enable auto-organize and use the entire vault as the default scope. Existing saved choices remain unchanged.
- Updated scope examples to use `HOME.md` and removed the folder-path placeholder.
- Improved the English README and added bilingual product screenshots.

### Performance

- Replaced three reading-view `:has()` selectors with a container-scoped Markdown post processor and a plugin-specific task class.

### Compatibility

- Kept the minimum supported Obsidian version at `1.6.6` by detecting the newer language API at runtime and using a safe document-language fallback.

## [1.1.1] - 2026-06-10

### Fixed

- Removed prohibited global ESLint directive comments.
- Updated mixed Chinese/English UI copy to pass Obsidian's sentence-case review rule without suppressions.

## [1.1.0] - 2026-06-06

### Added

- Record completed and partial task outcomes in Daily Notes.
- Sink completed task blocks within the current sibling list.
- Optional delayed auto-organize with file, folder, vault, and exclusion scopes.
- Archive completed tasks by their actual completion day, week, or month.
- Persisted single-step undo for status, checkbox, and archive operations.
- Android and iOS checkbox coordination and mobile modal layouts.
- Hidden completion-date metadata for accurate archive grouping.

### Changed

- Partial tasks now use the theme's completed-task gray while preserving the `#partial` tag style.
- Mobile summary dialogs wait for the user to tap the input before showing the keyboard.
- Background file updates use `Vault.process`.
- Created files are removed during undo with `FileManager.trashFile`.

### Safety

- Skip tasks inside fenced code blocks and HTML comments.
- Refuse an undo when any associated file has changed.
- Roll back multi-file operations after write failures.

[1.2.0]: https://github.com/inciyang2022-a11y/task-journal-checkbox-sink/releases/tag/1.2.0
[1.1.1]: https://github.com/inciyang2022-a11y/task-journal-checkbox-sink/releases/tag/1.1.1
[1.1.0]: https://github.com/inciyang2022-a11y/task-journal-checkbox-sink/releases/tag/1.1.0
