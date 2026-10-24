import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  catalogs, createErrorTranslator, createTranslator, I18nProvider, isLanguagePreference,
  LANGUAGE_STORAGE_KEY, LANGUAGE_STORAGE_WARNING, readBrowserLocale, readLanguagePreference,
  resolveLocale, saveLanguagePreference, subscribeBrowserLanguage, SUPPORTED_LANGUAGES,
  useI18n, useLanguage, type I18nValue, type LanguagePreference, type LanguageStorage, type Locale,
} from '../src/ui/i18n';
import { DirectoryError, parseText, validateName } from '../src/core';

const locales = SUPPORTED_LANGUAGES.map(language => language.value);
const keys = Object.keys(catalogs.en);
const placeholders = (value: string) => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match => match[1]).sort();
afterEach(() => vi.unstubAllGlobals());

describe('complete runtime language catalogs', () => {
  it('uses optional empty-comment hints without changing populated comment messages', () => {
    expect(createTranslator('en')('Add comment')).toBe('Optional comment');
    expect(createTranslator('zh-CN')('Add comment')).toBe('可添加注释');
    expect(createTranslator('zh-TW')('Add comment')).toBe('可新增註解');
    for (const locale of locales) {
      expect(Object.keys(catalogs[locale]).sort()).toEqual([...keys].sort());
      expect(createTranslator(locale)('Add comment')).not.toBe('Add comment');
      expect(createTranslator(locale)('Edit comment for {name}', { name: 'Existing folder' })).toContain('Existing folder');
    }
  });

  it('offers the twelve requested locales with native display names', () => {
    expect(locales).toEqual(['en', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt-BR', 'ja', 'ko', 'ar', 'hi', 'ru']);
    expect(new Set(SUPPORTED_LANGUAGES.map(language => language.label)).size).toBe(12);
    expect(keys.length).toBeGreaterThan(250);
  });
  it.each(locales)('%s contains every English key, without missing or extra interpolation values', locale => {
    expect(Object.keys(catalogs[locale]).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const value = catalogs[locale][key];
      expect(typeof value, key).toBe('string');
      expect(value.trim(), key).not.toBe('');
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
    if (locale !== 'en') expect(keys.filter(key => catalogs[locale][key] !== key).length).toBeGreaterThan(keys.length * 0.94);
  });
  it.each(locales)('%s preserves folder names, file syntax, technical format tokens, and the brand', locale => {
    const t = createTranslator(locale);
    const name = '資料-Folder_<b>name</b> {count} $&';
    expect(t('Expand {name}', { name })).toContain(name);
    expect(t('Move {name} and everything inside it.', { name })).toContain(name);
    expect(t('FolderSeed menu')).toContain('FolderSeed');
    for (const character of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) expect(t('Use a name, not a path. Avoid / \\ : * ? " < > |')).toContain(character);
    for (const token of ['ASCII', 'Unicode', 'Markdown', 'JSON', 'ZIP', 'SVG', 'PNG', 'UTF-8']) {
      for (const key of keys.filter(key => key.includes(token))) expect(t(key), key).toContain(token);
    }
  });
  it.each(locales)('%s translates both sibling directions and the no-sibling fallback', locale => {
    const t = createTranslator(locale);
    for (const key of ['Move into next sibling', 'Move inside the next sibling folder', 'Moved into the next sibling.', 'This folder has no sibling to move into.']) {
      expect(Object.hasOwn(catalogs[locale], key), key).toBe(true);
      expect(t(key), key).toBe(catalogs[locale][key]);
      expect(createErrorTranslator(locale)(key), key).toBe(catalogs[locale][key]);
      if (locale !== 'en') expect(t(key), key).not.toBe(key);
    }
    expect(t('Move into next sibling')).not.toBe(t('Move into previous sibling'));
    expect(t('Moved into the next sibling.')).not.toBe(t('Moved into the previous sibling.'));
    expect(t('This folder has no sibling to move into.')).not.toBe(t('This folder has no preceding sibling to move into.'));
  });
  it.each(locales)('%s translates comment controls and validation without changing inserted names', locale => {
    const t = createTranslator(locale);
    const name = 'User folder {count} $&';
    expect(t('Edit comment for {name}', { name })).toContain(name);
    for (const key of ['Add comment', 'Folder comment', 'Save comment', 'Cancel comment', 'Comment saved.', 'Editing folder comment…', 'Comments stay separate from folder names.', 'Use // after a folder name for a single-line comment.', 'Folder comments must be text.', 'Folder comments cannot exceed 500 characters.', 'Folder comments must be one line without control characters or invalid Unicode.', 'Folder comments together cannot exceed 256 KB.', 'Unsupported project version. Please use a version: 1 or version: 2 document.']) {
      expect(Object.hasOwn(catalogs[locale], key), key).toBe(true);
      expect(createErrorTranslator(locale)(key), key).toBe(catalogs[locale][key]);
      if (locale !== 'en') expect(t(key), key).not.toBe(key);
    }
    expect(t('Use // after a folder name for a single-line comment.')).toContain('//');
  });
  it.each(locales)('%s translates template-binding warnings and schema validation', locale => {
    const t = createTranslator(locale);
    for (const key of ['Text formats are localized snapshots.', 'Changing text content makes template comments custom.', 'Comments from older projects stay as saved.', 'Template comment bindings need a valid source, key, and nonempty fallback comment.', 'Unsupported project version. Please use a version: 1, version: 2, or version: 3 document.']) {
      expect(Object.hasOwn(catalogs[locale], key), key).toBe(true);
      expect(createErrorTranslator(locale)(key), key).toBe(catalogs[locale][key]);
      if (locale !== 'en') expect(t(key), key).not.toBe(key);
    }
  });
  it('falls back to unknown English source phrases without exposing object prototype values', () => {
    const t = createTranslator('fr');
    expect(t('Future feature {count}', { count: 2 })).toBe('Future feature 2');
    expect(t('__proto__')).toBe('__proto__');
    expect(t('constructor')).toBe('constructor');
    expect(t('toString')).toBe('toString');
    expect(t('Expand {name}')).toContain('{name}');
    expect(t('Expand {name}', Object.create({ name: 'inherited' }) as Record<string, string>)).toContain('{name}');
  });
});

describe('browser locale negotiation', () => {
  it.each([
    [[], 'en'], [['zz-ZZ'], 'en'], [['en-GB'], 'en'], [['es-419'], 'es'], [['FR-ca'], 'fr'], [['de-AT'], 'de'],
    [['pt-PT'], 'pt-BR'], [['pt-BR'], 'pt-BR'], [['ja-JP'], 'ja'], [['ko-KR'], 'ko'], [['ar-EG'], 'ar'], [['hi-IN'], 'hi'], [['ru-RU'], 'ru'],
    [['zh'], 'zh-CN'], [['zh-CN'], 'zh-CN'], [['zh-SG'], 'zh-CN'], [['zh-TW'], 'zh-TW'], [['zh-HK'], 'zh-TW'], [['zh-MO'], 'zh-TW'],
    [['zh-Hant'], 'zh-TW'], [['zh-Hans-HK'], 'zh-CN'], [['zh-Hant-CN'], 'zh-TW'], [['zh_TW'], 'zh-TW'],
    [['xx', 'ja-JP', 'en-US'], 'ja'], [['fr-FR', 'de-DE'], 'fr'], [['', 'not a tag', 'DE'], 'de'],
    [['fr-FR-u-nu-latn'], 'fr'], [['zh-x-hant'], 'zh-CN'], [['zh-Hant-TW-u-ca-chinese'], 'zh-TW'],
  ] as [string[], Locale][])('resolves %j to %s', (languages, expected) => expect(resolveLocale(languages)).toBe(expected));
  it('prefers navigator.languages and safely handles a missing or restricted browser API', () => {
    expect(readBrowserLocale({ languages: ['es-MX', 'en'], language: 'de' })).toBe('es');
    expect(readBrowserLocale({ languages: [], language: 'ja' })).toBe('ja');
    expect(readBrowserLocale({ get languages(): readonly string[] { throw new Error('Blocked'); }, language: 'en' })).toBe('en');
    vi.stubGlobal('navigator', undefined);
    expect(readBrowserLocale()).toBe('en');
  });
  it('observes live browser changes, removes its own listener, and ignores late events', () => {
    const addEventListener = vi.fn(); const removeEventListener = vi.fn(); const changed = vi.fn();
    const stop = subscribeBrowserLanguage(changed, { addEventListener, removeEventListener });
    const [event, listener] = addEventListener.mock.calls[0];
    expect(event).toBe('languagechange');
    listener(); expect(changed).toHaveBeenCalledTimes(1);
    stop(); stop(); listener();
    expect(removeEventListener).toHaveBeenCalledExactlyOnceWith('languagechange', listener);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('does not throw when language event APIs are absent or restricted', () => {
    vi.stubGlobal('window', undefined);
    expect(() => subscribeBrowserLanguage(() => {})()).not.toThrow();
    const blocked = () => { throw new Error('Blocked'); };
    expect(() => subscribeBrowserLanguage(() => {}, { addEventListener: blocked, removeEventListener: blocked })()).not.toThrow();
  });
});

describe('independent language preference storage', () => {
  const preferences: LanguagePreference[] = ['auto', ...locales];
  it.each(preferences)('reads and saves %s under only the specified key', preference => {
    const storage = { getItem: vi.fn(() => preference), setItem: vi.fn() };
    expect(isLanguagePreference(preference)).toBe(true);
    expect(readLanguagePreference(LANGUAGE_STORAGE_KEY, () => storage)).toEqual({ preference, storageError: '' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(saveLanguagePreference(preference, 'custom:language', () => storage)).toBe('');
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('custom:language', preference);
  });
  it.each([null, undefined, '', 'system', 'zh', 'en-US', 'FR', '"fr"', ' fr ', false, 1])('falls back to Automatic for invalid stored value %j without overwriting it', value => {
    const storage = { getItem: vi.fn(() => value), setItem: vi.fn() } as unknown as LanguageStorage;
    expect(readLanguagePreference('language', () => storage)).toEqual({ preference: 'auto', storageError: '' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(isLanguagePreference(value)).toBe(false);
  });
  it('never reads storage with persistence disabled', () => {
    const storage = vi.fn(() => { throw new Error('Must not access'); });
    expect(readLanguagePreference(false, storage)).toEqual({ preference: 'auto', storageError: '' });
    expect(saveLanguagePreference('ar', false, storage)).toBe('');
    expect(storage).not.toHaveBeenCalled();
  });
  it('keeps independent editor keys, themes, and document drafts untouched', () => {
    const values = new Map([['draft', 'raw unchanged'], ['theme', 'dark'], ['one', 'fr'], ['two', 'ja']]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readLanguagePreference('one', () => storage).preference).toBe('fr');
    expect(readLanguagePreference('two', () => storage).preference).toBe('ja');
    saveLanguagePreference('ar', 'one', () => storage);
    expect([...values]).toEqual([['draft', 'raw unchanged'], ['theme', 'dark'], ['one', 'ar'], ['two', 'ja']]);
  });
  it('reports blocked access, read/write errors, and missing storage without crashing', () => {
    const blocked = () => { throw new Error('Blocked'); };
    const storage = { getItem: blocked, setItem: blocked };
    expect(readLanguagePreference('language', blocked)).toEqual({ preference: 'auto', storageError: LANGUAGE_STORAGE_WARNING });
    expect(readLanguagePreference('language', () => storage).storageError).toBe(LANGUAGE_STORAGE_WARNING);
    expect(saveLanguagePreference('fr', 'language', blocked)).toBe(LANGUAGE_STORAGE_WARNING);
    expect(saveLanguagePreference('fr', 'language', () => storage)).toBe(LANGUAGE_STORAGE_WARNING);
    expect(saveLanguagePreference('fr', 'language', () => undefined)).toBe(LANGUAGE_STORAGE_WARNING);
    expect(readLanguagePreference('language', () => undefined)).toEqual({ preference: 'auto', storageError: '' });
    expect(saveLanguagePreference('fr', 'language', () => ({ getItem: () => null, setItem: () => {} }))).toBe('');
  });
});

describe('localized errors without changing user data', () => {
  it.each(locales)('%s localizes static errors, numeric limits, nested line details, and user-provided duplicate names', locale => {
    const translate = createErrorTranslator(locale); const t = createTranslator(locale);
    expect(translate('Folder names cannot be empty.')).toBe(t('Folder names cannot be empty.'));
    expect(translate('Names cannot exceed 100 characters.')).toBe(t('Names cannot exceed {count} characters.', { count: 100 }));
    expect(translate('Invalid ASCII tree. Use complete branch markers and consistent four-character connector columns.')).toBe(t('Invalid {format} tree. Use complete branch markers and consistent four-character connector columns.', { format: 'ASCII' }));
    const name = 'My folder “x” {count} $&';
    const duplicate = `A folder named “${name}” already exists here (names are case-insensitive).`;
    expect(translate(duplicate)).toBe(t('A folder named “{name}” already exists here (names are case-insensitive).', { name }));
    expect(translate(duplicate)).toContain(name);
    expect(translate(new DirectoryError('NAME', 'Folder names cannot be empty.', 9).message)).toBe(t('Line {line}: {message}', { line: 9, message: t('Folder names cannot be empty.') }));
    expect(translate('Unknown browser diagnostic 123')).toBe('Unknown browser diagnostic 123');
  });
  it('translates actual core validation and parser errors while leaving the input untouched', () => {
    let nameError = ''; let parseError = '';
    try { validateName('../secret'); } catch (error) { nameError = (error as Error).message; }
    const raw = 'Root\n   Invalid indent';
    try { parseText(raw, 'plain'); } catch (error) { parseError = (error as Error).message; }
    const translate = createErrorTranslator('zh-CN');
    expect(translate(nameError)).toContain('文件夹名称');
    expect(translate(parseError)).toMatch(/^第 2 行：/);
    expect(raw).toBe('Root\n   Invalid indent');
  });
});

describe('SSR and editor-scoped contexts', () => {
  function Probe() { const context = useI18n(); return createElement('span', { lang: context.locale, dir: context.direction }, context.t('Settings')); }
  function value(locale: Locale): I18nValue { return { preference: locale, locale, direction: locale === 'ar' ? 'rtl' : 'ltr', setPreference: () => {}, t: createTranslator(locale), translateError: createErrorTranslator(locale), storageError: '' }; }
  it('has an English safe fallback context without a provider', () => expect(renderToString(createElement(Probe))).toContain('Settings'));
  it('isolates nested and adjacent editors without changing the host document', () => {
    vi.stubGlobal('document', new Proxy({}, { get() { throw new Error('Must not touch host'); } }));
    const html = renderToString(createElement('main', null,
      createElement(I18nProvider, { value: value('fr'), children: createElement(Probe) }),
      createElement(I18nProvider, { value: value('ar'), children: createElement(Probe) }), createElement(Probe)));
    expect(html).toContain('lang="fr" dir="ltr"'); expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('Paramètres'); expect(html).toContain('الإعدادات'); expect(html).toContain('Settings');
  });
  it('produces the same SSR/first-client render regardless of browser locale and saved preference', () => {
    function Component() { const language = useLanguage(); return createElement('span', null, `${language.preference}/${language.locale}/${language.direction}/${language.t('Settings')}`); }
    vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined);
    const server = renderToString(createElement(Component));
    expect(server).toContain('auto/en/ltr/Settings');
    const storage = { getItem: vi.fn(() => 'ar'), setItem: vi.fn() };
    vi.stubGlobal('window', { localStorage: storage }); vi.stubGlobal('navigator', { languages: ['zh-CN'], language: 'zh-CN' });
    expect(renderToString(createElement(Component))).toBe(server);
    expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
  });
});
