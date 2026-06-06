import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ManualCheckboxAttempt,
	ManualCheckboxCoordinator,
} from './checkbox';

const attempt: ManualCheckboxAttempt = {
	path: 'Home.md',
	beforeContent: '- [ ] A',
	completedAt: new Date(2026, 5, 6),
};
const nodeTimers = {
	setTimer: (callback: () => void, delay: number) =>
		// Vitest runs this pure coordinator without a browser window.
		// eslint-disable-next-line obsidianmd/prefer-window-timers
		setTimeout(callback, delay) as unknown as number,
	// eslint-disable-next-line obsidianmd/prefer-window-timers
	clearTimer: (timer: number) => clearTimeout(timer),
};

afterEach(() => {
	vi.useRealTimers();
});

describe('mobile checkbox coordination', () => {
	it('waits for a delayed native checkbox update', async () => {
		vi.useFakeTimers();
		let currentContent = attempt.beforeContent;
		const commit = vi.fn();
		const coordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async () => currentContent,
			commit,
			onError: vi.fn(),
			...nodeTimers,
		});

		coordinator.begin(attempt);
		await vi.advanceTimersByTimeAsync(140);
		expect(commit).not.toHaveBeenCalled();

		currentContent = '- [x] A';
		await vi.advanceTimersByTimeAsync(200);
		expect(commit).toHaveBeenCalledOnce();
		expect(commit).toHaveBeenCalledWith(attempt, '- [x] A');
	});

	it('commits duplicate editor and vault signals only once', async () => {
		let releaseCommit: (() => void) | undefined;
		const commit = vi.fn(() => new Promise<void>((resolve) => {
			releaseCommit = resolve;
		}));
		const coordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async () => '- [x] A',
			commit,
			onError: vi.fn(),
			retryDelays: [1000],
			setTimer: () => 1,
			clearTimer: vi.fn(),
		});

		coordinator.begin(attempt);
		coordinator.observe(attempt.path, '- [x] A');
		coordinator.observe(attempt.path, '- [x] A');
		await Promise.resolve();

		expect(commit).toHaveBeenCalledOnce();
		releaseCommit?.();
		await Promise.resolve();
	});

	it('accepts an unchecked native toggle', async () => {
		const uncheckedAttempt = {
			...attempt,
			beforeContent: '- [x] A %%task-journal-completed:2026-06-05%%',
		};
		const commit = vi.fn();
		const coordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async () => '- [ ] A %%task-journal-completed:2026-06-05%%',
			commit,
			onError: vi.fn(),
			retryDelays: [1000],
			setTimer: () => 1,
			clearTimer: vi.fn(),
		});

		coordinator.begin(uncheckedAttempt);
		coordinator.observe(uncheckedAttempt.path, '- [ ] A %%task-journal-completed:2026-06-05%%');
		await Promise.resolve();

		expect(commit).toHaveBeenCalledOnce();
	});

	it('cancels when unrelated editing is mixed with the checkbox change', async () => {
		const commit = vi.fn();
		const coordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async () => '- [x] changed',
			commit,
			onError: vi.fn(),
			retryDelays: [1000],
			setTimer: () => 1,
			clearTimer: vi.fn(),
		});

		coordinator.begin(attempt);
		coordinator.observe(attempt.path, '- [x] changed');
		await Promise.resolve();

		expect(commit).not.toHaveBeenCalled();
		expect(coordinator.has(attempt.path)).toBe(false);
	});

	it('times out without modifying content when no native change arrives', async () => {
		vi.useFakeTimers();
		const commit = vi.fn();
		const coordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async () => attempt.beforeContent,
			commit,
			onError: vi.fn(),
			retryDelays: [0, 10, 20],
			...nodeTimers,
		});

		coordinator.begin(attempt);
		await vi.runAllTimersAsync();

		expect(commit).not.toHaveBeenCalled();
		expect(coordinator.has(attempt.path)).toBe(false);
	});

	it('cancels when the active file changes during retries', async () => {
		vi.useFakeTimers();
		const commit = vi.fn();
		const coordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async () => null,
			commit,
			onError: vi.fn(),
			retryDelays: [0],
			...nodeTimers,
		});

		coordinator.begin(attempt);
		await vi.runAllTimersAsync();

		expect(commit).not.toHaveBeenCalled();
		expect(coordinator.has(attempt.path)).toBe(false);
	});

	it('ignores a duplicate click while the same file is pending', () => {
		const coordinator = new ManualCheckboxCoordinator({
			readCurrentContent: async () => attempt.beforeContent,
			commit: vi.fn(),
			onError: vi.fn(),
			retryDelays: [1000],
			setTimer: () => 1,
			clearTimer: vi.fn(),
		});

		expect(coordinator.begin(attempt)).toBe(true);
		expect(coordinator.begin(attempt)).toBe(false);
	});

	it('clears pending retries when disposed', async () => {
		vi.useFakeTimers();
		const readCurrentContent = vi.fn(async () => attempt.beforeContent);
		const coordinator = new ManualCheckboxCoordinator({
			readCurrentContent,
			commit: vi.fn(),
			onError: vi.fn(),
			retryDelays: [100],
			...nodeTimers,
		});

		coordinator.begin(attempt);
		coordinator.dispose();
		await vi.runAllTimersAsync();

		expect(readCurrentContent).not.toHaveBeenCalled();
		expect(coordinator.has(attempt.path)).toBe(false);
	});
});
