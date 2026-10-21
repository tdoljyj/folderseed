import { useCallback, useEffect, useRef, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type ThemeStorageProvider = () => ThemeStorage | undefined;
type ThemeListener = (event: { readonly matches: boolean }) => void;
export interface ThemeMediaQuery {
  readonly matches: boolean;
  addEventListener?: (type: 'change', listener: ThemeListener) => void;
  removeEventListener?: (type: 'change', listener: ThemeListener) => void;
  addListener?: (listener: ThemeListener) => void;
  removeListener?: (listener: ThemeListener) => void;
}
export type ThemeMatchMedia = (query: string) => ThemeMediaQuery | undefined;

const SYSTEM_QUERY = '(prefers-color-scheme: dark)';
const STORAGE_WARNING = 'Theme is kept for this session only.';
const browserStorage: ThemeStorageProvider = () => typeof window === 'undefined' ? undefined : window.localStorage;
const browserMatchMedia: ThemeMatchMedia = query => typeof window === 'undefined' ? undefined : window.matchMedia?.(query);

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Read only the independent theme key; disabled storage never calls the provider. */
export function readThemePreference(
  storageKey: string | false,
  getStorage: ThemeStorageProvider = browserStorage,
): { preference: ThemePreference; storageWarning: string } {
  if (storageKey === false) return { preference: 'system', storageWarning: '' };
  try {
    const value = getStorage()?.getItem(storageKey);
    return { preference: isThemePreference(value) ? value : 'system', storageWarning: '' };
  } catch {
    return { preference: 'system', storageWarning: STORAGE_WARNING };
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storageKey: string | false,
  getStorage: ThemeStorageProvider = browserStorage,
): string {
  if (storageKey === false) return '';
  try {
    const storage = getStorage();
    if (!storage) return STORAGE_WARNING;
    storage.setItem(storageKey, preference);
    return '';
  } catch {
    return STORAGE_WARNING;
  }
}

export function readSystemTheme(matchMedia: ThemeMatchMedia = browserMatchMedia): ResolvedTheme {
  try { return matchMedia(SYSTEM_QUERY)?.matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference;
}

/** Observe the current system setting and later changes without mutating global DOM. */
export function subscribeSystemTheme(
  onChange: (theme: ResolvedTheme) => void,
  matchMedia: ThemeMatchMedia = browserMatchMedia,
): () => void {
  let active = true;
  let cleanup: (() => void) | undefined;
  let currentTheme: ResolvedTheme = 'light';
  const listener: ThemeListener = event => { if (active) onChange(event.matches ? 'dark' : 'light'); };
  try {
    const query = matchMedia(SYSTEM_QUERY);
    currentTheme = query?.matches ? 'dark' : 'light';
    onChange(currentTheme);
    if (query?.addEventListener && query.removeEventListener) {
      query.addEventListener('change', listener);
      cleanup = () => query.removeEventListener!('change', listener);
    } else if (query?.addListener && query.removeListener) {
      query.addListener(listener);
      cleanup = () => query.removeListener!(listener);
    }
  } catch {
    onChange(currentTheme);
  }
  return () => {
    if (!active) return;
    active = false;
    try { cleanup?.(); } catch { /* Some restricted hosts cannot remove media listeners. */ }
  };
}

export function useTheme(storageKey: string | false = 'folderseed:theme:v1'): {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  storageWarning: string;
} {
  const [choice, setChoice] = useState(() => readThemePreference(storageKey));
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => readSystemTheme());
  const previousKey = useRef(storageKey);

  useEffect(() => {
    if (previousKey.current === storageKey) return;
    previousKey.current = storageKey;
    setChoice(readThemePreference(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (choice.preference !== 'system') return;
    return subscribeSystemTheme(setSystemTheme);
  }, [choice.preference]);

  const setPreference = useCallback((preference: ThemePreference) => {
    if (preference === 'system') setSystemTheme(readSystemTheme());
    const storageWarning = saveThemePreference(preference, storageKey);
    setChoice({ preference, storageWarning });
  }, [storageKey]);

  return { ...choice, resolvedTheme: resolveTheme(choice.preference, systemTheme), setPreference };
}
