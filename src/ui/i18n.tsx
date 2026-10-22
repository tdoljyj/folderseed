import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ptBR from './locales/pt-BR.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';
import ru from './locales/ru.json';

export const SUPPORTED_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ru', label: 'Русский' },
] as const;
export type Locale = typeof SUPPORTED_LANGUAGES[number]['value'];
export type LanguagePreference = 'auto' | Locale;
export type MessageValues = Record<string, string | number>;
export type Translator = (message: string, values?: MessageValues) => string;
export type LanguageStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type LanguageStorageProvider = () => LanguageStorage | undefined;
export const LANGUAGE_STORAGE_KEY = 'folderseed:language:v1';
export const LANGUAGE_STORAGE_WARNING = 'Language is kept for this session only.';
export const catalogs: Record<Locale, Record<string, string>> = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, es, fr, de, 'pt-BR': ptBR, ja, ko, ar, hi, ru };
const localeSet = new Set<string>(SUPPORTED_LANGUAGES.map(language => language.value));
const browserStorage: LanguageStorageProvider = () => typeof window === 'undefined' ? undefined : window.localStorage;

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || (typeof value === 'string' && localeSet.has(value));
}

/** Match browser preferences in order. Unsupported languages never displace a supported later preference. */
export function resolveLocale(languages: readonly string[] = []): Locale {
  for (const language of languages) {
    if (typeof language !== 'string') continue;
    const tag = language.trim().replaceAll('_', '-').toLowerCase();
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/.test(tag)) continue;
    const subtags = tag.split('-');
    const extension = subtags.findIndex((part, index) => index > 0 && part.length === 1);
    const parts = extension < 0 ? subtags : subtags.slice(0, extension);
    if (parts[0] === 'zh') {
      if (parts.includes('hant')) return 'zh-TW';
      if (parts.includes('hans')) return 'zh-CN';
      return parts.some(part => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN';
    }
    if (parts[0] === 'pt') return 'pt-BR';
    if (localeSet.has(parts[0])) return parts[0] as Locale;
  }
  return 'en';
}

export function readBrowserLocale(source: Pick<Navigator, 'languages' | 'language'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): Locale {
  try {
    return resolveLocale(source?.languages?.length ? source.languages : source?.language ? [source.language] : []);
  } catch { return 'en'; }
}

export function readLanguagePreference(storageKey: string | false, getStorage: LanguageStorageProvider = browserStorage): { preference: LanguagePreference; storageError: string } {
  if (storageKey === false) return { preference: 'auto', storageError: '' };
  try {
    const stored = getStorage()?.getItem(storageKey);
    return { preference: isLanguagePreference(stored) ? stored : 'auto', storageError: '' };
  } catch { return { preference: 'auto', storageError: LANGUAGE_STORAGE_WARNING }; }
}

export function saveLanguagePreference(preference: LanguagePreference, storageKey: string | false, getStorage: LanguageStorageProvider = browserStorage): string {
  if (storageKey === false) return '';
  try {
    const storage = getStorage();
    if (!storage) return LANGUAGE_STORAGE_WARNING;
    storage.setItem(storageKey, preference);
    return '';
  } catch { return LANGUAGE_STORAGE_WARNING; }
}

/** Listeners are local to an editor; no global document attributes are ever changed. */
export function subscribeBrowserLanguage(onChange: () => void, target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | undefined = typeof window === 'undefined' ? undefined : window): () => void {
  let active = true;
  const listener = () => { if (active) onChange(); };
  try { target?.addEventListener('languagechange', listener); } catch { /* Restricted hosts may disallow event subscriptions. */ }
  return () => {
    if (!active) return;
    active = false;
    try { target?.removeEventListener('languagechange', listener); } catch { /* Cleanup must remain safe in restricted hosts. */ }
  };
}

export function createTranslator(locale: Locale): Translator {
  return (message, values = {}) => {
    const catalog = catalogs[locale] ?? catalogs.en;
    const template = Object.hasOwn(catalog, message) ? catalog[message] : Object.hasOwn(catalogs.en, message) ? catalogs.en[message] : message;
    return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (placeholder, key: string) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);
  };
}

const dynamicMessages = Object.keys(en).filter(key => key.includes('{') && key !== 'Line {line}: {message}').map(key => {
  const names: string[] = [];
  const pattern = key.split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/g).map(part => {
    if (/^\{[a-zA-Z][a-zA-Z0-9]*\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { key, names, pattern: new RegExp(`^${pattern}$`) };
});

/** Translate known application messages, never folder names or arbitrary imported text. */
export function createErrorTranslator(locale: Locale): (message: string) => string {
  const t = createTranslator(locale);
  return function translateError(message: string): string {
    if (Object.hasOwn(catalogs.en, message)) return t(message);
    const line = /^Line (\d+): ([\s\S]+)$/.exec(message);
    if (line) return t('Line {line}: {message}', { line: line[1], message: translateError(line[2]) });
    for (const candidate of dynamicMessages) {
      const match = candidate.pattern.exec(message);
      if (match) return t(candidate.key, Object.fromEntries(candidate.names.map((name, index) => [name, match[index + 1]])));
    }
    // Browser/platform errors are not catalog messages; retain their diagnostic detail.
    return message;
  };
}

export interface I18nValue {
  preference: LanguagePreference;
  locale: Locale;
  direction: 'ltr' | 'rtl';
  setPreference: (preference: LanguagePreference) => void;
  t: Translator;
  translateError: (message: string) => string;
  storageError: string;
}
const defaultValue: I18nValue = { preference: 'auto', locale: 'en', direction: 'ltr', setPreference: () => {}, t: createTranslator('en'), translateError: createErrorTranslator('en'), storageError: '' };
const I18nContext = createContext<I18nValue>(defaultValue);
export function I18nProvider({ value, children }: { value: I18nValue; children: ReactNode }) { return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>; }
export function useI18n(): I18nValue { return useContext(I18nContext); }

export function useLanguage(storageKey: string | false = LANGUAGE_STORAGE_KEY): I18nValue {
  // Identical first render on the server and client avoids hydration mismatches.
  const [preference, updatePreference] = useState<LanguagePreference>('auto');
  const [systemLocale, setSystemLocale] = useState<Locale>('en');
  const [storageError, setStorageError] = useState('');
  useEffect(() => {
    const stored = readLanguagePreference(storageKey);
    updatePreference(stored.preference); setStorageError(stored.storageError); setSystemLocale(readBrowserLocale());
  }, [storageKey]);
  useEffect(() => {
    if (preference !== 'auto') return;
    const update = () => setSystemLocale(readBrowserLocale());
    update();
    return subscribeBrowserLanguage(update);
  }, [preference]);
  const setPreference = useCallback((next: LanguagePreference) => {
    if (!isLanguagePreference(next)) return;
    updatePreference(next);
    if (next === 'auto') setSystemLocale(readBrowserLocale());
    setStorageError(saveLanguagePreference(next, storageKey));
  }, [storageKey]);
  const locale = preference === 'auto' ? systemLocale : preference;
  return useMemo(() => ({ preference, locale, direction: locale === 'ar' ? 'rtl' as const : 'ltr' as const, setPreference, t: createTranslator(locale), translateError: createErrorTranslator(locale), storageError }), [preference, locale, setPreference, storageError]);
}
