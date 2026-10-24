import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { flatten, formatText, parseJSON, parseText, type DirectoryDocument } from '../../src/core';
import type { Locale } from '../../src/ui/i18n';
import { templateCommentMessages } from '../../src/ui/templateComments';

const catalogs: Record<string, Record<string, string>> = Object.fromEntries(['en', 'zh-CN', 'fr', 'ja', 'ar'].map(locale => [locale, JSON.parse(readFileSync(new URL(`../../src/ui/locales/${locale}.json`, import.meta.url), 'utf8'))]));
const DRAFT = 'folderseed:draft:v1';
const ROOT = 'My creative project';
const app = (page: Page) => page.locator('.fs-app:visible').last();
const cells = (page: Page) => app(page).locator('.fs-folder-comment');
const cell = (page: Page, name: string) => app(page).locator(`.fs-folder-select[title="${name}"]`).locator('..').locator('..').locator('..').locator(':scope > .fs-folder-comment');
const input = (page: Page) => app(page).locator('.fs-inline-comment');
const outline = (page: Page) => app(page).locator('.fs-text-area textarea');
type ProbeWindow = Window & { __draftWrites: number; __languages: string[]; __changes: number };

test.use({ locale: 'en-US' });
async function load(page: Page, preference = 'en', languages = ['en-US']) {
  await page.setViewportSize({ width: 1920, height: 1100 });
  await page.addInitScript(({ preference, languages, key }) => {
    const probe = window as unknown as ProbeWindow;
    probe.__languages = languages;
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => probe.__languages });
    if (!localStorage.getItem('folderseed:language:v1')) localStorage.setItem('folderseed:language:v1', preference);
    probe.__draftWrites = 0;
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) probe.__draftWrites++;
      return write.call(this, name, value);
    };
  }, { preference, languages, key: DRAFT });
  await page.goto('/');
  await expect(cells(page)).toHaveCount(10);
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document?.version, DRAFT)).toBe(3);
}
async function model(page: Page) {
  return parseJSON(await page.evaluate(key => JSON.stringify(JSON.parse(localStorage.getItem(key)!).document), DRAFT));
}
const rawDraft = (page: Page) => page.evaluate(key => localStorage.getItem(key), DRAFT);
const writes = (page: Page) => page.evaluate(() => (window as unknown as ProbeWindow).__draftWrites);
async function chooseLanguage(page: Page, value: string, resolved = value) {
  await app(page).locator('.fs-app-menu-trigger:visible').last().click();
  await page.getByRole('menuitem').click();
  await page.locator('.fs-language-select').selectOption(value);
  await expect(app(page)).toHaveAttribute('lang', resolved);
  await page.locator('.fs-settings-dialog').press('Escape');
}
function localized(document: DirectoryDocument, locale: Locale) {
  const translate = (message: string) => catalogs[locale]?.[message] ?? message;
  return flatten(document).map(({ node }) => node.commentBinding && Object.hasOwn(templateCommentMessages, node.commentBinding.key)
    ? translate(templateCommentMessages[node.commentBinding.key as keyof typeof templateCommentMessages]) : node.comment ?? '');
}
async function expectLocalized(page: Page, document: DirectoryDocument, locale: Locale) {
  await expect(cells(page)).toHaveText(localized(document, locale));
}
async function edit(page: Page, name = ROOT) {
  await app(page).locator('.fs-editor').press('Escape');
  await cell(page, name).click();
  await expect(input(page)).toBeFocused();
}
async function idleText(page: Page) {
  const current = await outline(page).inputValue();
  await expect.poll(() => page.evaluate(({ key, current }) => { const draft = JSON.parse(localStorage.getItem(key)!); return draft.draft === current && draft.pending === false; }, { key: DRAFT, current })).toBe(true);
}
async function chooseFormat(page: Page, index: number) {
  await app(page).locator('.fs-format-menu-trigger').click();
  await page.getByRole('menuitemradio').nth(index).click();
}
async function download(page: Page, card: number) {
  await app(page).locator('.fs-export-options [role="radio"]').nth(card).click();
  const pending = page.waitForEvent('download');
  await app(page).locator('.fs-download').click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  return readFile((await file.path())!);
}
async function importFile(page: Page, data: string, name: string) {
  await app(page).locator('input[type="file"]').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/plain', buffer: Buffer.from(data) });
  await expect(app(page).locator('.fs-notice')).toContainText(name);
}

test('projects Automatic and manual language changes without canonical writes or history, and reloads bindings', async ({ page }, testInfo) => {
  await load(page, 'auto', ['zh-CN']);
  const canonical = await model(page);
  await expectLocalized(page, canonical, 'zh-CN');
  const before = await rawDraft(page), count = await writes(page);
  await page.evaluate(() => { (window as unknown as ProbeWindow).__languages = ['ja-JP']; window.dispatchEvent(new Event('languagechange')); });
  await expect(app(page)).toHaveAttribute('lang', 'ja');
  await expectLocalized(page, canonical, 'ja');
  await chooseLanguage(page, 'fr');
  await expectLocalized(page, canonical, 'fr');
  expect(await rawDraft(page)).toBe(before);
  expect(await writes(page)).toBe(count);
  await expect(app(page).locator('.fs-history button').first()).toBeDisabled();
  await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath('template-bound-french.png') });
  await page.reload();
  await expect(app(page)).toHaveAttribute('lang', 'fr');
  await expectLocalized(page, canonical, 'fr');
  expect(await model(page)).toEqual(canonical);
  await chooseLanguage(page, 'en');
  await expectLocalized(page, canonical, 'en');
  await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath('template-bound-english.png') });
});

test('detaches explicit or touched same-value saves, preserves untouched blur and cancel, and restores binding with Undo', async ({ page }) => {
  await load(page);
  const canonical = await model(page), original = canonical.root.comment!;
  await edit(page);
  await page.locator('h1').click();
  expect(await model(page)).toEqual(canonical);
  await expect(app(page).locator('.fs-history button').first()).toBeDisabled();
  await edit(page);
  await input(page).fill('Discarded custom note');
  await input(page).press('Escape');
  expect(await model(page)).toEqual(canonical);
  for (const method of ['enter', 'save', 'touched-blur']) {
    await edit(page);
    await expect(input(page)).toHaveValue(original);
    if (method === 'touched-blur') {
      await input(page).press('End');
      await input(page).pressSequentially('!');
      await input(page).press('Backspace');
      await expect(input(page)).toHaveValue(original);
      await page.locator('h1').click();
    } else if (method === 'save') await app(page).locator('.fs-folder-comment.is-editing .fs-inline-save').click();
    else await input(page).press('Enter');
    await expect.poll(async () => (await model(page)).root.commentBinding).toBeUndefined();
    expect((await model(page)).root.comment).toBe(original);
    await chooseLanguage(page, 'zh-CN');
    await expect(cell(page, ROOT)).toHaveText(original);
    await app(page).locator('.fs-history button').first().click();
    expect(await model(page)).toEqual(canonical);
    await expect(cell(page, ROOT)).toHaveText(localized(canonical, 'zh-CN')[0]);
    await chooseLanguage(page, 'en');
  }
});

test('keeps old version-1/version-2 and identical imported phrases literal without guessing bindings', async ({ page }) => {
  await load(page);
  const canonical = await model(page);
  const literal = structuredClone(canonical);
  for (const { node } of flatten(literal)) delete node.commentBinding;
  for (const version of [1, 2, 'text'] as const) {
    await chooseLanguage(page, 'en');
    await importFile(page, version === 'text' ? formatText(literal, 'plain', 4) : JSON.stringify({ version, root: literal.root }), version === 'text' ? 'same-phrases.txt' : `legacy-${version}.json`);
    await expect.poll(async () => flatten(await model(page)).every(({ node }) => !node.commentBinding)).toBe(true);
    const saved = await model(page);
    await chooseLanguage(page, 'ar');
    await expect(cells(page)).toHaveText(flatten(literal).map(({ node }) => node.comment!));
    expect(await model(page)).toEqual(saved);
  }
  await edit(page);
  await input(page).fill('My own note — 我的说明');
  await input(page).press('Enter');
  await chooseLanguage(page, 'ja');
  await expect(cell(page, ROOT)).toHaveText('My own note — 我的说明');
});

test('preserves bindings through unchanged text and format/locale switches but commits substantive text as literal snapshots', async ({ page }) => {
  await load(page, 'zh-CN');
  const canonical = await model(page);
  for (const index of [0, 1, 2, 3]) {
    await chooseFormat(page, index);
    await expect(app(page).locator('.fs-comment-format-note')).toBeVisible();
    const raw = await outline(page).inputValue();
    await outline(page).fill(`${raw}\n`);
    await idleText(page);
    expect(await model(page)).toEqual(canonical);
    const stored = await rawDraft(page), count = await writes(page);
    await chooseLanguage(page, 'en');
    expect(await rawDraft(page)).toBe(stored);
    expect(await writes(page)).toBe(count);
    expect(await outline(page).inputValue()).toContain(canonical.root.comment!);
    await app(page).locator('.fs-editor-tabs > button').click();
    await expectLocalized(page, canonical, 'en');
    await chooseLanguage(page, 'zh-CN');
  }
  await expect(app(page).locator('.fs-history button').first()).toBeDisabled();
  await chooseFormat(page, 0);
  const raw = await outline(page).inputValue();
  await outline(page).fill(raw.replace(ROOT, 'Customized plan'));
  await idleText(page);
  const snapshot = await model(page);
  expect(snapshot.root.name).toBe('Customized plan');
  expect(flatten(snapshot).every(({ node }) => !node.commentBinding)).toBe(true);
  expect(snapshot.root.comment).toBe(localized(canonical, 'zh-CN')[0]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await chooseLanguage(page, 'en');
  expect(await model(page)).toEqual(snapshot);
  await app(page).locator('.fs-history button').first().click();
  expect(await model(page)).toEqual(canonical);
});

test('keeps localized clean text through IME start and preserves invalid raw drafts across locale changes and reload', async ({ page }) => {
  await load(page);
  const canonical = await model(page);
  await chooseFormat(page, 0);
  await chooseLanguage(page, 'zh-CN');
  const chinese = await outline(page).inputValue();
  expect(chinese).toContain(localized(canonical, 'zh-CN')[0]);
  await outline(page).dispatchEvent('compositionstart');
  await expect(outline(page)).toHaveValue(chinese);
  await outline(page).fill(chinese.replace(ROOT, 'Composing project'));
  await outline(page).dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect(await model(page)).toEqual(canonical);
  await outline(page).dispatchEvent('compositionend', { data: 'Composing project' });
  await idleText(page);
  expect((await model(page)).root.name).toBe('Composing project');
  await app(page).locator('.fs-history button').first().click();
  expect(await model(page)).toEqual(canonical);
  const invalid = 'Project // unfinished\n    Child\n       Broken indentation';
  await outline(page).fill(invalid);
  await expect(app(page).locator('.fs-text-area > [role="alert"]')).toBeVisible();
  await expect.poll(async () => JSON.parse((await rawDraft(page))!).draft).toBe(invalid);
  const stored = await rawDraft(page), count = await writes(page);
  await chooseLanguage(page, 'ar');
  await expect(outline(page)).toHaveValue(invalid);
  expect(await rawDraft(page)).toBe(stored);
  expect(await writes(page)).toBe(count);
  expect(await model(page)).toEqual(canonical);
  await expect(app(page).locator('.fs-download')).toBeDisabled();
  await page.reload();
  await expect(outline(page)).toHaveValue(invalid);
  expect(await model(page)).toEqual(canonical);
  await app(page).locator('.fs-text-actions button').click();
  expect(await outline(page).inputValue()).toContain(localized(canonical, 'ar')[0]);
});

test('preserves bindings through rename/move and JSON v3 while text/image exports localize and ZIP names do not', async ({ page }) => {
  await load(page, 'fr');
  const canonical = await model(page);
  const original = flatten(canonical).find(({ node }) => node.name === 'References')!.node;
  await app(page).locator('.fs-folder-select[title="References"]').click();
  await app(page).locator('[data-action="rename"]').click();
  await app(page).locator('input.fs-inline-name').fill('Research');
  await app(page).locator('.fs-inline-save').click();
  await app(page).locator('.fs-advanced-move').click();
  const destination = flatten(canonical).find(({ node }) => node.name === '02 Work in progress')!.node.id;
  await page.locator('#destination').selectOption(destination);
  await page.locator('dialog.fs-dialog button[type="submit"]').click();
  const updated = await model(page);
  const moved = flatten(updated).find(({ node }) => node.id === original.id)!;
  expect(moved.path).toBe(`${ROOT}/02 Work in progress/Research`);
  expect(moved.node.commentBinding).toEqual(original.commentBinding);
  await chooseLanguage(page, 'zh-CN');
  const json = await download(page, 3);
  expect(JSON.parse(json.toString()).version).toBe(3);
  expect(parseJSON(json.toString())).toEqual(updated);
  const txt = parseText((await download(page, 1)).toString(), 'plain');
  expect(flatten(txt).map(({ node }) => node.comment ?? '')).toEqual(localized(updated, 'zh-CN'));
  expect(flatten(txt).every(({ node }) => !node.commentBinding)).toBe(true);
  const md = parseText((await download(page, 2)).toString(), 'markdown');
  expect(flatten(md).map(({ node }) => node.comment ?? '')).toEqual(localized(updated, 'zh-CN'));
  const svg = (await download(page, 4)).toString();
  expect(svg).toContain(localized(updated, 'zh-CN')[0]);
  const zip = unzipSync(await download(page, 0));
  expect(Object.keys(zip)).toEqual(flatten(updated).map(({ path }) => `${path}/`));
  expect(Object.values(zip).every(bytes => bytes.length === 0)).toBe(true);
  await importFile(page, json.toString(), 'bound-project.json');
  expect(await model(page)).toEqual(updated);
  await chooseLanguage(page, 'ja');
  await expectLocalized(page, updated, 'ja');
});

test('changes a host editor language without emitting a document callback', async ({ page }) => {
  await load(page);
  await page.goto('/examples/index.html');
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const reactURL = resources.find(url => new URL(url).pathname.endsWith('/deps/react.js'))!;
    const domURL = resources.find(url => new URL(url).pathname.endsWith('/deps/react-dom_client.js'))!;
    const reactModule = await import(reactURL), domModule = await import(domURL);
    const editorURL = '/src/ui/FolderEditor.tsx', templateURL = '/src/ui/templates.ts';
    const { FolderEditor } = await import(editorURL), { makeTemplate } = await import(templateURL);
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('section'); document.body.append(host);
    (window as unknown as ProbeWindow).__changes = 0;
    (domModule.default ?? domModule).createRoot(host).render((reactModule.default ?? reactModule).createElement(FolderEditor, {
      initialDocument: makeTemplate(3), storageKey: false, languageStorageKey: false, themeStorageKey: false,
      onChange: () => { (window as unknown as ProbeWindow).__changes++; },
    }));
  });
  await expect(cells(page)).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__changes)).toBeGreaterThan(0);
  const count = await page.evaluate(() => (window as unknown as ProbeWindow).__changes);
  const english = await cells(page).textContent();
  await chooseLanguage(page, 'zh-CN');
  await expect(cells(page)).not.toHaveText(english!);
  await chooseLanguage(page, 'fr');
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__changes)).toBe(count);
  await expect(app(page).locator('.fs-history button').first()).toBeDisabled();
});
