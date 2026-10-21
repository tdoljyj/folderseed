import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  isThemePreference, readSystemTheme, readThemePreference, resolveTheme, saveThemePreference,
  subscribeSystemTheme, useTheme, type ThemeMediaQuery, type ThemePreference, type ThemeStorage,
} from '../src/ui/theme';

const key = 'folderseed:theme:v1';
const warning = 'Theme is kept for this session only.';
afterEach(() => { vi.unstubAllGlobals(); });

describe('theme preference storage', () => {
  it.each(['system', 'light', 'dark'] as const)('reads the raw %s value without writing anything', preference => {
    const storage = { getItem: vi.fn(() => preference), setItem: vi.fn() };
    expect(readThemePreference(key, () => storage)).toEqual({ preference, storageWarning: '' });
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(key);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(isThemePreference(preference)).toBe(true);
  });

  it.each([null, undefined, '', 'Dark', 'auto', '"dark"', '{"theme":"dark"}', ' dark ', false, 1])('falls back to system for invalid value %j', value => {
    const storage = { getItem: () => value, setItem: vi.fn() } as unknown as ThemeStorage;
    expect(readThemePreference(key, () => storage)).toEqual({ preference: 'system', storageWarning: '' });
    expect(isThemePreference(value)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(['system', 'light', 'dark'] as const)('persists %s as a raw string under only its theme key', preference => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    expect(saveThemePreference(preference, key, () => storage)).toBe('');
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(key, preference);
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('never accesses storage when persistence is disabled', () => {
    const provider = vi.fn((): ThemeStorage => { throw new Error('Must not access storage'); });
    expect(readThemePreference(false, provider)).toEqual({ preference: 'system', storageWarning: '' });
    expect(saveThemePreference('dark', false, provider)).toBe('');
    expect(provider).not.toHaveBeenCalled();
  });

  it('handles blocked storage getters, reads, and writes safely', () => {
    const blocked = (): ThemeStorage => { throw new Error('Blocked'); };
    const storage = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Quota exceeded'); } };
    expect(readThemePreference(key, blocked)).toEqual({ preference: 'system', storageWarning: warning });
    expect(readThemePreference(key, () => storage)).toEqual({ preference: 'system', storageWarning: warning });
    expect(saveThemePreference('dark', key, blocked)).toBe(warning);
    expect(saveThemePreference('light', key, () => storage)).toBe(warning);
  });

  it('is safe with no browser storage and can clear a previous failure warning after a successful write', () => {
    expect(readThemePreference(key, () => undefined)).toEqual({ preference: 'system', storageWarning: '' });
    expect(saveThemePreference('dark', key, () => undefined)).toBe(warning);
    expect(saveThemePreference('dark', key, () => ({ getItem: () => null, setItem: () => {} }))).toBe('');
  });

  it('supports independent custom keys without touching directory drafts', () => {
    const values = new Map([['draft', 'unchanged'], ['first-theme', 'light'], ['second-theme', 'dark']]);
    const storage = { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => { values.set(name, value); } };
    expect(readThemePreference('first-theme', () => storage).preference).toBe('light');
    expect(readThemePreference('second-theme', () => storage).preference).toBe('dark');
    saveThemePreference('system', 'first-theme', () => storage);
    expect(values.get('second-theme')).toBe('dark');
    expect(values.get('draft')).toBe('unchanged');
  });
});

describe('system theme detection and observation', () => {
  it.each([[true, 'dark'], [false, 'light']] as const)('reads matches=%s as %s', (matches, expected) => {
    const matchMedia = vi.fn(() => ({ matches }));
    expect(readSystemTheme(matchMedia)).toBe(expected);
    expect(matchMedia).toHaveBeenCalledExactlyOnceWith('(prefers-color-scheme: dark)');
  });

  it('falls back to light for missing, throwing, and inaccessible media APIs', () => {
    expect(readSystemTheme(() => undefined)).toBe('light');
    expect(readSystemTheme(() => { throw new Error('Unsupported'); })).toBe('light');
    expect(readSystemTheme(() => ({ get matches(): boolean { throw new Error('Blocked'); } }))).toBe('light');
    vi.stubGlobal('window', {});
    expect(readSystemTheme()).toBe('light');
  });

  it.each([
    ['system', 'dark', 'dark'], ['system', 'light', 'light'],
    ['light', 'dark', 'light'], ['light', 'light', 'light'],
    ['dark', 'light', 'dark'], ['dark', 'dark', 'dark'],
  ] as const)('resolves %s with system %s to %s', (preference, system, expected) => {
    expect(resolveTheme(preference, system)).toBe(expected);
  });

  it('emits the current value and live changes, then removes the exact listener on cleanup', () => {
    const onChange = vi.fn();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const query = { matches: true, addEventListener, removeEventListener };
    const stop = subscribeSystemTheme(onChange, () => query);
    expect(onChange).toHaveBeenLastCalledWith('dark');
    const [type, listener] = addEventListener.mock.calls[0];
    expect(type).toBe('change');
    listener({ matches: false });
    expect(onChange).toHaveBeenLastCalledWith('light');
    listener({ matches: true });
    expect(onChange).toHaveBeenLastCalledWith('dark');
    stop();
    expect(removeEventListener).toHaveBeenCalledExactlyOnceWith('change', listener);
    const count = onChange.mock.calls.length;
    listener({ matches: false });
    stop();
    expect(onChange).toHaveBeenCalledTimes(count);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('uses the legacy listener pair when modern listeners are unavailable', () => {
    const onChange = vi.fn();
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const stop = subscribeSystemTheme(onChange, () => ({ matches: false, addListener, removeListener }));
    const [listener] = addListener.mock.calls[0];
    listener({ matches: true });
    expect(onChange).toHaveBeenLastCalledWith('dark');
    stop();
    expect(removeListener).toHaveBeenCalledExactlyOnceWith(listener);
  });

  it('does not register an unremovable listener', () => {
    const addEventListener = vi.fn();
    const onChange = vi.fn();
    const stop = subscribeSystemTheme(onChange, () => ({ matches: true, addEventListener }));
    expect(onChange).toHaveBeenLastCalledWith('dark');
    expect(addEventListener).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('handles failed subscriptions and cleanup without throwing', () => {
    const onChange = vi.fn();
    const fail = () => { throw new Error('Blocked'); };
    expect(() => subscribeSystemTheme(onChange, fail)()).not.toThrow();
    expect(onChange).toHaveBeenLastCalledWith('light');
    const query: ThemeMediaQuery = { matches: true, addEventListener: fail, removeEventListener: fail };
    expect(() => subscribeSystemTheme(onChange, () => query)()).not.toThrow();
    expect(onChange).toHaveBeenLastCalledWith('dark');
    query.addEventListener = () => {};
    expect(() => subscribeSystemTheme(onChange, () => query)()).not.toThrow();
  });

  it('preserves a readable dark system theme when listener registration throws', () => {
    const onChange = vi.fn();
    const stop = subscribeSystemTheme(onChange, () => ({
      matches: true,
      addEventListener: () => { throw new Error('Listeners are blocked'); },
      removeEventListener: vi.fn(),
    }));
    expect(onChange).toHaveBeenLastCalledWith('dark');
    expect(onChange.mock.calls.every(([value]) => value === 'dark')).toBe(true);
    expect(() => stop()).not.toThrow();
  });

  it('keeps explicit light and dark preferences stable while system changes', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    let system: 'light' | 'dark' = 'light';
    const stop = subscribeSystemTheme(value => { system = value; }, () => ({ matches: false, addEventListener, removeEventListener }));
    const listener = addEventListener.mock.calls[0][1];
    for (const matches of [true, false, true]) {
      listener({ matches });
      expect(resolveTheme('light', system)).toBe('light');
      expect(resolveTheme('dark', system)).toBe('dark');
      expect(resolveTheme('system', system)).toBe(matches ? 'dark' : 'light');
    }
    stop();
  });
});

describe('theme hook initial state without a DOM renderer', () => {
  function render(storageKey?: string | false): string {
    function Component() {
      const theme = useTheme(storageKey);
      return createElement('span', null, `${theme.preference}/${theme.resolvedTheme}/${theme.storageWarning}`);
    }
    return renderToString(createElement(Component));
  }

  it('is SSR safe and defaults to system/light', () => {
    vi.stubGlobal('window', undefined);
    expect(render()).toContain('system/light/');
  });

  it.each(['system', 'light', 'dark'] as const)('initializes the hook from stored %s without writing or touching document', preference => {
    const storage = { getItem: vi.fn(() => preference), setItem: vi.fn() };
    const query = { matches: true };
    vi.stubGlobal('window', { localStorage: storage, matchMedia: () => query });
    vi.stubGlobal('document', new Proxy({}, { get() { throw new Error('Must not touch document'); } }));
    expect(render()).toContain(`${preference}/${preference === 'light' ? 'light' : 'dark'}/`);
    expect(storage.getItem).toHaveBeenCalledWith(key);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('does not access localStorage for a session-only hook', () => {
    vi.stubGlobal('window', {
      get localStorage(): never { throw new Error('Must not access storage'); },
      matchMedia: () => ({ matches: true }),
    });
    expect(render(false)).toContain('system/dark/</span>');
  });

  it('reports blocked storage but still initializes a usable system theme', () => {
    vi.stubGlobal('window', {
      get localStorage(): never { throw new Error('Blocked'); },
      matchMedia: () => ({ matches: false }),
    });
    expect(render()).toContain(`system/light/${warning}`);
  });
});
