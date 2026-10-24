import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { flatten, formatText, parseJSON, parseText, type DirectoryDocument } from '../../src/core';

// Comments are metadata: every check keeps names, paths, and user text separate.
test.use({ locale: 'en-US' });
const DRAFT_KEY = 'folderseed:draft:v1';
const folder = (page: Page, name: string) => page.locator(`.fs-folder-select[title="${name}"]`);
const item = (page: Page, name: string) => folder(page, name).locator('..').locator('..').locator('..');
const comment = (page: Page, name: string) => item(page, name).locator(':scope > .fs-folder-comment');
const commentInput = (page: Page) => page.locator('.fs-folder-comment.is-editing .fs-inline-comment');
const commentError = (page: Page) => page.locator('.fs-tree-help .fs-comment-error[role="alert"]');
const action = (page: Page, name: string) => page.locator(`.fs-context-actions [data-action="${name}"]`);
const plain = 'Project // Project note\n    Alpha // Original note\n        Nested // Keep with nested folder\n    Beta';

async function load(page: Page, locale = 'en', width = 1440, theme = 'light') {
  await page.setViewportSize({ width, height: 1080 });
  await page.addInitScript(({ language, appearance }) => {
    localStorage.setItem('folderseed:language:v1', language);
    localStorage.setItem('folderseed:theme:v1', appearance);
  }, { language: locale, appearance: theme });
  await page.goto('/');
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', locale);
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(key => !!JSON.parse(localStorage.getItem(key) ?? '{}').document, DRAFT_KEY)).toBe(true);
}
async function saved(page: Page): Promise<DirectoryDocument> {
  const raw = await page.evaluate(key => JSON.stringify(JSON.parse(localStorage.getItem(key) ?? '{}').document), DRAFT_KEY);
  return parseJSON(raw);
}
function details(document: DirectoryDocument) {
  return flatten(document).map(({ node, path }) => ({ name: node.name, comment: node.comment ?? '', path }));
}
async function expectSaved(page: Page, expected: DirectoryDocument) {
  await expect.poll(async () => details(await saved(page))).toEqual(details(expected));
}
async function expectComment(page: Page, name: string, value: string) {
  await expect.poll(async () => flatten(await saved(page)).find(row => row.node.name === name)?.node.comment ?? '').toBe(value);
  if (value) await expect(comment(page, name)).toHaveAttribute('title', value);
  else await expect(comment(page, name)).toHaveClass(/is-empty/);
}
async function importFile(page: Page, text: string, name = 'comments.txt') {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/plain', buffer: Buffer.from(text) });
  await expectSaved(page, name.endsWith('.json') ? parseJSON(text) : parseText(text, 'plain'));
}
async function clearSelection(page: Page) {
  await page.locator('.fs-editor').press('Escape');
  await expect(page.locator('.fs-folder-select[aria-pressed="true"]')).toHaveCount(0);
}
async function select(page: Page, name: string) {
  await clearSelection(page);
  await folder(page, name).click();
  await expect(folder(page, name)).toHaveAttribute('aria-pressed', 'true');
}
async function editComment(page: Page, name: string) {
  await clearSelection(page);
  await comment(page, name).click();
  await expect(commentInput(page)).toBeFocused();
}
async function openSettings(page: Page) {
  await page.locator('.fs-app-menu-trigger:visible').last().click();
  await page.getByRole('menuitem').click();
  await expect(page.locator('.fs-settings-dialog')).toBeVisible();
}
async function language(page: Page, locale: string) {
  await openSettings(page);
  await page.locator('.fs-language-select').selectOption(locale);
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', locale);
  await page.locator('.fs-settings-dialog').press('Escape');
}
async function download(page: Page, card: number) {
  await page.locator('.fs-export-options [role="radio"]').nth(card).click();
  const pending = page.waitForEvent('download');
  await page.locator('.fs-download').click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  return readFile((await file.path())!);
}
async function chooseFormat(page: Page, index: number) {
  await page.locator('.fs-format-menu-trigger').click();
  await page.getByRole('menuitemradio').nth(index).click();
}

async function nameControlCenters(page: Page) {
  const targets = await page.locator('.fs-inline-editor').evaluate(editor =>
    [...editor.querySelectorAll('button')].map(button => {
      const bounds = button.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { name: button.getAttribute('aria-label'), x, y, receivesPointer: hit === button || !!hit && button.contains(hit) };
    }));
  expect(targets.map(target => target.name)).toEqual(['Save name', 'Cancel editing']);
  for (const target of targets) expect(target.receivesPointer, `${target.name} is not covered by the disabled comment cell`).toBe(true);
  return { save: targets[0], cancel: targets[1] };
}

// All templates together contain 29 folders, including the one-folder blank start.
test('provides editable comments for every folder in all four starting templates', async ({ page }, testInfo) => {
  await load(page);
  let total = 0;
  for (const [index, expected] of [10, 8, 10, 1].entries()) {
    if (index) {
      await page.locator('.fs-template').nth(index).click();
      await page.getByRole('button', { name: 'Use template', exact: true }).click();
    }
    await expect(page.locator('.fs-folder-comment')).toHaveCount(expected);
    await expect(page.locator('.fs-folder-comment.is-empty')).toHaveCount(0);
    await expect(page.locator('.fs-preview-comment')).toHaveCount(expected);
    const model = await saved(page);
    expect(flatten(model)).toHaveLength(expected);
    expect(flatten(model).every(({ node }) => !!node.comment?.trim())).toBe(true);
    expect(await page.locator('.fs-folder-comment').evaluateAll(cells => cells.every(cell => cell.getAttribute('title') === cell.textContent))).toBe(true);
    if (index === 0) await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath('comment-template-desktop.png') });
    total += expected;
  }
  expect(total).toBe(29);
});

test('presents empty comment cells as optional rather than a required action', async ({ page }) => {
  await load(page, 'zh-CN');
  await importFile(page, 'Project\n    Empty');
  await expect(comment(page, 'Empty')).toHaveText('可添加注释');
  await expect(comment(page, 'Empty')).toHaveAttribute('title', '可添加注释');
  await page.mouse.move(0, 0);
  await expect(comment(page, 'Empty')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(comment(page, 'Empty')).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  await language(page, 'en');
  await expect(comment(page, 'Empty')).toHaveText('Optional comment');
  await expectComment(page, 'Empty', '');
});

test('adds, edits, cancels, removes, and undoes comments without renaming folders or capturing native input undo', async ({ page }) => {
  await load(page, 'en', 1920);
  await importFile(page, 'Project\n    Alpha\n    Beta');
  await editComment(page, 'Alpha');
  await commentInput(page).fill('First note');
  await commentInput(page).press('Enter');
  await expectComment(page, 'Alpha', 'First note');
  await page.locator('.fs-history button').first().click();
  await expectComment(page, 'Alpha', '');
  await page.locator('.fs-history button').nth(1).click();
  await expectComment(page, 'Alpha', 'First note');

  await editComment(page, 'Alpha');
  await commentInput(page).fill('Discard this');
  await commentInput(page).press('Escape');
  await expectComment(page, 'Alpha', 'First note');
  await editComment(page, 'Alpha');
  await commentInput(page).press('End');
  await commentInput(page).pressSequentially('!');
  await expect(commentInput(page)).toHaveValue('First note!');
  await commentInput(page).press('ControlOrMeta+z');
  await expect(commentInput(page)).toHaveValue('First note');
  await expectComment(page, 'Alpha', 'First note');
  await page.getByRole('button', { name: 'Cancel comment', exact: true }).click();

  await editComment(page, 'Alpha');
  await commentInput(page).fill('Saved on blur');
  await page.locator('h1').click();
  await expect(commentInput(page)).toHaveCount(0);
  await expectComment(page, 'Alpha', 'Saved on blur');
  await editComment(page, 'Alpha');
  await commentInput(page).fill('');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await expectComment(page, 'Alpha', '');
  await expect(page.locator('.fs-preview-comment')).toHaveCount(0);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta']);
});

test('defers IME commits and rejects overlong or multiline comments without leaking unfinished text', async ({ page }) => {
  await load(page);
  await importFile(page, plain);
  await editComment(page, 'Alpha');
  await commentInput(page).dispatchEvent('compositionstart');
  await commentInput(page).fill('正在输入');
  await commentInput(page).dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(commentInput(page)).toBeVisible();
  await expectComment(page, 'Alpha', 'Original note');
  await commentInput(page).dispatchEvent('compositionend', { data: '正在输入' });
  await commentInput(page).press('Enter');
  await expectComment(page, 'Alpha', '正在输入');

  for (const invalid of ['x'.repeat(501), 'First line\nSecond line', 'Unsafe\u0001control']) {
    await editComment(page, 'Alpha');
    await commentInput(page).fill(invalid);
    await commentInput(page).press('Enter');
    await expect(commentError(page)).toBeVisible();
    await expect(commentInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(commentInput(page)).toBeFocused();
    await expectComment(page, 'Alpha', '正在输入');
    await expect(page.locator('.fs-preview-comment[title="正在输入"]')).toHaveCount(1);
    await commentInput(page).press('Escape');
  }
  await editComment(page, 'Alpha');
  const literal = '<img src=x onerror=alert(1)> // literal `text`';
  await commentInput(page).fill(literal);
  await commentInput(page).press('Enter');
  await expectComment(page, 'Alpha', literal);
  await expect(comment(page, 'Alpha').locator('img')).toHaveCount(0);
  await expect(page.locator('.fs-preview-comment img')).toHaveCount(0);
});

test('autosaves and imports version-2 JSON while legacy projects and ZIP folder paths stay compatible', async ({ page }) => {
  await load(page);
  const legacy = { version: 1, root: { id: 'root', name: 'Project', children: [{ id: 'alpha', name: 'Alpha', children: [] }] } };
  await importFile(page, JSON.stringify(legacy), 'legacy.json');
  await editComment(page, 'Alpha');
  await commentInput(page).fill('Metadata / not a folder // ✓');
  await commentInput(page).press('Enter');
  await expectComment(page, 'Alpha', 'Metadata / not a folder // ✓');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.version, DRAFT_KEY)).toBe(2);
  const expected = await saved(page);
  const json = await download(page, 3);
  expect(JSON.parse(json.toString()).version).toBe(2);
  expect(parseJSON(json.toString())).toEqual(expected);
  expect(expected.root.children[0].id).toBe('alpha');
  await page.reload();
  await expectComment(page, 'Alpha', 'Metadata / not a folder // ✓');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha']);
  const entries = unzipSync(await download(page, 0));
  expect(Object.keys(entries)).toEqual(['Project/', 'Project/Alpha/']);
  expect(Object.values(entries).every(bytes => bytes.byteLength === 0)).toBe(true);
  await importFile(page, 'Replacement');
  await importFile(page, json.toString(), 'annotated.json');
  expect(await saved(page)).toEqual(expected);
  await expect(page.locator('.fs-preview-comment')).toHaveText(['Metadata / not a folder // ✓']);
});

test('round-trips comment, rename, and move edits through all four text editors and subsequent visual edits', async ({ page }) => {
  await load(page);
  await importFile(page, plain);
  const formats = ['plain', 'markdown', 'ascii', 'unicode'] as const;
  for (const [index, format] of formats.entries()) {
    await chooseFormat(page, index);
    const input = page.locator('.fs-text-area textarea');
    expect(await input.inputValue()).toContain('Original note');
    const expected = parseText(`Project // Project note\n    Alpha${index} // Original note\n    Beta\n        Nested // Updated in ${format}`, 'plain');
    await input.fill(formatText(expected, format, 4));
    await expectSaved(page, expected);
    await expect(page.locator('.fs-preview-comment')).toHaveText(['Project note', 'Original note', `Updated in ${format}`]);
    await page.locator('.fs-editor-tabs > button').first().click();
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', `Alpha${index}`, 'Beta', 'Nested']);
  }
  await select(page, 'Alpha3');
  await action(page, 'rename').click();
  await page.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Discarded rename');
  await expect(page.locator('.fs-folder-comment[aria-label="Edit comment for Alpha3"]')).toBeDisabled();
  const canceled = await nameControlCenters(page);
  await page.mouse.click(canceled.cancel.x, canceled.cancel.y);
  await expectComment(page, 'Alpha3', 'Original note');
  await select(page, 'Alpha3');
  await action(page, 'rename').click();
  await page.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Renamed');
  const committed = await nameControlCenters(page);
  await page.mouse.click(committed.save.x, committed.save.y);
  await expectComment(page, 'Renamed', 'Original note');
  await select(page, 'Nested');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByLabel('New parent folder', { exact: true }).selectOption({ label: 'Project/Renamed' });
  await page.getByRole('button', { name: 'Move folder', exact: true }).click();
  await expect.poll(async () => details(await saved(page)).find(node => node.name === 'Nested')).toEqual({ name: 'Nested', path: 'Project/Renamed/Nested', comment: 'Updated in unicode' });
});

test('starts a native subtree drag from a populated comment cell and preserves metadata through a bottom-band move and Undo', async ({ page }) => {
  await load(page);
  await importFile(page, 'Project // Plan\n    Container // Group\n        Source // Move this annotated subtree\n            Leaf // Keep this child note');
  const before = await saved(page);
  const sourceBefore = flatten(before).find(({ node }) => node.name === 'Source')!.node;
  await page.getByRole('button', { name: 'Collapse Source', exact: true }).click();
  await expect(folder(page, 'Leaf')).toHaveCount(0);
  const cell = comment(page, 'Source');
  await cell.scrollIntoViewIfNeeded();
  const start = await cell.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    return { x, y, receivesPointer: document.elementFromPoint(x, y)?.closest('.fs-folder-comment') === button };
  });
  expect(start.receivesPointer).toBe(true);
  await page.evaluate(() => {
    const host = window as Window & { __commentDragStarts?: boolean[] };
    host.__commentDragStarts = [];
    document.addEventListener('dragstart', event => {
      if ((event.target as Element).closest('.fs-folder-comment')) host.__commentDragStarts!.push(event.isTrusted);
    }, true);
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 8, { steps: 4 });
  const band = page.locator('.fs-bottom-drop-band').filter({ has: page.getByText('After Container', { exact: true }) });
  await expect(band).toBeVisible();
  await expect(page.locator('.fs-folder-comment.is-editing')).toHaveCount(0);
  const destination = (await band.boundingBox())!;
  expect(start.x).toBeGreaterThan(destination.x);
  expect(start.x).toBeLessThan(destination.x + destination.width);
  await page.mouse.move(start.x, destination.y + destination.height / 2, { steps: 12 });
  await page.mouse.move(start.x, destination.y + destination.height / 2 + 1);
  await expect(band).toHaveClass(/is-active/);
  await expect(page.locator('.fs-drop-line.is-after')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.fs-folder-comment.is-editing')).toHaveCount(0);
  await expect.poll(async () => flatten(await saved(page)).find(({ node }) => node.id === sourceBefore.id)?.path).toBe('Project/Source');
  expect(flatten(await saved(page)).find(({ node }) => node.id === sourceBefore.id)!.node).toEqual(sourceBefore);
  expect(await page.evaluate(() => (window as Window & { __commentDragStarts?: boolean[] }).__commentDragStarts)).toEqual([true]);
  await expectComment(page, 'Source', 'Move this annotated subtree');
  await expectComment(page, 'Leaf', 'Keep this child note');
  await page.locator('.fs-history button').first().click();
  await expect.poll(() => saved(page)).toEqual(before);
  await expect(page.locator('.fs-folder-comment.is-editing')).toHaveCount(0);
});

test('updates bound template comments with language while saved canonical and user-authored notes stay unchanged', async ({ page }) => {
  await load(page, 'zh-CN');
  await expect(page.locator('.fs-folder-comment')).toHaveCount(10);
  await expect.poll(() => page.locator('.fs-folder-comment').allTextContents()).not.toEqual([]);
  expect((await page.locator('.fs-folder-comment').allTextContents()).every(value => /[^\x00-\x7f]/.test(value))).toBe(true);
  const initial = await saved(page);
  expect(flatten(initial).every(({ node }) => node.commentBinding?.source === 'folderseed-template')).toBe(true);
  await language(page, 'en');
  expect(await saved(page)).toEqual(initial);
  await expect(page.locator('.fs-folder-comment')).toHaveText(flatten(initial).map(({ node }) => node.comment!));
  await importFile(page, 'Project // Keep English\n    文件夹 // 我的说明\n    ملفاتي // لا تترجم');
  const userData = await saved(page);
  await language(page, 'ar');
  expect(await saved(page)).toEqual(userData);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', '文件夹', 'ملفاتي']);
  await expect(page.locator('.fs-folder-comment')).toHaveText(['Keep English', '我的说明', 'لا تترجم']);
  await page.locator('.fs-template').nth(3).click();
  await page.locator('dialog.fs-dialog button[type="submit"]').click();
  await expect(page.locator('.fs-folder-comment')).toHaveCount(1);
  const canonicalTemplate = await saved(page);
  expect(canonicalTemplate.root.commentBinding?.key).toBe('empty.root');
  await expect(page.locator('.fs-folder-comment')).toHaveText(/[\u0600-\u06ff]/);
  await language(page, 'en');
  expect(await saved(page)).toEqual(canonicalTemplate);
  await expect(page.locator('.fs-folder-comment')).toHaveText(canonicalTemplate.root.comment!);
});

async function geometry(page: Page, name: string) {
  return folder(page, name).evaluate(element => {
    const tree = element.closest<HTMLElement>('.fs-tree')!, origin = tree.getBoundingClientRect();
    const row = element.closest<HTMLElement>('.fs-tree-row')!, li = row.closest<HTMLElement>('.fs-tree-item')!;
    const box = (target: Element, local = false) => {
      const rect = target.getBoundingClientRect();
      return { x: rect.x + (local ? tree.scrollLeft - origin.x : window.scrollX), y: rect.y + (local ? tree.scrollTop - origin.y : window.scrollY), width: rect.width, height: rect.height };
    };
    return {
      panels: ['.fs-editor', '.fs-preview', '.fs-workspace-grid', '.fs-export'].map(selector => box(document.querySelector(selector)!)),
      row: box(row, true), glyph: box(element.querySelector('.fs-folder-icon svg')!, true), name: box(element.querySelector('.fs-folder-name')!, true),
      count: box(li.querySelector(':scope > .fs-row-count')!, true), comment: box(li.querySelector(':scope > .fs-folder-comment')!, true),
    };
  });
}
function stable(before: Awaited<ReturnType<typeof geometry>>, after: Awaited<ReturnType<typeof geometry>>) {
  for (const [index, panel] of before.panels.entries()) for (const key of ['x', 'y', 'width', 'height'] as const) expect(after.panels[index][key]).toBeCloseTo(panel[key], 1);
  for (const key of ['glyph', 'name', 'count', 'comment'] as const) for (const axis of ['x', 'y'] as const) expect(after[key][axis], `${key} ${axis}`).toBeCloseTo(before[key][axis], 1);
  for (const dimension of ['width', 'height'] as const) expect(after.comment[dimension], `comment cell ${dimension}`).toBeCloseTo(before.comment[dimension], 1);
  expect(after.row.height).toBe(34);
}
for (const { layout, locale, width, theme } of [
  { layout: 'desktop', locale: 'en', width: 1920, theme: 'light' },
  { layout: 'mobile', locale: 'en', width: 360, theme: 'light' },
  { layout: 'mobile', locale: 'ar', width: 360, theme: 'dark' },
]) {
  test(`edits comments inside the unchanged cell on ${layout} ${locale} with stationary rows and panels`, async ({ page }, testInfo) => {
    await load(page, locale, width, theme);
    const long = 'A long comment with literal details // '.repeat(12);
    await importFile(page, `Project // ${long}\n    Documents // ${long}\n        Notes // Reference\n    Empty`);
    await expect(page.locator('.fs-app')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    await expect(comment(page, 'Documents')).toHaveCSS('text-overflow', 'ellipsis');
    await expect(comment(page, 'Documents')).toHaveCSS('white-space', 'nowrap');
    const before = await geometry(page, 'Documents');
    const wide = layout === 'desktop';
    if (wide) expect(before.comment.width).toBeGreaterThanOrEqual(132);
    else expect(before.comment.width).toBeLessThan(132);
    await select(page, 'Documents');
    stable(before, await geometry(page, 'Documents'));
    await comment(page, 'Documents').click();
    const cell = comment(page, 'Documents');
    await expect(cell).toHaveClass(/is-editing/);
    expect(await cell.evaluate(element => element.tagName)).toBe('DIV');
    await expect(page.locator('.fs-comment-editor')).toHaveCount(0);
    await expect(commentInput(page)).toBeFocused();
    await expect(commentInput(page)).toHaveValue(long);
    stable(before, await geometry(page, 'Documents'));
    const bounds = (await cell.boundingBox())!;
    const inputBounds = (await commentInput(page).boundingBox())!;
    expect(inputBounds.x).toBeGreaterThanOrEqual(bounds.x);
    expect(inputBounds.x + inputBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(inputBounds.y).toBeGreaterThanOrEqual(bounds.y);
    expect(inputBounds.y + inputBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    expect(inputBounds.y + inputBounds.height / 2).toBeCloseTo(bounds.y + bounds.height / 2, 0);
    for (const selector of ['.fs-inline-save', '.fs-inline-cancel']) {
      const button = cell.locator(selector);
      if (!wide) {
        await expect(button).toBeHidden();
        continue;
      }
      await expect(button).toBeVisible();
      const target = (await button.boundingBox())!;
      expect(target.x).toBeGreaterThanOrEqual(bounds.x);
      expect(target.x + target.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(target.y).toBeGreaterThanOrEqual(bounds.y);
      expect(target.y + target.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(target.width).toBe(24);
      expect(target.height).toBe(24);
      expect(await button.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return hit === element || !!hit && element.contains(hit);
      })).toBe(true);
    }
    if (!wide) expect(inputBounds.width).toBeGreaterThanOrEqual(bounds.width - 4);
    await commentInput(page).press('End');
    await expect.poll(() => commentInput(page).evaluate(input => (input as HTMLTextAreaElement).selectionStart)).toBe(long.length);
    await expect.poll(() => commentInput(page).evaluate(input => input.scrollLeft)).toBeGreaterThan(0);
    expect(await commentInput(page).evaluate(input => input.scrollWidth > input.clientWidth)).toBe(true);
    stable(before, await geometry(page, 'Documents'));
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`comment-in-cell-${locale}-${layout}.png`) });

    await commentInput(page).fill('x'.repeat(501));
    await commentInput(page).press('Enter');
    await expect(commentError(page)).toBeVisible();
    await expect(commentInput(page)).toHaveAttribute('aria-describedby', (await commentError(page).getAttribute('id'))!);
    expect(await commentError(page).getAttribute('title')).toBe(await commentError(page).textContent());
    stable(before, await geometry(page, 'Documents'));
    await expectComment(page, 'Documents', long);
    await commentInput(page).press('Escape');
    await expect(commentInput(page)).toHaveCount(0);
    await expect(commentError(page)).toHaveCount(0);
    stable(before, await geometry(page, 'Documents'));

    await cell.click();
    await commentInput(page).fill('Changed note — 我的说明');
    if (wide) await cell.locator('.fs-inline-save').click();
    else if (locale === 'en') await commentInput(page).press('Enter');
    else await page.locator('h1').click();
    await expectComment(page, 'Documents', 'Changed note — 我的说明');
    stable(before, await geometry(page, 'Documents'));
    await clearSelection(page);
    stable(before, await geometry(page, 'Documents'));
    await expect(item(page, 'Documents').locator(':scope > .fs-row-count')).toHaveText('1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`comment-column-${locale}-${layout}.png`) });
  });
}
