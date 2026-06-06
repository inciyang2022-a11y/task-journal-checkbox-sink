# Changelog

All notable changes to this project are documented here.

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

[1.1.0]: https://github.com/inciyang2022-a11y/task-journal-checkbox-sink/releases/tag/1.1.0
