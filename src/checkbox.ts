import { isSingleCheckboxToggle } from './task';

export interface ManualCheckboxAttempt {
	path: string;
	beforeContent: string;
	completedAt: Date;
}

interface PendingManualCheckboxAttempt extends ManualCheckboxAttempt {
	retryIndex: number;
	timer: number | null;
	evaluating: boolean;
	processing: boolean;
}

export interface ManualCheckboxCoordinatorOptions {
	readCurrentContent: (path: string) => Promise<string | null>;
	commit: (attempt: ManualCheckboxAttempt, nativeChangedContent: string) => Promise<void>;
	onError: (error: unknown) => void;
	retryDelays?: number[];
	setTimer?: (callback: () => void, delay: number) => number;
	clearTimer?: (timer: number) => void;
}

const DEFAULT_RETRY_DELAYS = [0, 40, 100, 200, 350, 550, 800];

export class ManualCheckboxCoordinator {
	private readonly pending = new Map<string, PendingManualCheckboxAttempt>();
	private readonly retryDelays: number[];
	private readonly setTimer: (callback: () => void, delay: number) => number;
	private readonly clearTimer: (timer: number) => void;

	constructor(private readonly options: ManualCheckboxCoordinatorOptions) {
		this.retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS;
		this.setTimer = options.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay));
		this.clearTimer = options.clearTimer ?? ((timer) => window.clearTimeout(timer));
	}

	begin(attempt: ManualCheckboxAttempt): boolean {
		if (this.pending.has(attempt.path)) {
			return false;
		}

		const pending: PendingManualCheckboxAttempt = {
			...attempt,
			retryIndex: 0,
			timer: null,
			evaluating: false,
			processing: false,
		};
		this.pending.set(attempt.path, pending);
		this.scheduleRetry(pending);
		return true;
	}

	has(path: string): boolean {
		return this.pending.has(path);
	}

	observe(path: string, currentContent: string): void {
		const pending = this.pending.get(path);
		if (!pending || pending.processing) {
			return;
		}

		void this.evaluate(pending, currentContent, false);
	}

	cancelExcept(path: string | null): void {
		for (const pendingPath of this.pending.keys()) {
			if (pendingPath !== path) {
				this.cancel(pendingPath);
			}
		}
	}

	cancel(path: string): void {
		const pending = this.pending.get(path);
		if (!pending) {
			return;
		}

		this.clearPendingTimer(pending);
		this.pending.delete(path);
	}

	dispose(): void {
		for (const pending of this.pending.values()) {
			this.clearPendingTimer(pending);
		}
		this.pending.clear();
	}

	private scheduleRetry(pending: PendingManualCheckboxAttempt): void {
		const delay = this.retryDelays[pending.retryIndex];
		if (delay === undefined || this.pending.get(pending.path) !== pending) {
			this.cancel(pending.path);
			return;
		}

		pending.retryIndex += 1;
		pending.timer = this.setTimer(() => {
			pending.timer = null;
			void this.retry(pending);
		}, delay);
	}

	private async retry(pending: PendingManualCheckboxAttempt): Promise<void> {
		if (this.pending.get(pending.path) !== pending || pending.processing) {
			return;
		}

		try {
			const currentContent = await this.options.readCurrentContent(pending.path);
			if (currentContent === null) {
				this.cancel(pending.path);
				return;
			}

			await this.evaluate(pending, currentContent, true);
		} catch (error) {
			this.cancel(pending.path);
			this.options.onError(error);
		}
	}

	private async evaluate(
		pending: PendingManualCheckboxAttempt,
		currentContent: string,
		fromRetry: boolean,
	): Promise<void> {
		if (
			this.pending.get(pending.path) !== pending ||
			pending.evaluating ||
			pending.processing
		) {
			return;
		}

		if (currentContent === pending.beforeContent) {
			if (fromRetry) {
				this.scheduleRetry(pending);
			}
			return;
		}

		const beforeLines = pending.beforeContent.split('\n');
		const afterLines = currentContent.split('\n');
		if (!isSingleCheckboxToggle(beforeLines, afterLines)) {
			this.cancel(pending.path);
			return;
		}

		pending.evaluating = true;
		pending.processing = true;
		this.clearPendingTimer(pending);
		try {
			await this.options.commit(
				{
					path: pending.path,
					beforeContent: pending.beforeContent,
					completedAt: pending.completedAt,
				},
				currentContent,
			);
		} catch (error) {
			this.options.onError(error);
		} finally {
			if (this.pending.get(pending.path) === pending) {
				this.pending.delete(pending.path);
			}
		}
	}

	private clearPendingTimer(pending: PendingManualCheckboxAttempt): void {
		if (pending.timer !== null) {
			this.clearTimer(pending.timer);
			pending.timer = null;
		}
	}
}
