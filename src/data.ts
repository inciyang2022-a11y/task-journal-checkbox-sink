import type { TaskJournalCheckboxSinkSettings } from './settings';
import { isUndoRecord, type UndoRecord } from './undo';

export interface PersistedPluginData {
	settings: TaskJournalCheckboxSinkSettings;
	lastUndoRecord: UndoRecord | null;
}

export function parsePersistedPluginData(value: unknown): {
	settings: Partial<TaskJournalCheckboxSinkSettings>;
	lastUndoRecord: UndoRecord | null;
} {
	if (typeof value !== 'object' || value === null) {
		return { settings: {}, lastUndoRecord: null };
	}

	const data = value as Record<string, unknown>;
	if (typeof data.settings === 'object' && data.settings !== null) {
		return {
			settings: data.settings,
			lastUndoRecord: isUndoRecord(data.lastUndoRecord) ? data.lastUndoRecord : null,
		};
	}

	return {
		settings: data,
		lastUndoRecord: null,
	};
}
