import { describe, expect, it } from 'vitest';
import {
	PARTIAL_TASK_CLASS,
	updatePartialTaskClasses,
} from './reading-view';

class FakeClassList {
	private values = new Set<string>();

	toggle(name: string, force?: boolean): boolean {
		const shouldAdd = force ?? !this.values.has(name);
		if (shouldAdd) {
			this.values.add(name);
		} else {
			this.values.delete(name);
		}
		return shouldAdd;
	}

	has(name: string): boolean {
		return this.values.has(name);
	}
}

function fakeChild(selectors: string[]): Element {
	return {
		matches: (selector: string) => selectors.includes(selector),
	} as Element;
}

function fakeListItem(children: Element[]): Element & { classList: FakeClassList } {
	return {
		children,
		classList: new FakeClassList(),
	} as unknown as Element & { classList: FakeClassList };
}

function fakeContainer(items: Element[]): ParentNode {
	return {
		querySelectorAll: () => items,
	} as unknown as ParentNode;
}

describe('reading view partial task classes', () => {
	it('marks only a task with a direct checkbox followed by a direct partial tag', () => {
		const partial = fakeListItem([
			fakeChild(['input.task-list-item-checkbox']),
			fakeChild(['a.tag[href="#partial"]']),
		]);
		const childOnlyPartial = fakeListItem([
			fakeChild(['input.task-list-item-checkbox']),
			fakeChild([]),
		]);

		updatePartialTaskClasses(fakeContainer([partial, childOnlyPartial]));

		expect(partial.classList.has(PARTIAL_TASK_CLASS)).toBe(true);
		expect(childOnlyPartial.classList.has(PARTIAL_TASK_CLASS)).toBe(false);
	});

	it('removes a stale class when a repeated render no longer contains the tag', () => {
		const item = fakeListItem([
			fakeChild(['input.task-list-item-checkbox']),
			fakeChild(['a.tag[href="#partial"]']),
		]);
		const container = fakeContainer([item]);
		updatePartialTaskClasses(container);

		(item.children as unknown as Element[]).splice(1, 1);
		updatePartialTaskClasses(container);

		expect(item.classList.has(PARTIAL_TASK_CLASS)).toBe(false);
	});
});
