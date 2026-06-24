import { describe, expect, it } from 'vitest';
import {
	getLocalizedDefaultHeadings,
	resolveLanguage,
	TRANSLATIONS,
	type TranslationKey,
} from './i18n';

describe('language resolution', () => {
	it('uses simplified Chinese only for simplified Chinese app locales', () => {
		expect(resolveLanguage('auto', 'zh')).toBe('zh-CN');
		expect(resolveLanguage('auto', 'zh-CN')).toBe('zh-CN');
		expect(resolveLanguage('auto', 'zh-cn')).toBe('zh-CN');
		expect(resolveLanguage('auto', 'zh-TW')).toBe('en');
		expect(resolveLanguage('auto', 'fr')).toBe('en');
	});

	it('honors an explicit language override', () => {
		expect(resolveLanguage('en', 'zh-CN')).toBe('en');
		expect(resolveLanguage('zh-CN', 'en')).toBe('zh-CN');
	});
});

describe('translations', () => {
	it('keeps Chinese and English dictionaries on the same keys', () => {
		const chineseKeys = Object.keys(TRANSLATIONS['zh-CN']).sort();
		const englishKeys = Object.keys(TRANSLATIONS.en).sort();

		expect(englishKeys).toEqual(chineseKeys);
		expect(chineseKeys).toContain('command.recordTaskStatus' satisfies TranslationKey);
		expect(chineseKeys).toContain('settings.language.name' satisfies TranslationKey);
	});

	it('provides localized headings for new installations', () => {
		expect(getLocalizedDefaultHeadings('zh-CN')).toEqual({
			dailyNoteHeading: '## 任务记录',
			archiveHeading: '## 已完成任务归档',
		});
		expect(getLocalizedDefaultHeadings('en')).toEqual({
			dailyNoteHeading: '## Task journal',
			archiveHeading: '## Completed tasks archive',
		});
	});
});
