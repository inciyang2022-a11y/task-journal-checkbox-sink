export const PARTIAL_TASK_CLASS = 'task-journal-partial-item';

export function updatePartialTaskClasses(container: ParentNode): void {
	const taskItems = container.querySelectorAll('li');
	for (const taskItem of Array.from(taskItems)) {
		taskItem.classList.toggle(
			PARTIAL_TASK_CLASS,
			hasDirectPartialTaskChildren(taskItem),
		);
	}
}

function hasDirectPartialTaskChildren(taskItem: Element): boolean {
	let foundCheckbox = false;

	for (const child of Array.from(taskItem.children)) {
		if (child.matches('input.task-list-item-checkbox')) {
			foundCheckbox = true;
			continue;
		}

		if (foundCheckbox && child.matches('a.tag[href="#partial"]')) {
			return true;
		}
	}

	return false;
}
