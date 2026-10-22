import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ locale: 'en-US' });

const LANGUAGE_KEY = 'folderseed:language:v1';
const DRAFT_KEY = 'folderseed:draft:v1';
const languageCodes = ['en', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'pt-BR', 'ja', 'ko', 'ar', 'hi', 'ru'];
const app = (page: Page) => page.locator('.fs-app:visible').last();
const settings = (page: Page) => page.locator('.fs-settings-dialog');
const languageSelect = (page: Page) => settings(page).locator('.fs-language-select');

type LanguageTestWindow = Window & { __testLanguages: string[]; __languageChanges: number };

async function mockBrowserLanguages(page: Page, languages: string[]) {
  await page.addInitScript(values => {
    (window as unknown as LanguageTestWindow).__testLanguages = values;
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (window as unknown as LanguageTestWindow).__testLanguages });
  }, languages);
}
async function changeBrowserLanguages(page: Page, languages: string[]) {
  await page.evaluate(values => {
    (window as unknown as LanguageTestWindow).__testLanguages = values;
    window.dispatchEvent(new Event('languagechange'));
  }, languages);
}
async function loadApp(page: Page, locale = 'en', url = '/') {
  await page.goto(url);
  await expect(app(page)).toHaveAttribute('lang', locale);
  await page.evaluate(() => document.fonts.ready);
}
async function openSettings(page: Page) {
  await page.locator('.fs-app-menu-trigger:visible').last().click();
  await page.getByRole('menuitem').click();
  await expect(settings(page)).toBeVisible();
}
async function chooseLanguage(page: Page, preference: string, resolved = preference) {
  await languageSelect(page).selectOption(preference);
  await expect(languageSelect(page)).toHaveValue(preference);
  await expect(app(page)).toHaveAttribute('lang', resolved);
}
async function importText(page: Page, text: string) {
  await page.locator('input[type="file"]').last().setInputFiles({ name: 'structure.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('.fs-folder-name')).toHaveText(text.split('\n').map(line => line.trim()));
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document?.root?.name, DRAFT_KEY)).toBe(text.split('\n')[0]);
}

async function mountWithLanguageKey(page: Page, languageStorageKey: string | false) {
  await page.goto('/examples/index.html');
  await page.evaluate(async key => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const reactUrl = resources.find(url => new URL(url).pathname.endsWith('/deps/react.js'));
    const domUrl = resources.find(url => new URL(url).pathname.endsWith('/deps/react-dom_client.js'));
    if (!reactUrl || !domUrl) throw new Error('The embedding example did not load its React modules.');
    const reactModule = await import(reactUrl);
    const domModule = await import(domUrl);
    const { createElement } = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const editorUrl = '/src/ui/FolderEditor.tsx';
    const { FolderEditor } = await import(editorUrl);
    document.getElementById('root')!.hidden = true;
    const container = document.createElement('section');
    container.dataset.testid = 'isolated-language-editor';
    document.body.append(container);
    (window as unknown as LanguageTestWindow).__languageChanges = 0;
    createRoot(container).render(createElement(FolderEditor, {
      storageKey: false, themeStorageKey: false, languageStorageKey: key,
      onChange: () => { (window as unknown as LanguageTestWindow).__languageChanges++; },
    }));
  }, languageStorageKey);
  await expect(page.getByTestId('isolated-language-editor').locator('.fs-app')).toBeVisible();
}

test('resolves browser language priority and regions and follows live changes in Automatic mode', async ({ page }) => {
  await mockBrowserLanguages(page, ['zz-ZZ', 'zh-Hant-TW', 'en-US']);
  await loadApp(page, 'zh-TW');
  await expect(app(page)).toHaveAttribute('dir', 'ltr');
  await openSettings(page);
  await expect(languageSelect(page)).toHaveValue('auto');
  for (const [languages, resolved] of [
    [['es-MX', 'en-US'], 'es'], [['fr-CA'], 'fr'], [['pt-PT'], 'pt-BR'],
    [['zh-SG'], 'zh-CN'], [['ko-KR'], 'ko'], [['xx-XX'], 'en'],
  ] as [string[], string][]) {
    await changeBrowserLanguages(page, languages);
    await expect(app(page)).toHaveAttribute('lang', resolved);
    await expect(languageSelect(page)).toHaveValue('auto');
  }
  await expect(settings(page).getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('persists a manual language independently and resumes the current browser language on Automatic', async ({ page }, testInfo) => {
  await mockBrowserLanguages(page, ['en-US']);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await loadApp(page);
  await importText(page, 'Project\n  Keep this name\n  文件夹');
  const savedBefore = await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY);
  await openSettings(page);
  await chooseLanguage(page, 'ja');
  await expect(settings(page).getByRole('heading', { level: 2 })).not.toHaveText('Settings');
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBe('ja');
  await changeBrowserLanguages(page, ['de-DE']);
  await expect(app(page)).toHaveAttribute('lang', 'ja');
  await settings(page).press('Escape');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Keep this name', '文件夹']);
  expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY)).toBe(savedBefore);
  await page.screenshot({ path: testInfo.outputPath('language-japanese-desktop.png'), fullPage: true });
  await page.reload();
  await expect(app(page)).toHaveAttribute('lang', 'ja');
  await changeBrowserLanguages(page, ['de-DE']);
  await openSettings(page);
  await expect(languageSelect(page)).toHaveValue('ja');
  await chooseLanguage(page, 'auto', 'de');
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBe('auto');
  expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY)).toBe(savedBefore);
});

test('offers all twelve languages and keeps names and JSON data unchanged', async ({ page }) => {
  await loadApp(page);
  const names = ['Project', 'Settings', '文件夹', 'ملفاتي'];
  await importText(page, 'Project\n  Settings\n  文件夹\n  ملفاتي');
  const documentBefore = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document, DRAFT_KEY);
  await openSettings(page);
  await expect(languageSelect(page).locator('option')).toHaveCount(13);
  expect(await languageSelect(page).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(['auto', ...languageCodes]);
  for (const code of languageCodes) {
    await chooseLanguage(page, code);
    await expect(app(page)).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
    const heading = await app(page).locator('h1').textContent();
    expect(heading?.trim()).not.toBe('');
    if (code !== 'en') expect(heading).not.toContain('A little structure.');
    await expect(page.locator('.fs-folder-name')).toHaveText(names);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document, DRAFT_KEY)).toEqual(documentBefore);
  }
  await chooseLanguage(page, 'ar');
  await settings(page).press('Escape');
  await page.locator('.fs-export-options [role="radio"]').nth(3).click();
  const pending = page.waitForEvent('download');
  await page.locator('.fs-download').click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(documentBefore);
});

test('does not rewrite an invalid raw draft or its last valid model when changing language', async ({ page }) => {
  await loadApp(page);
  await page.locator('.fs-format-activate').click();
  const input = page.getByRole('textbox', { name: 'Folder structure text', exact: true });
  await input.fill('Project\n    Valid');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document?.root?.name, DRAFT_KEY)).toBe('Project');
  const invalid = 'Project\n    Valid\n       Partial';
  await input.fill(invalid);
  await expect(page.locator('.fs-inline-error')).toBeVisible();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').draft, DRAFT_KEY)).toBe(invalid);
  const savedBefore = await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY);
  await openSettings(page);
  await chooseLanguage(page, 'zh-CN');
  await settings(page).press('Escape');
  await expect(page.locator('.fs-editor textarea')).toHaveValue(invalid);
  await expect(page.locator('.fs-download')).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY)).toBe(savedBefore);
  await page.reload();
  await expect(app(page)).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.fs-editor textarea')).toHaveValue(invalid);
  await expect(page.locator('.fs-preview-row')).toHaveCount(2);
});

test('isolates a custom language key without mutating the host or emitting document changes', async ({ page }) => {
  await page.addInitScript(({ defaultKey, customKey }) => {
    localStorage.setItem(defaultKey, 'fr');
    localStorage.setItem(customKey, 'de');
  }, { defaultKey: LANGUAGE_KEY, customKey: 'host:language:test' });
  await mountWithLanguageKey(page, 'host:language:test');
  await expect(app(page)).toHaveAttribute('lang', 'de');
  const hostBefore = await page.evaluate(() => ({ htmlLang: document.documentElement.lang, htmlDir: document.documentElement.dir, bodyDir: document.body.dir }));
  const changesBefore = await page.evaluate(() => (window as unknown as LanguageTestWindow).__languageChanges);
  await openSettings(page);
  await chooseLanguage(page, 'ar');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('host:language:test'))).toBe('ar');
  expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBe('fr');
  expect(await page.evaluate(() => ({ htmlLang: document.documentElement.lang, htmlDir: document.documentElement.dir, bodyDir: document.body.dir }))).toEqual(hostBefore);
  expect(await page.evaluate(() => (window as unknown as LanguageTestWindow).__languageChanges)).toBe(changesBefore);
});

test('supports session-only language choice when persistence is disabled', async ({ page }) => {
  await mockBrowserLanguages(page, ['en-US']);
  await page.addInitScript(key => localStorage.setItem(key, 'fr'), LANGUAGE_KEY);
  await mountWithLanguageKey(page, false);
  await expect(app(page)).toHaveAttribute('lang', 'en');
  await openSettings(page);
  await chooseLanguage(page, 'ko');
  expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_KEY)).toBe('fr');
  await mountWithLanguageKey(page, false);
  await expect(app(page)).toHaveAttribute('lang', 'en');
});

test('uses scoped Arabic RTL at 360 pixels while directory paths and names remain unchanged', async ({ page }, testInfo) => {
  await mockBrowserLanguages(page, ['ar-SA']);
  await page.setViewportSize({ width: 360, height: 1000 });
  await loadApp(page, 'ar');
  await importText(page, 'Project\n  English name\n  文件夹\n  ملفاتي');
  await expect(app(page)).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.fs-tree')).toHaveCSS('direction', 'ltr');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'English name', '文件夹', 'ملفاتي']);
  expect(await page.evaluate(() => document.documentElement.dir)).not.toBe('rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('language-arabic-mobile.png'), fullPage: true });
  await openSettings(page);
  await expect(languageSelect(page)).toHaveValue('auto');
  await expect(settings(page)).toHaveCSS('direction', 'rtl');
  const box = (await settings(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath('language-arabic-settings-mobile.png'), fullPage: true });
  await chooseLanguage(page, 'en');
  await expect(settings(page).getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(app(page)).toHaveAttribute('dir', 'ltr');
});
