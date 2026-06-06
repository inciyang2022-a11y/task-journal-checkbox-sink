import { Decoration, MatchDecorator, ViewPlugin, ViewUpdate } from '@codemirror/view';

const completionDateMatcher = new MatchDecorator({
	regexp: /\s*%%task-journal-completed:\d{4}-\d{2}-\d{2}%%/g,
	decoration: Decoration.replace({}),
});

export const hideCompletionDateExtension = ViewPlugin.fromClass(
	class {
		decorations;

		constructor(view: ViewUpdate['view']) {
			this.decorations = completionDateMatcher.createDeco(view);
		}

		update(update: ViewUpdate): void {
			this.decorations = completionDateMatcher.updateDeco(update, this.decorations);
		}
	},
	{
		decorations: (plugin) => plugin.decorations,
	},
);
