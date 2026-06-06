export type UndoOperationType = 'status-record' | 'manual-checkbox' | 'archive';

export interface ReversePatch {
	start: number;
	insertedLength: number;
	removedText: string;
}

export interface UndoFileChange {
	path: string;
	created: boolean;
	afterHash: string;
	reversePatch: ReversePatch | null;
}

export interface UndoRecord {
	version: 1;
	operation: UndoOperationType;
	createdAt: string;
	files: UndoFileChange[];
}

export interface PlannedFileChange {
	path: string;
	beforeContent: string | null;
	afterContent: string;
}

export function createUndoRecord(
	operation: UndoOperationType,
	changes: PlannedFileChange[],
	createdAt: Date,
): UndoRecord {
	return {
		version: 1,
		operation,
		createdAt: createdAt.toISOString(),
		files: changes.map((change) => ({
			path: change.path,
			created: change.beforeContent === null,
			afterHash: hashContent(change.afterContent),
			reversePatch:
				change.beforeContent === null
					? null
					: createReversePatch(change.beforeContent, change.afterContent),
		})),
	};
}

export function createReversePatch(beforeContent: string, afterContent: string): ReversePatch {
	let start = 0;
	const maximumPrefixLength = Math.min(beforeContent.length, afterContent.length);
	while (
		start < maximumPrefixLength &&
		beforeContent.charCodeAt(start) === afterContent.charCodeAt(start)
	) {
		start += 1;
	}

	let beforeEnd = beforeContent.length;
	let afterEnd = afterContent.length;
	while (
		beforeEnd > start &&
		afterEnd > start &&
		beforeContent.charCodeAt(beforeEnd - 1) === afterContent.charCodeAt(afterEnd - 1)
	) {
		beforeEnd -= 1;
		afterEnd -= 1;
	}

	return {
		start,
		insertedLength: afterEnd - start,
		removedText: beforeContent.slice(start, beforeEnd),
	};
}

export function applyReversePatch(content: string, patch: ReversePatch): string | null {
	const insertedEnd = patch.start + patch.insertedLength;
	if (patch.start < 0 || patch.insertedLength < 0 || insertedEnd > content.length) {
		return null;
	}

	return `${content.slice(0, patch.start)}${patch.removedText}${content.slice(insertedEnd)}`;
}

export function hashContent(content: string): string {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;

	for (let index = 0; index < content.length; index += 1) {
		const code = content.charCodeAt(index);
		first ^= code;
		first = Math.imul(first, 0x01000193);
		second ^= code + index;
		second = Math.imul(second, 0x85ebca6b);
	}

	return `${content.length.toString(16)}-${(first >>> 0).toString(16).padStart(8, '0')}-${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function isUndoRecord(value: unknown): value is UndoRecord {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.files)) {
		return false;
	}

	if (
		value.operation !== 'status-record' &&
		value.operation !== 'manual-checkbox' &&
		value.operation !== 'archive'
	) {
		return false;
	}

	return value.files.every((file) => {
		if (
			!isRecord(file) ||
			typeof file.path !== 'string' ||
			typeof file.created !== 'boolean' ||
			typeof file.afterHash !== 'string'
		) {
			return false;
		}

		return file.reversePatch === null || isReversePatch(file.reversePatch);
	});
}

function isReversePatch(value: unknown): value is ReversePatch {
	return (
		isRecord(value) &&
		typeof value.start === 'number' &&
		typeof value.insertedLength === 'number' &&
		typeof value.removedText === 'string'
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
