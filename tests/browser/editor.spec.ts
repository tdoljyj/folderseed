import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { LIMITS } from '../../src/core';

test.use({ locale: 'en-US' });

const formatLabels: Record<string, string> = { plain: 'Plain text', markdown: 'Markdown list', ascii: 'ASCII tree', unicode: 'Unicode tree' };
const formatButton = (page: Page) => page.locator('.fs-format-activate');
async function chooseTextFormat(page: Page, format: string) {
  await page.getByRole('button', { name: 'Change text format', exact: true }).click();
  await page.getByRole('menuitemradio', { name: formatLabels[format], exact: true }).click();
}

async function pauseTestClock(page: Page) {
  // Fixed times avoid racing the host wall clock while pauseAt advances the page clock.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
}

async function importText(page: Page, text: string, name = 'structure.txt') {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/plain', buffer: Buffer.from(text) });
}
async function addFolder(page: Page, name: string) {
  await openFolderActions(page);
  await page.getByRole('button', { name: 'Add child folder', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
}
async function selectFolder(page: Page, name: string) {
  const button = page.locator('.fs-folder-select').filter({ has: page.locator('.fs-folder-name', { hasText: new RegExp(`^${name}$`) }) });
  await button.scrollIntoViewIfNeeded();
  const point = await button.evaluate(element => {
    const box = element.getBoundingClientRect();
    // Floating actions may intentionally cover part of an adjacent row; use a genuinely exposed point.
    const candidates = [[box.width / 2, box.height / 2], [10, 3], [10, box.height - 3], [box.width / 2, 3], [box.width / 2, box.height - 3]];
    for (const [x, y] of candidates) {
      // Keep clear of shared edges: the real mouse may round fractional coordinates slightly inward.
      const clear = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) =>
        document.elementFromPoint(box.x + x + dx, box.y + y + dy)?.closest('button') === element);
      if (clear) return { x, y };
    }
    throw new Error('The folder has no exposed pointer target.');
  });
  await button.click({ position: point });
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}
async function openFolderActions(page: Page, name?: string) {
  if (name !== undefined) await selectFolder(page, name);
  await expect(page.getByRole('group', { name: /^Folder actions for / })).toHaveCount(1);
}

async function waitForSavedModel(page: Page, rootName: string) {
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document?.root?.name)).toBe(rootName);
  await expect(page.locator('.fs-save-state')).toHaveText('Saved on this device');
}
async function downloadFormat(page: Page, name: string, format: string) {
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).click();
  if (['txt', 'ascii', 'unicode'].includes(format)) await page.getByLabel('Text export style', { exact: true }).selectOption(format);
  if (['md', 'md-tree'].includes(format)) await page.getByLabel('Markdown export style', { exact: true }).selectOption(format);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `Download ${format.toUpperCase()}`, exact: true }).click();
  const download = await pending;
  const extension = ({ ascii: 'ascii.txt', unicode: 'tree.txt', 'md-tree': 'tree.md' } as Record<string, string>)[format] ?? format;
  expect(download.suggestedFilename().endsWith('.' + extension)).toBe(true);
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A little structure.');
  await page.evaluate(() => document.fonts.ready);
});

test('adds, renames, moves, reorders, deletes, and restores folders', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n  Beta');
  await selectFolder(page, 'Alpha');
  await addFolder(page, 'Research');
  await expect(page.locator('.fs-folder-select[title="Research"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('Notes');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.locator('.fs-folder-select[title="Notes"]')).toBeVisible();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByLabel('New parent folder').selectOption({ label: 'Project/Beta' });
  await page.getByRole('button', { name: 'Move folder', exact: true }).click();
  await expect(page.locator('.fs-selected-path')).toContainText('Project/Beta/Notes');
  await openFolderActions(page, 'Beta');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Beta', 'Notes', 'Alpha']);
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.fs-folder-select[title="Notes"]')).toHaveCount(0);
  await expect(page.locator('.fs-folder-select[title="Beta"]')).toHaveCount(0);
  await expect(page.locator('.fs-folder-select[title="Project"]')).toHaveAttribute('aria-pressed', 'true');
  await expectEightFolderActions(page, 'Project');
  await page.locator('.fs-notice-undo').click();
  await expect(page.locator('.fs-folder-select[title="Notes"]')).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.fs-folder-select[title="Beta"]')).toHaveCount(0);
});

test('rejects duplicate and unsafe names without leaving the inline editor', async ({ page }) => {
  await importText(page, 'Project\n  Images');
  await openFolderActions(page, 'Project');
  await page.getByRole('button', { name: 'Add child folder', exact: true }).click();
  const input = page.getByLabel('Folder name', { exact: true });
  await input.fill('images');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.locator('.fs-inline-editor').getByRole('alert')).toContainText('already');
  await input.fill('../escape');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.locator('.fs-inline-editor').getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(input).toHaveCount(0);
  await expect(page.locator('.fs-inline-placeholder')).toHaveCount(0);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Images']);
});

for (const [name, indentation] of [['four spaces', '    '], ['tabs', '\t']] as const) {
  test(`automatically applies ${name} and protects the last valid tree from malformed text`, async ({ page }) => {
    await chooseTextFormat(page, 'plain');
    const input = page.getByRole('textbox', { name: 'Folder structure text' });
    const raw = `Root\n${indentation}Child\n${indentation}${indentation}Grandchild`;
    await input.fill(raw);
    await waitForSavedModel(page, 'Root');
    await expect(input).toHaveValue(raw);
    await expect(page.locator('.fs-preview-stats')).toContainText('3 levels');
    await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0);
    await input.fill('Root\n  Good\n     Bad');
    await expect(page.locator('.fs-inline-error')).toContainText('Line 3');
    await expect(page.locator('.fs-save-state')).toContainText('Draft invalid');
    await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
    await expect(page.locator('.fs-preview-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
    await expect(input).toBeVisible();
    await page.getByRole('button', { name: 'Revert text', exact: true }).click();
    await expect(page.locator('.fs-inline-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
    await expect(page.locator('.fs-folder-name')).toHaveText(['Root', 'Child', 'Grandchild']);
  });
}

test('persists valid structure and unfinished text drafts across refresh', async ({ page }) => {
  await importText(page, 'Saved\n  Nested');
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Saved', 'Nested']);
  await chooseTextFormat(page, 'plain');
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Saved\n  Nested\n     unfinished');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').draft)).toBe('Saved\n  Nested\n     unfinished');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue('Saved\n  Nested\n     unfinished');
  await expect(page.locator('.fs-inline-error')).toContainText('Line 3');
  await expect(page.locator('.fs-preview-row')).toHaveCount(2);
});

test('exports real folder ZIP and all descriptive formats, including a nonempty PNG', async ({ page }) => {
  await importText(page, 'Seed\n  Assets\n    Images\n  Notes');
  const zip = await downloadFormat(page, 'Folder ZIP', 'zip');
  const entries = unzipSync(zip);
  expect(Object.keys(entries)).toEqual(['Seed/', 'Seed/Assets/', 'Seed/Assets/Images/', 'Seed/Notes/']);
  expect(Object.values(entries).every(bytes => bytes.byteLength === 0)).toBe(true);
  const txt = await downloadFormat(page, 'Plain text', 'txt');
  expect(txt.toString()).toContain('    Images');
  const md = await downloadFormat(page, 'Markdown', 'md');
  expect(md.toString()).toMatch(/- .*Assets/);
  const json = await downloadFormat(page, 'Project JSON', 'json');
  expect(JSON.parse(json.toString()).version).toBe(1);
  await importText(page, json.toString(), 'backup.json');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Seed', 'Assets', 'Images', 'Notes']);
  const svg = await downloadFormat(page, 'Vector SVG', 'svg');
  expect(svg.toString()).toContain('<svg');
  const png = await downloadFormat(page, 'Image PNG', 'png');
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.byteLength).toBeGreaterThan(2000);
  expect(png.readUInt32BE(16)).toBeGreaterThan(400);
  expect(png.readUInt32BE(20)).toBeGreaterThan(200);
});

test('rejects untrusted imports and restores a template with undo', async ({ page }) => {
  await importText(page, 'Original\n  Keep');
  await importText(page, 'Root\n  ../escape');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Original', 'Keep']);
  await importText(page, '{"version":99,"root":{}}', 'bad.json');
  await expect(page.getByRole('alert')).toContainText('version');
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['My project']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Original', 'Keep']);
});

test('supports drag nesting and refuses a cycle', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n    Nested\n  Beta');
  const alpha = page.locator('.fs-tree-row').filter({ has: page.locator('.fs-folder-select[title="Alpha"]') });
  const beta = page.locator('.fs-tree-row').filter({ has: page.locator('.fs-folder-select[title="Beta"]') });
  await beta.dragTo(alpha);
  await selectFolder(page, 'Beta');
  await expect(page.locator('.fs-selected-path')).toContainText('Project/Alpha/Beta');
  const nested = page.locator('.fs-tree-row').filter({ has: page.locator('.fs-folder-select[title="Nested"]') });
  await alpha.dragTo(nested);
  await expect(page.locator('.fs-drop-line')).toHaveCount(0);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Nested', 'Beta']);
});

test('desktop and mobile layouts stay within the viewport without browser errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  for (const [name, width, height] of [['desktop', 1440, 1080], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
  await page.locator('.fs-folder-select').first().click();
  await openFolderActions(page);
  await page.getByRole('button', { name: 'Add child folder', exact: true }).click();
  await expect(page.getByLabel('Folder name', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await expect(page.getByLabel('Folder name', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('keeps templates available on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Choose a template', { exact: true }).selectOption({ label: 'Start from scratch' });
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['My project']);
  await selectFolder(page, 'My project');
  await addFolder(page, 'First folder');
  await expect(page.locator('.fs-folder-name')).toHaveText(['My project', 'First folder']);
});

test('embedded editor emits committed changes without looping on an inline host callback', async ({ page }) => {
  await page.goto('/examples/index.html');
  await expect(page.getByTestId('host-update-count')).toHaveText('1');
  await selectFolder(page, 'My project');
  await addFolder(page, 'Embedded folder');
  await expect(page.getByTestId('host-update-count')).toHaveText('2');
  await chooseTextFormat(page, 'plain');
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Changed\n  Draft');
  await expect(page.getByTestId('host-update-count')).toHaveText('3');
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue('Changed\n  Draft');
});

test('does not let a delayed import overwrite a newer text draft', async ({ page }) => {
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name === 'slow.txt') await new Promise<void>(resolve => { (window as unknown as { releaseImport: () => void }).releaseImport = resolve; });
      return original.call(this);
    };
  });
  await importText(page, 'Older import\n  Old child', 'slow.txt');
  await chooseTextFormat(page, 'plain');
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Newer draft\n  Keep this');
  await page.evaluate(() => (window as unknown as { releaseImport: () => void }).releaseImport());
  await expect(page.getByRole('alert')).toContainText('Import cancelled');
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue('Newer draft\n  Keep this');
});

test('preserves an unreadable stored draft before opening a fresh example', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('folderseed:draft:v1', '{broken original'));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('original is preserved');
  const preserved = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('folderseed:draft:v1:recovery:')).map(key => localStorage.getItem(key)));
  expect(preserved).toContain('{broken original');
  await expect(page.locator('.fs-folder-select[title="My creative project"]')).toBeVisible();
});

for (const [label, indent] of [['2 spaces', '  '], ['4 spaces', '    '], ['tabs', '\t']] as const) {
  test(`preserves pasted ${label}, raw text, and cursor through automatic save and refresh`, async ({ page }) => {
    await chooseTextFormat(page, 'plain');
    await chooseTextFormat(page, 'plain');
    await expect(page.getByRole('combobox', { name: 'Indentation', exact: true })).toHaveCount(0);
    await pauseTestClock(page);
    const input = page.getByRole('textbox', { name: 'Folder structure text' });
    const raw = `Root\n${indent}Child\n${indent}Another\n`;
    await input.fill(raw);
    await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(2, 2));
    await page.clock.fastForward(1000);
    await waitForSavedModel(page, 'Root');
    await expect(input).toHaveValue(raw);
    expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(2);
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Indentation', exact: true })).toHaveCount(0);
    await expect(formatButton(page)).toHaveText(formatLabels['plain']);
    await expect(input).toHaveValue(raw);
    await expect(page.locator('.fs-preview-row')).toHaveCount(3);
  });
}

test('uses the bundled Source Sans 3 wordmark without changing body typography', async ({ page }, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  for (const [name, width, height] of [['desktop', 1440, 1080], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('500 22px "FolderSeed Source Sans 3"', 'FolderSeed'))).toBe(true);
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.fs-brand-name' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(fonts.some(font => font.isCustomFont && /Source Sans 3/.test(font.familyName) && font.glyphCount > 0)).toBe(true);
    const geometry = await page.locator('.fs-brand').evaluate(el => {
      const mark = el.querySelector('.fs-brand-mark')!.getBoundingClientRect();
      const text = el.querySelector(':scope > span:last-child')!.getBoundingClientRect();
      const title = el.querySelector('.fs-brand-name')!;
      const tagline = el.querySelector('.fs-brand-subtitle')!;
      const range = document.createRange(); range.selectNodeContents(tagline);
      return {
        centerOffset: Math.abs(mark.top + mark.height / 2 - text.top - text.height / 2),
        markWidth: mark.width,
        taglineOneLine: tagline.getBoundingClientRect().height === parseFloat(getComputedStyle(tagline).lineHeight),
        taglineFits: range.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1,
        transform: getComputedStyle(title).transform,
        fontSize: getComputedStyle(title).fontSize,
        bodyFont: getComputedStyle(document.querySelector('.fs-app')!).fontFamily,
      };
    });
    expect(geometry.centerOffset).toBeLessThanOrEqual(1);
    expect(geometry.markWidth).toBe(name === 'desktop' ? 40 : 38);
    expect(geometry.taglineOneLine && geometry.taglineFits).toBe(true);
    expect(geometry.transform).toBe('none');
    expect(geometry.fontSize).toBe('22px');
    expect(geometry.bodyFont).toMatch(/^Arial/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.fs-brand').screenshot({ path: testInfo.outputPath(`brand-${name}.png`) });
  }
});

test('saves valid text automatically without replacing its whitespace', async ({ page }) => {
  await chooseTextFormat(page, 'plain');
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  const raw = 'Automatic\n\n    Assets\n        Images\n    Notes\n';
  await input.fill(raw);
  await waitForSavedModel(page, 'Automatic');
  await expect(input).toHaveValue(raw);
  await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(input).toHaveValue(raw);
  await expect(page.locator('.fs-preview-row')).toHaveCount(4);
});

test('preserves an empty invalid draft and the last valid model across refresh', async ({ page }) => {
  await importText(page, 'Keep\n  Safe');
  await chooseTextFormat(page, 'plain');
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('');
  await expect(page.locator('.fs-inline-error')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').draft)).toBe('');
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue('');
  await expect(page.locator('.fs-inline-error')).toBeVisible();
  await expect(page.locator('.fs-preview-row')).toHaveCount(2);
  await expect(page.locator('.fs-preview-root')).toContainText('Keep');
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
});

test('flushes valid pending text immediately when exporting instead of downloading stale folders', async ({ page }) => {
  await chooseTextFormat(page, 'plain');
  await pauseTestClock(page);
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Newest\n  Just added');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('Newest.zip');
  expect(Object.keys(unzipSync(await readFile((await download.path())!)))).toEqual(['Newest/', 'Newest/Just added/']);
  await waitForSavedModel(page, 'Newest');
});

test('flushes valid pending text for copy and visual navigation', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await chooseTextFormat(page, 'plain');
  await pauseTestClock(page);
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  await input.fill('Copied\n  Fresh');
  await page.getByRole('button', { name: 'Copy tree', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Copied\n└── Fresh');
  await waitForSavedModel(page, 'Copied');
  await input.fill('Visible\n  Latest');
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Visible', 'Latest']);
});

test('groups a rapid text burst into a single undo step and restores it with redo', async ({ page }) => {
  await importText(page, 'Before\n  Original');
  await chooseTextFormat(page, 'plain');
  await pauseTestClock(page);
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  await input.fill('A');
  await input.fill('After\n  New');
  await input.fill('After\n  New\n  Final');
  await page.clock.fastForward(1000);
  await waitForSavedModel(page, 'After');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(input).toHaveValue('Before\n    Original');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(input).toHaveValue('After\n    New\n    Final');
});

test('waits until IME composition ends before applying text or allowing downloads', async ({ page }) => {
  await importText(page, 'Before\n  Original');
  await chooseTextFormat(page, 'plain');
  await pauseTestClock(page);
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  await input.dispatchEvent('compositionstart', { data: '' });
  await input.fill('Composed\n  Final name');
  await page.clock.fastForward(1000);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1')!).document.root.name)).toBe('Before');
  await expect(page.locator('.fs-preview-root')).toContainText('Before');
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
  await input.dispatchEvent('compositionend', { data: 'Composed' });
  await page.clock.fastForward(1000);
  await waitForSavedModel(page, 'Composed');
  await expect(input).toHaveValue('Composed\n  Final name');
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeEnabled();
});

for (const [format, label, raw] of [
  ['markdown', 'Markdown list', '- Root\n  * Assets\n    + Images\n  - Notes'],
  ['ascii', 'ASCII tree', 'Root\n|-- Assets\n|   `-- Images\n`-- Notes'],
  ['unicode', 'Unicode tree', 'Root\n├── Assets\n│   └── Images\n└── Notes'],
] as const) {
  test(`automatically applies and restores explicit ${label} without rewriting it`, async ({ page }) => {
    await chooseTextFormat(page, 'plain');
    await chooseTextFormat(page, format);
    const input = page.getByRole('textbox', { name: 'Folder structure text' });
    await input.fill(raw);
    await waitForSavedModel(page, 'Root');
    await expect(input).toHaveValue(raw);
    await page.reload();
    await expect(formatButton(page)).toHaveText(formatLabels[format]);
    await expect(input).toHaveValue(raw);
    await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
    await expect(page.locator('.fs-folder-name')).toHaveText(['Root', 'Assets', 'Images', 'Notes']);
  });
}

test('keeps leading punctuation literal in explicit plain text mode', async ({ page }) => {
  await chooseTextFormat(page, 'plain');
  await chooseTextFormat(page, 'plain');
  const raw = '- Root\n  + Notes\n  1. Archive\n  ├── Literal';
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill(raw);
  await waitForSavedModel(page, '- Root');
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['- Root', '+ Notes', '1. Archive', '├── Literal']);
});

for (const [format, raw] of [
  ['markdown', '- Root\n  - Good\n      - Jump'],
  ['ascii', 'Root\n|-- Good\n|   missing connector'],
  ['unicode', 'Root\n├── Good\n│   missing connector'],
] as const) {
  test(`rejects malformed ${format} without replacing the last valid structure`, async ({ page }) => {
    await importText(page, 'Keep\n  Original');
    await chooseTextFormat(page, 'plain');
    await chooseTextFormat(page, format);
    await page.getByRole('textbox', { name: 'Folder structure text' }).fill(raw);
    await expect(page.locator('.fs-inline-error')).toContainText('Line 3');
    await expect(page.locator('.fs-preview-root')).toContainText('Keep');
    await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue(raw);
  });
}

test('round-trips ASCII, Unicode, Markdown list, and legacy fenced Markdown downloads', async ({ page }) => {
  for (const [card, format, filename] of [
    ['Plain text', 'ascii', 'structure.ascii.txt'],
    ['Plain text', 'unicode', 'structure.tree.txt'],
    ['Markdown', 'md', 'structure.md'],
    ['Markdown', 'md-tree', 'structure.tree.md'],
  ]) {
    await importText(page, 'Roundtrip\n  Assets\n    Images\n  Notes');
    const bytes = await downloadFormat(page, card, format);
    if (format === 'ascii') expect(bytes.toString()).toContain('|-- Assets');
    if (format === 'unicode' || format === 'md-tree') expect(bytes.toString()).toContain('├── Assets');
    if (format === 'md') expect(bytes.toString()).toMatch(/- .*Assets/);
    await importText(page, bytes.toString(), filename);
    await expect(page.locator('.fs-folder-name')).toHaveText(['Roundtrip', 'Assets', 'Images', 'Notes']);
  }
});

test('the auto-saving text controls fit on mobile and keep the selected format available', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await chooseTextFormat(page, 'plain');
  await chooseTextFormat(page, 'markdown');
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('- Mobile\n  - Notes');
  await waitForSavedModel(page, 'Mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('radio', { name: /^Plain text/ }).click();
  await page.getByLabel('Text export style', { exact: true }).selectOption('ascii');
  await expect(page.getByRole('button', { name: 'Download ASCII', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('mobile-autoapply.png'), fullPage: true });
});

test('changing the parser can recover a draft without replacing its literal text', async ({ page }) => {
  await chooseTextFormat(page, 'plain');
  await chooseTextFormat(page, 'ascii');
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  const raw = '- Literal root\n  + Literal child';
  await input.fill(raw);
  await expect(page.locator('.fs-inline-error')).toBeVisible();
  await chooseTextFormat(page, 'plain');
  await waitForSavedModel(page, '- Literal root');
  await expect(input).toHaveValue(raw);
  await expect(page.locator('.fs-inline-error')).toHaveCount(0);
});

test('rejects a folder-count overflow without applying or discarding the large draft', async ({ page }) => {
  await importText(page, 'Keep\n  Original');
  await chooseTextFormat(page, 'plain');
  const raw = 'Too many\n' + Array.from({ length: 500 }, (_, index) => `  Folder ${index}`).join('\n');
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  await input.fill(raw);
  await expect(page.locator('.fs-inline-error')).toContainText('500');
  await expect(page.locator('.fs-preview-root')).toContainText('Keep');
  await expect(input).toHaveValue(raw);
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
});

test('keeps syntax-like names created visually unchanged after refresh', async ({ page }) => {
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await openFolderActions(page, 'My project');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('- Notes');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await addFolder(page, '├── Literal');
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['- Notes', '├── Literal']);
  await chooseTextFormat(page, 'plain');
  await expect(formatButton(page)).toHaveText(formatLabels['plain']);
  // Renaming keeps the template's metadata as well as the literal folder punctuation.
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue('- Notes // The starting point for your folder structure.\n    ├── Literal');
  await page.evaluate(() => {
    const key = 'folderseed:draft:v1';
    const stored = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...stored, textFormat: 'auto' }));
  });
  await page.reload();
  await expect(formatButton(page)).toHaveText(formatLabels['plain']);
  await expect(page.locator('.fs-preview-root')).toContainText('- Notes');
  await expect(page.locator('.fs-preview-comment')).toHaveText(['The starting point for your folder structure.']);
  await expect(page.locator('.fs-save-state')).toHaveText('Saved on this device');
});

for (const name of ['Project.ascii', 'Project.tree']) {
  test(`round-trips ordinary TXT when the root name ends in ${name.split('.').pop()}`, async ({ page }) => {
    await importText(page, `${name}\n  Literal child`);
    await page.getByRole('radio', { name: /^Plain text/ }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download TXT', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`${name}.plain.txt`);
    const bytes = await readFile((await download.path())!);
    await importText(page, bytes.toString(), download.suggestedFilename());
    await expect(page.locator('.fs-folder-name')).toHaveText([name, 'Literal child']);
  });
}


test('uses four spaces for generated text and the Tab key without an indentation setting', async ({ page }) => {
  await importText(page, 'Root\n  Child\n    Grandchild');
  await chooseTextFormat(page, 'plain');
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  await expect(input).toHaveValue('Root\n  Child\n    Grandchild');
  await chooseTextFormat(page, 'markdown');
  await chooseTextFormat(page, 'plain');
  await expect(input).toHaveValue('Root\n    Child\n        Grandchild');
  await expect(page.getByRole('combobox', { name: 'Indentation', exact: true })).toHaveCount(0);
  await input.fill('Root\n');
  await input.press('End');
  await input.press('Tab');
  await input.pressSequentially('New child');
  await expect(input).toHaveValue('Root\n    New child');
  await waitForSavedModel(page, 'Root');
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Root', 'New child']);
});

test('retains an unfinished legacy draft and its explicit indentation rule', async ({ page }) => {
  await importText(page, 'Keep\n  Original');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Keep', 'Original']);
  await page.evaluate(() => {
    const key = 'folderseed:draft:v1';
    const stored = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...stored, draft: 'Root\n    Skipped level', pending: true, textFormat: 'plain', indent: 2, mode: 'text' }));
  });
  await page.reload();
  await expect(page.locator('.fs-inline-error')).toContainText('Line 2');
  await expect(page.locator('.fs-preview-root')).toContainText('Keep');
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue('Root\n    Skipped level');
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Root\n  Fixed');
  await waitForSavedModel(page, 'Root');
  await expect(page.locator('.fs-inline-error')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue('Root\n  Fixed');
});

for (const [name, width, height] of [['desktop', 1440, 1080], ['narrow', 360, 800]] as const) {
  test(`keeps the split format control and its menu within the ${name} viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await expect(formatButton(page)).toHaveText('Plain text');
    await expect(page.getByText('Choose text format', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Text editor', exact: true })).toHaveCount(0);
    await chooseTextFormat(page, 'markdown');
    await expect(formatButton(page)).toHaveText('Markdown list');
    await expect(page.getByRole('combobox', { name: 'Indentation', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const controlBox = (await page.locator('.fs-format-switch').boundingBox())!;
    expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`text-toolbar-${name}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Change text format', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Text format', exact: true });
    await expect(menu.getByRole('menuitemradio')).toHaveText(['Plain text', 'Markdown list', 'ASCII tree', 'Unicode tree']);
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`text-format-menu-${name}.png`), fullPage: true });
  });
}

for (const format of ['plain', 'markdown', 'ascii', 'unicode']) {
  test(`reopens ${format} with its label instead of its menu after visual editing`, async ({ page }) => {
    await chooseTextFormat(page, format);
    const input = page.getByRole('textbox', { name: 'Folder structure text' });
    await expect(input).toBeVisible();
    await expect(formatButton(page)).toHaveText(formatLabels[format]);
    const raw = await input.inputValue();
    await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
    await expect(input).toHaveCount(0);
    await expect(formatButton(page)).toHaveText(formatLabels[format]);
    await expect(formatButton(page)).toHaveAttribute('aria-pressed', 'false');
    await formatButton(page).click();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(raw);
    await expect(formatButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.reload();
    await expect(input).toHaveValue(raw);
    await expect(formatButton(page)).toHaveText(formatLabels[format]);
  });
}

test('preserves invalid legacy automatic drafts until a format is explicitly chosen', async ({ page }) => {
  await importText(page, 'Keep\n  Original');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Keep', 'Original']);
  const raw = '- Root\n  Child';
  await page.evaluate(raw => {
    const key = 'folderseed:draft:v1';
    const stored = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...stored, draft: raw, pending: true, textFormat: 'auto', mode: 'text' }));
  }, raw);
  await page.reload();
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  await expect(formatButton(page)).toHaveText('Plain text');
  await formatButton(page).click();
  await expect(input).toHaveValue(raw);
  await expect(page.locator('.fs-inline-error')).toBeVisible();
  await expect(page.locator('.fs-preview-root')).toContainText('Keep');
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
  await chooseTextFormat(page, 'plain');
  await waitForSavedModel(page, '- Root');
  await expect(input).toHaveValue(raw);
  await expect(formatButton(page)).toHaveText('Plain text');
});

test('opens default Plain text with one label click without showing a menu', async ({ page }) => {
  await expect(formatButton(page)).toHaveText('Plain text');
  await formatButton(page).click();
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change text format', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

test('supports menu keyboard navigation, selection, and Escape focus restoration', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Change text format', exact: true });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Plain text', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitemradio', { name: 'Unicode tree', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Plain text', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitemradio', { name: 'Unicode tree', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('m');
  await expect(page.getByRole('menuitemradio', { name: 'Markdown list', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveCount(0);
  await trigger.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(formatButton(page)).toHaveText('Unicode tree');
  await expect(formatButton(page)).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('dismisses the menu on repeated trigger, outside click, and Tab without trapping focus', async ({ page }) => {
  await formatButton(page).click();
  const trigger = page.getByRole('button', { name: 'Change text format', exact: true });
  await trigger.click();
  await trigger.click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Visual editor', exact: true })).toBeFocused();
  await formatButton(page).click();
  await trigger.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(formatButton(page)).toBeFocused();
});


test('keeps the label and chevron hit areas separate even at their shared edge', async ({ page }) => {
  const main = formatButton(page);
  const trigger = page.getByRole('button', { name: 'Change text format', exact: true });
  const labelBox = (await main.boundingBox())!;
  const arrowBox = (await trigger.boundingBox())!;
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(arrowBox.x + 1);
  await page.mouse.click(arrowBox.x + 2, arrowBox.y + arrowBox.height / 2);
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.click(labelBox.x + labelBox.width - 2, labelBox.y + labelBox.height / 2);
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
});


const folderRow = (page: Page, name: string) => page.locator('.fs-tree-row').filter({ has: page.locator('.fs-folder-select').filter({ has: page.locator('.fs-folder-name').filter({ hasText: new RegExp(`^${name}$`) }) }) });
async function dropAtRow(page: Page, source: string, target: string, placement: 'before' | 'inside' | 'after') {
  const destination = folderRow(page, target);
  const box = (await destination.boundingBox())!;
  await folderRow(page, source).dragTo(destination, { targetPosition: { x: box.width - 20, y: placement === 'before' ? 2 : placement === 'after' ? box.height - 2 : box.height / 2 } });
}

test('reorders at both row edges, preserves undo/autosave, and exports the new order', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n  Beta\n  Gamma\n  Delta');
  await expect(folderRow(page, 'Project')).toHaveAttribute('draggable', 'false');
  await dropAtRow(page, 'Delta', 'Beta', 'before');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Delta', 'Beta', 'Gamma']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta', 'Gamma', 'Delta']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await dropAtRow(page, 'Alpha', 'Beta', 'after');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Delta', 'Beta', 'Alpha', 'Gamma']);
  // An already-adjacent drop must not add an empty undo step.
  await dropAtRow(page, 'Delta', 'Beta', 'before');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Delta', 'Beta', 'Gamma']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Delta', 'Beta', 'Alpha', 'Gamma']);
  const zip = await downloadFormat(page, 'Folder ZIP', 'zip');
  expect(Object.keys(unzipSync(zip))).toEqual(['Project/', 'Project/Delta/', 'Project/Beta/', 'Project/Alpha/', 'Project/Gamma/']);
  const text = await downloadFormat(page, 'Plain text', 'txt');
  expect(text.toString()).toBe('Project\n    Delta\n    Beta\n    Alpha\n    Gamma\n');
});

test('inserts a moved subtree between children of another parent without nesting it into the target', async ({ page }) => {
  await importText(page, 'Project\n  Source\n    Moving\n      Leaf\n  Target\n    First\n    Last');
  await dropAtRow(page, 'Moving', 'Last', 'before');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Source', 'Target', 'First', 'Moving', 'Leaf', 'Last']);
  await selectFolder(page, 'Moving');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Target/Moving');
  await dropAtRow(page, 'Moving', 'First', 'after');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Source', 'Target', 'First', 'Moving', 'Leaf', 'Last']);
  await dropAtRow(page, 'Moving', 'Source', 'inside');
  await selectFolder(page, 'Leaf');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Source/Moving/Leaf');
});

test('shows the insertion line after an expanded subtree while a real pointer drag is in progress', async ({ page }, testInfo) => {
  await importText(page, 'Project\n  Alpha\n    Nested\n  Beta\n  Gamma');
  await openFolderActions(page, 'Project');
  const source = (await folderRow(page, 'Gamma').boundingBox())!;
  const target = (await folderRow(page, 'Alpha').boundingBox())!;
  const nested = (await folderRow(page, 'Nested').boundingBox())!;
  const toolbar = page.locator('.fs-context-actions');
  const toolbarBefore = (await toolbar.boundingBox())!;
  await page.mouse.move(source.x + source.width - 18, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width - 30, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + target.width - 20, target.y + target.height / 2, { steps: 12 });
  await page.mouse.move(target.x + target.width - 19, target.y + target.height / 2);
  await expect(folderRow(page, 'Alpha')).toHaveClass(/is-drop-target/);
  await expect(page.locator('.fs-drop-line')).toHaveCount(0);
  await expect(toolbar).toHaveAttribute('aria-label', 'Folder actions for Project');
  await expect(toolbar).toHaveAttribute('aria-hidden', 'true');
  for (const button of await toolbar.locator('button').all()) await expect(button).toBeDisabled();
  const toolbarDuring = (await toolbar.boundingBox())!;
  expect(toolbarDuring.y).toBeCloseTo(toolbarBefore.y, 0);
  expect(toolbarDuring.height).toBeCloseTo(toolbarBefore.height, 0);
  expect((await folderRow(page, 'Alpha').boundingBox())!.y).toBeCloseTo(target.y, 0);
  expect((await folderRow(page, 'Nested').boundingBox())!.y).toBeCloseTo(nested.y, 0);
  await page.screenshot({ path: testInfo.outputPath('drag-nest-inside.png'), fullPage: true });
  await page.mouse.move(target.x + target.width - 20, target.y + target.height - 2, { steps: 4 });
  await page.mouse.move(target.x + target.width - 19, target.y + target.height - 2);
  const line = page.locator('.fs-drop-line.is-after');
  await expect(line).toBeVisible();
  const lineBox = (await line.boundingBox())!;
  expect(lineBox.y).toBeGreaterThanOrEqual(nested.y + nested.height - 2);
  await expect(folderRow(page, 'Alpha')).not.toHaveClass(/is-drop-target/);
  await expect(page.locator('.fs-tree-help')).toContainText('Release to insert after');
  await page.screenshot({ path: testInfo.outputPath('drag-insert-after-subtree.png'), fullPage: true });
  await page.mouse.up();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Nested', 'Gamma', 'Beta']);
  await expect(page.locator('.fs-drop-line')).toHaveCount(0);
});

test('offers exact insertion positions through the keyboard-accessible Move dialog', async ({ page }) => {
  await importText(page, 'Project\n  Left\n    Moving\n      Leaf\n  Right\n    First\n    Last');
  await selectFolder(page, 'Moving');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByLabel('New parent folder', { exact: true }).selectOption({ label: 'Project/Right' });
  await page.getByLabel('Position', { exact: true }).selectOption({ label: 'Before Last' });
  await page.getByRole('button', { name: 'Move folder', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Left', 'Right', 'First', 'Moving', 'Leaf', 'Last']);
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByLabel('Position', { exact: true }).selectOption({ label: 'Before First' });
  await page.getByRole('button', { name: 'Move folder', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Left', 'Right', 'Moving', 'Leaf', 'First', 'Last']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Left', 'Right', 'First', 'Moving', 'Leaf', 'Last']);
});


test('undoes and redoes a completed drag using editor-scoped keyboard shortcuts', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n  Beta\n  Gamma');
  await dropAtRow(page, 'Gamma', 'Alpha', 'before');
  await expect(page.locator('.fs-folder-select[title="Gamma"]')).toBeFocused();
  await expectEightFolderActions(page, 'Gamma');
  const original = ['Project', 'Alpha', 'Beta', 'Gamma'];
  const moved = ['Project', 'Gamma', 'Alpha', 'Beta'];
  await expect(page.locator('.fs-folder-name')).toHaveText(moved);
  for (const [undo, redo] of [['Control+z', 'Control+Shift+z'], ['Control+z', 'Control+y'], ['Meta+z', 'Meta+Shift+z']]) {
    await page.keyboard.press(undo);
    await expect(page.locator('.fs-folder-name')).toHaveText(original);
    await page.keyboard.press(redo);
    await expect(page.locator('.fs-folder-name')).toHaveText(moved);
  }
});

test('leaves textarea undo native instead of rewriting text through document history', async ({ page }) => {
  const raw = 'Project\n  Original';
  await importText(page, raw);
  await formatButton(page).click();
  const input = page.getByRole('textbox', { name: 'Folder structure text' });
  await expect(input).toHaveValue(raw);
  await input.focus();
  await input.press('Control+End');
  await input.evaluate(element => element.addEventListener('beforeinput', event => { element.dataset.lastInputType = (event as InputEvent).inputType; }));
  // Native undo grouping is browser-dependent: test one real keystroke as one editing unit.
  await input.press('x');
  await expect(input).toHaveValue(raw + 'x');
  await expect(page.locator('.fs-save-state')).toHaveText('Saved on this device');
  await input.press('Control+z');
  // A document-history action would not produce this native event and would regenerate four spaces.
  await expect(input).toHaveAttribute('data-last-input-type', 'historyUndo');
  await expect(input).toHaveValue(raw);
  await expect(page.locator('.fs-preview-row')).toHaveCount(2);
});

test('keeps native inline undo and does not apply document shortcuts inside dialogs or editable fields', async ({ page }) => {
  await importText(page, 'Project\n  Original');
  await openFolderActions(page, 'Project');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const input = page.getByLabel('Folder name', { exact: true });
  await input.fill('');
  await input.pressSequentially('Changed');
  await input.press('Control+z');
  await expect(input).not.toHaveValue('Changed');
  await expect(page.locator('.fs-preview-row').first()).toContainText('Project');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const uncommittedName = await input.inputValue();
  await page.getByRole('button', { name: 'Save name', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect(input).toHaveValue(uncommittedName);
  await expect(page.locator('.fs-preview-row').first()).toContainText('Project');
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await selectFolder(page, 'Original');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByRole('button', { name: 'Move folder', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Original']);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => {
    const field = document.createElement('div'); field.contentEditable = 'true'; field.setAttribute('aria-label', 'Editable note'); field.setAttribute('role', 'textbox'); field.textContent = 'Note';
    document.querySelector('.fs-app')!.append(field);
  });
  const note = page.getByRole('textbox', { name: 'Editable note', exact: true });
  await note.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Changed');
  await page.keyboard.press('Control+z');
  await expect(note).toHaveText('Note');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Original']);
});

test('does not capture undo intended for controls outside the embedded editor', async ({ page }) => {
  await importText(page, 'Project\n  Original');
  await selectFolder(page, 'Project');
  await addFolder(page, 'Added');
  await page.evaluate(() => {
    const button = document.createElement('button'); button.textContent = 'Host action'; document.body.append(button);
  });
  await page.getByRole('button', { name: 'Host action', exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Original', 'Added']);
  await selectFolder(page, 'Project');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Original']);
});

async function beginPointerFolderDrag(page: Page, sourceName: string) {
  const source = folderRow(page, sourceName);
  await source.scrollIntoViewIfNeeded();
  const box = (await source.locator('.fs-folder-select').boundingBox())!;
  const x = box.x + box.width / 2;
  // The folder label is the drag handle; selected rows now place Delete at the far right.
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x - 14, box.y + box.height / 2, { steps: 4 });
}

async function pointerXAtDepth(page: Page, depth: number) {
  return page.locator('.fs-tree').evaluate((tree, desiredDepth) => {
    const style = getComputedStyle(tree), rect = tree.getBoundingClientRect();
    const leading = parseFloat(style.getPropertyValue('--fs-tree-leading'));
    const first = parseFloat(style.getPropertyValue('--fs-tree-first-indent'));
    const step = parseFloat(style.getPropertyValue('--fs-tree-indent'));
    const row = tree.querySelector('.fs-tree-row')!;
    const cornerInset = parseFloat(getComputedStyle(row).borderBottomLeftRadius) + 1;
    // Bottom-edge probes must hit the rounded row, not its transparent outer corner.
    const offset = desiredDepth <= 0 ? cornerInset : leading + first + (desiredDepth - 1) * step + step / 2;
    return rect.x + Math.max(cornerInset, offset);
  }, depth);
}

async function hoverAfterAtDepth(page: Page, targetName: string, depth: number) {
  const target = (await folderRow(page, targetName).boundingBox())!;
  const x = await pointerXAtDepth(page, depth);
  const y = target.y + target.height - 2;
  expect(await folderRow(page, targetName).evaluate((row, point) => [point.x, point.x + 1].every(x => {
    const hit = document.elementFromPoint(x, point.y);
    return hit === row || !!hit && row.contains(hit);
  }), { x, y }), 'after-edge pointer reaches the intended rounded row').toBe(true);
  await page.mouse.move(x, y, { steps: 12 });
  // A second pointer movement ensures Chromium dispatches a dragover at the chosen boundary.
  await page.mouse.move(x + 1, y);
}

async function hoverTreeWhitespaceAtDepth(page: Page, depth: number, useTail: boolean) {
  const tree = (await page.locator('.fs-tree').boundingBox())!;
  const rows = page.locator('.fs-tree-row');
  const last = (await rows.last().boundingBox())!;
  const target = useTail ? (await page.locator('.fs-tree-tail').boundingBox())! : tree;
  const x = await pointerXAtDepth(page, depth);
  const y = useTail ? target.y + target.height / 2 : Math.min(tree.y + tree.height - 12, last.y + last.height + 40);
  expect(y).toBeGreaterThan(last.y + last.height);
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.move(x + 1, y);
}

test('chooses leaf, parent, and root-child insertion levels by moving a real drag horizontally', async ({ page }, testInfo) => {
  const original = 'Project\n  Source\n  A\n    B\n      C';
  await importText(page, original);
  await beginPointerFolderDrag(page, 'Source');
  const positions: number[] = [];
  for (const [depth, name] of [[3, 'leaf'], [2, 'parent'], [1, 'root-child']] as const) {
    await hoverAfterAtDepth(page, 'C', depth);
    const line = page.locator('.fs-drop-line.is-after');
    await expect(line).toBeVisible();
    positions.push((await line.boundingBox())!.x);
    await expect(page.locator('.fs-tree-help')).toContainText(`Release to insert after ${{ 3: 'C', 2: 'B', 1: 'A' }[depth]}`);
    await page.screenshot({ path: testInfo.outputPath(`drag-outdent-${name}.png`), fullPage: true });
  }
  expect(positions[0] - positions[1]).toBeCloseTo(22, 0);
  expect(positions[1] - positions[2]).toBeCloseTo(22, 0);
  // The root itself is never a sibling destination, even when the pointer moves farther left.
  await hoverAfterAtDepth(page, 'C', 0);
  expect((await page.locator('.fs-drop-line.is-after').boundingBox())!.x).toBeCloseTo(positions[2], 0);
  // Sample the usable leftmost band, including its inner corner boundary.
  const treeLeft = (await page.locator('.fs-tree').boundingBox())!.x;
  const leafBox = (await folderRow(page, 'C').boundingBox())!;
  for (const offset of [8, 11, 20]) {
    const point = { x: treeLeft + offset, y: leafBox.y + leafBox.height - 2 };
    expect(await folderRow(page, 'C').evaluate((row, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit === row || !!hit && row.contains(hit);
    }, point)).toBe(true);
    await page.mouse.move(point.x, point.y);
    await page.mouse.move(point.x + 0.5, point.y);
    await expect(page.locator('.fs-tree-help')).toContainText('Release to insert after A');
    expect((await page.locator('.fs-drop-line.is-after').boundingBox())!.x).toBeCloseTo(positions[2], 0);
  }
  await hoverAfterAtDepth(page, 'C', 3);
  await page.mouse.up();
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/A/B/Source');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'C', 'Source']);
  for (const [depth, path] of [[2, 'Project/A/Source'], [1, 'Project/Source']] as const) {
    await importText(page, original);
    await beginPointerFolderDrag(page, 'Source');
    await hoverAfterAtDepth(page, 'C', depth);
    await page.mouse.up();
    await expect(page.locator('.fs-selected-path')).toHaveText(path);
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'C', 'Source']);
  }
});

test('clamps horizontal outdenting when the hovered child is not the end of its parent subtree', async ({ page }) => {
  await importText(page, 'Project\n  Source\n  A\n    B\n      C\n      D');
  await beginPointerFolderDrag(page, 'Source');
  await hoverAfterAtDepth(page, 'C', 3);
  const line = page.locator('.fs-drop-line.is-after');
  await expect(line).toBeVisible();
  const leafLeft = (await line.boundingBox())!.x;
  await hoverAfterAtDepth(page, 'C', 1);
  await expect(line).toBeVisible();
  expect((await line.boundingBox())!.x).toBeCloseTo(leafLeft, 0);
  await page.mouse.up();
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/A/B/Source');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'C', 'Source', 'D']);
});

test('outdents after a collapsed last ancestor from tree whitespace and tail, with undo and saved exports', async ({ page }) => {
  const original = 'Project\n  Source\n  A\n    B\n      C';
  for (const useTail of [false, true]) {
    await importText(page, original);
    await page.getByRole('button', { name: 'Collapse B', exact: true }).click();
    await expect(folderRow(page, 'C')).toHaveCount(0);
    await beginPointerFolderDrag(page, 'Source');
    await hoverTreeWhitespaceAtDepth(page, 1, useTail);
    await expect(page.locator('.fs-drop-line.is-after')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.fs-selected-path')).toHaveText('Project/Source');
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'C', 'Source']);
    await expect(page.locator('.fs-folder-select[title="Source"]')).toBeFocused();
    await page.keyboard.press('Control+z');
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Source', 'A', 'B', 'C']);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'C', 'Source']);
  }
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'C', 'Source']);
  const zip = await downloadFormat(page, 'Folder ZIP', 'zip');
  expect(Object.keys(unzipSync(zip))).toEqual(['Project/', 'Project/A/', 'Project/A/B/', 'Project/A/B/C/', 'Project/Source/']);
});

test('allows a subtree to outdent past its visible descendant without creating a cycle', async ({ page }) => {
  await importText(page, 'Project\n  A\n    B\n      Source\n        Leaf');
  await beginPointerFolderDrag(page, 'Source');
  await hoverAfterAtDepth(page, 'Leaf', 4);
  await expect(page.locator('.fs-drop-line')).toHaveCount(0);
  await hoverAfterAtDepth(page, 'Leaf', 1);
  await expect(page.locator('.fs-drop-line.is-after')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Source');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'Source', 'Leaf']);
  await selectFolder(page, 'Leaf');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Source/Leaf');
});


test('outdents the last folder by sliding left over its own bottom edge', async ({ page }) => {
  await importText(page, 'Project\n  A\n    B\n      Leaf');
  await beginPointerFolderDrag(page, 'Leaf');
  await hoverAfterAtDepth(page, 'Leaf', 1);
  await expect(page.locator('.fs-drop-line.is-after')).toBeVisible();
  await expect(page.locator('.fs-tree-help')).toContainText('Release to insert after A');
  await page.mouse.up();
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Leaf');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'Leaf']);
  await page.keyboard.press('Control+z');
  await selectFolder(page, 'Leaf');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/A/B/Leaf');
});

const bottomDropBand = (page: Page, ancestorName: string) => page.locator('.fs-bottom-drop-band').filter({ has: page.getByText(`After ${ancestorName}`, { exact: true }) });

async function beginStraightDownFolderDrag(page: Page, sourceName: string, widthRatio: number) {
  const source = folderRow(page, sourceName);
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!;
  const x = box.x + box.width * widthRatio;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Start the native drag without any sideways pointer movement.
  await page.mouse.move(x, y + 8, { steps: 4 });
  return x;
}

async function hoverBottomBandVertically(page: Page, x: number, ancestorName: string) {
  const band = bottomDropBand(page, ancestorName);
  await expect(band).toBeVisible();
  const box = (await band.boundingBox())!;
  expect(x).toBeGreaterThan(box.x);
  expect(x).toBeLessThan(box.x + box.width);
  await page.mouse.move(x, box.y + box.height / 2, { steps: 12 });
  // Chromium needs another dragover after entering a native drop target.
  await page.mouse.move(x, box.y + box.height / 2 + 1);
  await expect(band).toHaveClass(/is-active/);
  await expect(page.locator('.fs-drop-line.is-after')).toBeVisible();
  await expect(page.locator('.fs-tree-help')).toContainText(`Release to insert after ${ancestorName}`);
  const ancestorId = await folderRow(page, ancestorName).locator('.fs-folder-select').getAttribute('data-folder-id');
  await expect(band).toHaveAttribute('data-drop-target-id', ancestorId!);
}

for (const widthRatio of [0.35, 0.65, 0.9]) {
  test(`moves the collapsed final folder straight down from ${widthRatio * 100}% width and preserves its children`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const sourceName = '02 Work in progress';
    const original = 'Project\n  01 Inspiration\n    Reference\n    Moodboard\n  03 Final delivery\n    Exports\n    Archive\n    02 Work in progress\n      Drafts\n      Assets';
    await importText(page, original);
    await page.getByRole('button', { name: `Collapse ${sourceName}`, exact: true }).click();
    await expect(folderRow(page, 'Drafts')).toHaveCount(0);
    await expect(folderRow(page, 'Assets')).toHaveCount(0);
    await expect(page.locator('.fs-bottom-drop-band')).toHaveCount(0);
    // Also exercise the selected final folder, whose action frame surrounds its row.
    if (widthRatio === 0.65) await openFolderActions(page, sourceName);
    const sourceBeforeDrag = (await folderRow(page, sourceName).boundingBox())!;
    const x = await beginStraightDownFolderDrag(page, sourceName, widthRatio);
    if (widthRatio === 0.65) {
      await expect(page.locator('.fs-context-actions')).toHaveAttribute('aria-label', `Folder actions for ${sourceName}`);
      await expect(page.locator('.fs-context-actions')).toHaveAttribute('aria-hidden', 'true');
      expect((await folderRow(page, sourceName).boundingBox())!.y).toBeCloseTo(sourceBeforeDrag.y, 0);
    }
    await expect(page.locator('.fs-bottom-drop-band')).toHaveCount(1);
    await hoverBottomBandVertically(page, x, '03 Final delivery');
    const tree = (await page.locator('.fs-tree').boundingBox())!;
    const line = (await page.locator('.fs-drop-line.is-after').boundingBox())!;
    expect(line.x - tree.x).toBeCloseTo(0, 0);
    const tail = (await page.locator('.fs-tree-tail').boundingBox())!;
    const band = (await bottomDropBand(page, '03 Final delivery').boundingBox())!;
    expect(tail.height).toBeLessThanOrEqual(9);
    expect(band.y - (tail.y + tail.height)).toBeCloseTo(0, 0);
    if (widthRatio === 0.65) await page.screenshot({ path: testInfo.outputPath('drag-straight-down-collapsed-final-folder.png'), fullPage: true });
    await page.mouse.up();
    await expect(page.locator('.fs-bottom-drop-band')).toHaveCount(0);
    await expect(page.locator('.fs-selected-path')).toHaveText(`Project/${sourceName}`);
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', '01 Inspiration', 'Reference', 'Moodboard', '03 Final delivery', 'Exports', 'Archive', sourceName, 'Drafts', 'Assets']);
    await selectFolder(page, 'Drafts');
    await expect(page.locator('.fs-selected-path')).toHaveText(`Project/${sourceName}/Drafts`);
    await page.keyboard.press('Control+z');
    await selectFolder(page, sourceName);
    await expect(page.locator('.fs-selected-path')).toHaveText(`Project/03 Final delivery/${sourceName}`);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('.fs-selected-path')).toHaveText(`Project/${sourceName}`);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document?.root?.children?.map((child: { name: string }) => child.name))).toEqual(['01 Inspiration', '03 Final delivery', sourceName]);
    await page.reload();
    await selectFolder(page, 'Assets');
    await expect(page.locator('.fs-selected-path')).toHaveText(`Project/${sourceName}/Assets`);
    const zip = await downloadFormat(page, 'Folder ZIP', 'zip');
    expect(Object.keys(unzipSync(zip))).toEqual([
      'Project/', 'Project/01 Inspiration/', 'Project/01 Inspiration/Reference/', 'Project/01 Inspiration/Moodboard/',
      'Project/03 Final delivery/', 'Project/03 Final delivery/Exports/', 'Project/03 Final delivery/Archive/',
      `Project/${sourceName}/`, `Project/${sourceName}/Drafts/`, `Project/${sourceName}/Assets/`,
    ]);
  });
}

test('chooses intermediate and root-child ancestor bands using only downward movement', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const original = 'Project\n  A\n    B\n      Source\n        Leaf';
  for (const ancestor of ['B', 'A']) {
    await importText(page, original);
    await page.getByRole('button', { name: 'Collapse Source', exact: true }).click();
    const x = await beginStraightDownFolderDrag(page, 'Source', 0.65);
    await expect(page.locator('.fs-bottom-drop-band')).toHaveCount(2);
    await expect(page.locator('.fs-bottom-drop-band').nth(0)).toHaveAttribute('aria-label', 'Move out after B');
    await expect(page.locator('.fs-bottom-drop-band').nth(1)).toHaveAttribute('aria-label', 'Move out after A');
    await hoverBottomBandVertically(page, x, 'B');
    const intermediateLeft = (await page.locator('.fs-drop-line.is-after').boundingBox())!.x;
    const intermediateGuideLeft = (await bottomDropBand(page, 'B').locator('.fs-bottom-drop-guide').boundingBox())!.x;
    if (ancestor === 'B') {
      await page.screenshot({ path: testInfo.outputPath('drag-straight-down-intermediate-band.png'), fullPage: true });
    } else {
      await hoverBottomBandVertically(page, x, 'A');
      const rootLeft = (await page.locator('.fs-drop-line.is-after').boundingBox())!.x;
      const rootGuideLeft = (await bottomDropBand(page, 'A').locator('.fs-bottom-drop-guide').boundingBox())!.x;
      expect(intermediateLeft - rootLeft).toBeCloseTo(22, 0);
      expect(intermediateGuideLeft - rootGuideLeft).toBeCloseTo(22, 0);
      await page.screenshot({ path: testInfo.outputPath('drag-straight-down-root-child-band.png'), fullPage: true });
    }
    await page.mouse.up();
    await expect(page.locator('.fs-selected-path')).toHaveText(ancestor === 'B' ? 'Project/A/Source' : 'Project/Source');
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'Source', 'Leaf']);
    await selectFolder(page, 'Leaf');
    await expect(page.locator('.fs-selected-path')).toHaveText(ancestor === 'B' ? 'Project/A/Source/Leaf' : 'Project/Source/Leaf');
    await expect(page.locator('.fs-bottom-drop-band')).toHaveCount(0);
  }
});

test('bounds deep ancestor bands and removes drag-only destinations when a drag is cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const names = ['Project', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Source', 'Leaf'];
  await importText(page, names.map((name, depth) => `${'  '.repeat(depth)}${name}`).join('\n'));
  await page.getByRole('button', { name: 'Collapse Source', exact: true }).click();
  await expect(page.locator('.fs-bottom-drop-zones')).toHaveCount(0);
  await beginStraightDownFolderDrag(page, 'Source', 0.9);
  await expect(page.locator('.fs-bottom-drop-band')).toHaveCount(6);
  await expect(page.locator('.fs-bottom-drop-band').first()).toHaveAttribute('aria-label', 'Move out after Level 6');
  await expect(page.locator('.fs-bottom-drop-band').last()).toHaveAttribute('aria-label', 'Move out after Level 1');
  const zones = page.locator('.fs-bottom-drop-zones');
  expect((await zones.boundingBox())!.height).toBeLessThanOrEqual(144);
  expect(await zones.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.fs-bottom-drop-band')).toHaveCount(0);
  await expect(page.locator('.fs-bottom-drop-zones')).toHaveCount(0);
  await expect(page.locator('.fs-drop-line')).toHaveCount(0);
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Level 1/Level 2/Level 3/Level 4/Level 5/Level 6/Source');
  await expect(page.getByRole('button', { name: 'Expand Source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Source', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(names);
});


test('keeps adjacent ancestor bands and their trailing whitespace free of dead drop gaps', async ({ page }) => {
  await importText(page, 'Project\n  Other\n  A\n    B\n      C\n        Leaf');
  await page.getByRole('button', { name: 'Collapse C', exact: true }).click();
  // Keep the exact band boundary in the viewport before recording native pointer coordinates.
  await page.locator('.fs-tree').scrollIntoViewIfNeeded();
  const x = await beginStraightDownFolderDrag(page, 'Other', 0.65);
  const first = bottomDropBand(page, 'B');
  const last = bottomDropBand(page, 'A');
  await expect(first).toBeVisible();
  await expect(last).toBeVisible();
  const firstBox = (await first.boundingBox())!;
  const lastBox = (await last.boundingBox())!;
  const zoneBox = (await page.locator('.fs-bottom-drop-zones').boundingBox())!;
  expect(firstBox.y + firstBox.height).toBeCloseTo(lastBox.y, 0);
  expect(lastBox.y + lastBox.height).toBeCloseTo(zoneBox.y + zoneBox.height, 0);
  expect(lastBox.y + lastBox.height).toBeLessThan(page.viewportSize()!.height);
  await page.mouse.move(x, firstBox.y + firstBox.height - 1, { steps: 12 });
  await page.mouse.move(x + 1, firstBox.y + firstBox.height - 1);
  await expect(first).toHaveClass(/is-active/);
  await page.mouse.move(x, lastBox.y);
  await page.mouse.move(x + 1, lastBox.y);
  await expect(last).toHaveClass(/is-active/);
  await expect(page.locator('.fs-drop-line.is-after')).toBeVisible();
  // The exact bottom boundary returns to the existing horizontal whitespace target.
  const rootChildX = await pointerXAtDepth(page, 1);
  await page.mouse.move(rootChildX - 1, lastBox.y + lastBox.height, { steps: 8 });
  await page.mouse.move(rootChildX, lastBox.y + lastBox.height);
  await expect(page.locator('.fs-drop-line.is-after')).toBeVisible();
  await expect(page.locator('.fs-tree-help')).toContainText('Release to insert after A');
  await page.mouse.up();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'C', 'Leaf', 'Other']);
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Other');
});

const folderActionNames = { up: 'Move up', down: 'Move down', outdent: 'Move to parent level', indent: 'Move into previous sibling', 'add-sibling': 'Add sibling folder', 'add-child': 'Add child folder', rename: 'Rename', delete: 'Delete folder' };
const folderActions = (page: Page, name: string) => page.getByRole('group', { name: `Folder actions for ${name}`, exact: true });

async function expectEightFolderActions(page: Page, name: string) {
  const actions = folderActions(page, name);
  await expect(page.getByRole('group', { name: /^Folder actions for / })).toHaveCount(1);
  await expect(actions.locator('button')).toHaveCount(8);
  const indentName = await folderRow(page, name).evaluate(row => {
    const item = row.closest('.fs-tree-item')!;
    const siblings = [...item.parentElement!.children].filter(element => element.matches('.fs-tree-item'));
    return siblings.indexOf(item) === 0 && siblings.length > 1 ? 'Move into next sibling' : 'Move into previous sibling';
  });
  for (const [action, label] of Object.entries(folderActionNames)) {
    const actionName = action === 'indent' ? indentName : label;
    const button = actions.locator(`button[data-action="${action}"]`);
    await expect(button).toHaveAttribute('aria-label', actionName);
    if (await button.isDisabled()) {
      await expect(button).toBeHidden();
      await expect(button).toHaveCSS('visibility', 'hidden');
      await expect(button).toHaveCSS('pointer-events', 'none');
    } else {
      await expect(button).toBeVisible();
      await expect(actions.getByRole('button', { name: actionName, exact: true })).toHaveCount(1);
    }
    await expect(button.locator('svg')).toHaveCount(1);
    await expect(button.locator('svg')).toHaveAttribute('width', '16');
    await expect(button.locator('svg')).toHaveAttribute('height', '16');
  }
  await expect(actions.getByRole('button')).toHaveCount(await actions.locator('button:not(:disabled)').count());
  return actions;
}

test('retains eight action slots while showing only available selected-folder operations', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n  Beta');
  await openFolderActions(page, 'Project');
  const rootActions = await expectEightFolderActions(page, 'Project');
  for (const action of ['up', 'down', 'outdent', 'indent', 'add-sibling', 'delete']) {
    const button = rootActions.locator(`[data-action="${action}"]`);
    await expect(button).toBeDisabled();
    await expect(button).toBeHidden();
  }
  await expect(rootActions.getByRole('button')).toHaveCount(2);
  await expect(rootActions.getByRole('button', { name: 'Add child folder', exact: true })).toBeEnabled();
  await expect(rootActions.getByRole('button', { name: 'Rename', exact: true })).toBeEnabled();
  await expect(page.locator('.fs-add-folder')).toHaveCount(0);
  await openFolderActions(page, 'Alpha');
  const firstActions = await expectEightFolderActions(page, 'Alpha');
  await expect(rootActions).toHaveCount(0);
  for (const action of ['up', 'outdent']) {
    const button = firstActions.locator(`[data-action="${action}"]`);
    await expect(button).toBeDisabled();
    await expect(button).toBeHidden();
  }
  await expect(firstActions.getByRole('button')).toHaveCount(6);
  await expect(firstActions.getByRole('button', { name: 'Move into next sibling', exact: true })).toBeEnabled();
  await expect(firstActions.getByRole('button', { name: 'Move down', exact: true })).toBeEnabled();
  await openFolderActions(page, 'Beta');
  const lastActions = await expectEightFolderActions(page, 'Beta');
  await expect(lastActions.locator('[data-action="down"]')).toBeDisabled();
  await expect(lastActions.locator('[data-action="down"]')).toBeHidden();
  await expect(lastActions.getByRole('button')).toHaveCount(6);
  await expect(lastActions.getByRole('button', { name: 'Move up', exact: true })).toBeEnabled();
  await expect(lastActions.getByRole('button', { name: 'Move into previous sibling', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Move', exact: true })).toHaveCount(1);
});

test('adds a sibling immediately after the selected folder and expands a collapsed folder for its new child', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n    Existing\n  Beta');
  await openFolderActions(page, 'Alpha');
  await folderActions(page, 'Alpha').getByRole('button', { name: 'Add sibling folder', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.fs-inline-placeholder')).toBeVisible();
  await page.getByLabel('Folder name', { exact: true }).fill('Inserted');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Existing', 'Inserted', 'Beta']);
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Inserted');
  await expectEightFolderActions(page, 'Inserted');
  await page.getByRole('button', { name: 'Collapse Alpha', exact: true }).click();
  await selectFolder(page, 'Alpha');
  await expect(folderRow(page, 'Existing')).toHaveCount(0);
  await addFolder(page, 'New child');
  await expect(page.getByRole('button', { name: 'Collapse Alpha', exact: true })).toBeVisible();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Existing', 'New child', 'Inserted', 'Beta']);
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Alpha/New child');
  await expectEightFolderActions(page, 'New child');
});

test('indents and outdents complete subtrees with predictable ordering, undo, and saved reloads', async ({ page }) => {
  const original = ['Project', 'Parent', 'Before', 'Moving', 'Leaf', 'Later', 'After'];
  await importText(page, 'Project\n  Parent\n    Before\n    Moving\n      Leaf\n    Later\n  After');
  await openFolderActions(page, 'Moving');
  await folderActions(page, 'Moving').getByRole('button', { name: 'Move to parent level', exact: true }).click();
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Moving');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Parent', 'Before', 'Later', 'Moving', 'Leaf', 'After']);
  await expect(folderActions(page, 'Moving').locator('[data-action="outdent"]')).toBeDisabled();
  await expect(folderActions(page, 'Moving').locator('[data-action="outdent"]')).toBeHidden();
  await folderActions(page, 'Moving').getByRole('button', { name: 'Move into previous sibling', exact: true }).click();
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Parent/Moving');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Parent', 'Before', 'Later', 'Moving', 'Leaf', 'After']);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Moving');
  await expect(page.locator('.fs-folder-select[title="Moving"]')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Parent/Moving');
  await expect(page.locator('.fs-folder-select[title="Moving"]')).toBeFocused();
  await expect(page.locator('.fs-folder-name')).toHaveText(original);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.fs-folder-select[title="Moving"]')).toBeFocused();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Parent/Moving');
  await expect(page.locator('.fs-folder-select[title="Moving"]')).toBeFocused();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Parent', 'Before', 'Later', 'Moving', 'Leaf', 'After']);
  await folderActions(page, 'Moving').getByRole('button', { name: 'Move to parent level', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document?.root?.children?.map((child: { name: string }) => child.name))).toEqual(['Parent', 'Moving', 'After']);
  await page.reload();
  await selectFolder(page, 'Leaf');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Moving/Leaf');
  const zip = await downloadFormat(page, 'Folder ZIP', 'zip');
  expect(Object.keys(unzipSync(zip))).toEqual(['Project/', 'Project/Parent/', 'Project/Parent/Before/', 'Project/Parent/Later/', 'Project/Moving/', 'Project/Moving/Leaf/', 'Project/After/']);
});

type ActionBox = { x: number; y: number; width: number; height: number };
const boxCenter = (box: ActionBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

async function folderAnchor(page: Page, name: string) {
  return folderRow(page, name).evaluate(row => {
    const tree = row.closest('.fs-tree')!;
    const treeBox = tree.getBoundingClientRect();
    const glyph = row.querySelector('.fs-folder-icon svg')!.getBoundingClientRect();
    const label = row.querySelector('.fs-folder-name')!.getBoundingClientRect();
    // Compare tree-content coordinates so browser auto-scrolling is not mistaken for reindentation.
    return { glyphX: glyph.x - treeBox.x + tree.scrollLeft, nameX: label.x - treeBox.x + tree.scrollLeft, glyphY: glyph.y - treeBox.y + tree.scrollTop, nameY: label.y - treeBox.y + tree.scrollTop, glyphWidth: glyph.width, viewportGlyphX: glyph.x, viewportNameX: label.x, viewportGlyphY: glyph.y, viewportNameY: label.y, scrollLeft: tree.scrollLeft, scrollTop: tree.scrollTop };
  });
}

async function expectFolderAnchor(page: Page, name: string, before: Awaited<ReturnType<typeof folderAnchor>>, checkViewport = false) {
  const after = await folderAnchor(page, name);
  expect(after.glyphX, `${name} folder glyph must not shift horizontally`).toBeCloseTo(before.glyphX, 1);
  expect(after.nameX, `${name} folder name must not shift horizontally`).toBeCloseTo(before.nameX, 1);
  expect(after.glyphY, `${name} folder glyph must not shift vertically`).toBeCloseTo(before.glyphY, 1);
  expect(after.nameY, `${name} folder name must not shift vertically`).toBeCloseTo(before.nameY, 1);
  expect(after.glyphWidth, `${name} folder glyph keeps its original size`).toBe(20);
  if (checkViewport) {
    expect(after.scrollLeft, `${name} ordinary row must not trigger horizontal scrolling`).toBe(before.scrollLeft);
    expect(after.scrollTop, `${name} ordinary row must not trigger vertical scrolling`).toBe(before.scrollTop);
    expect(after.viewportGlyphY, `${name} folder glyph stays at the same viewport Y`).toBeCloseTo(before.viewportGlyphY, 1);
    expect(after.viewportNameY, `${name} folder name stays at the same viewport Y`).toBeCloseTo(before.viewportNameY, 1);
    expect(after.viewportGlyphX, `${name} folder glyph stays at the same viewport X`).toBeCloseTo(before.viewportGlyphX, 1);
    expect(after.viewportNameX, `${name} folder name stays at the same viewport X`).toBeCloseTo(before.viewportNameX, 1);
  }
}

async function workspaceLayout(page: Page) {
  return page.evaluate(() => Object.fromEntries(['.fs-editor', '.fs-preview', '.fs-workspace-grid', '.fs-export', '.fs-selection-summary'].map(selector => {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    return [selector, { y: box.y + window.scrollY, height: box.height }];
  })));
}

async function treeLayout(page: Page) {
  return page.locator('.fs-tree').evaluate(tree => {
    const origin = tree.getBoundingClientRect();
    return { scrollHeight: tree.scrollHeight, rows: [...tree.querySelectorAll('.fs-tree-row')].map(row => {
      const box = row.getBoundingClientRect();
      return { name: row.querySelector('.fs-folder-name')!.textContent, y: box.y - origin.y + tree.scrollTop, height: box.height };
    }) };
  });
}

async function expectActionsReceivePointer(page: Page, name: string) {
  const actions = await expectEightFolderActions(page, name);
  for (const button of await actions.locator('button:not(:disabled)').all()) {
    await expect(button).toBeVisible();
    await expect.poll(() => button.evaluate(element => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === element;
    }), { message: `${await button.getAttribute('aria-label')} must receive pointer hits rather than a covered row` }).toBe(true);
  }
}

async function expectInlineControlsInsideTree(page: Page) {
  const geometry = await page.locator('.fs-inline-editor').evaluate(editor => {
    const tree = editor.closest<HTMLElement>('.fs-tree')!;
    const treeBox = tree.getBoundingClientRect();
    const left = treeBox.left + tree.clientLeft;
    return {
      left, right: left + tree.clientWidth, scrollLeft: tree.scrollLeft,
      controls: [...editor.querySelectorAll('input, button')].map(control => {
        const box = control.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          name: control.getAttribute('aria-label'), button: control.tagName === 'BUTTON',
          x: box.x, y: box.y, width: box.width, height: box.height,
          receivesPointer: hit === control || !!hit && control.contains(hit),
        };
      }),
    };
  });
  expect(geometry.controls.map(control => control.name)).toEqual(['Folder name', 'Save name', 'Cancel editing']);
  for (const control of geometry.controls) {
    expect(control.x, `${control.name} starts inside the tree without test-driven scrolling`).toBeGreaterThanOrEqual(geometry.left - 0.5);
    expect(control.x + control.width, `${control.name} ends inside the tree without test-driven scrolling`).toBeLessThanOrEqual(geometry.right + 0.5);
    expect(control.receivesPointer, `${control.name} receives a real center pointer hit`).toBe(true);
    if (control.button) {
      expect(control.width, `${control.name} target width`).toBe(24);
      expect(control.height, `${control.name} target height`).toBe(24);
    }
  }
  expect(await page.locator('.fs-tree').evaluate(tree => tree.scrollLeft)).toBe(geometry.scrollLeft);
  return boxCenter(geometry.controls.find(control => control.name === 'Cancel editing')!);
}

async function expectSpatialFolderActions(page: Page, name: string) {
  const actions = await expectEightFolderActions(page, name);
  const frame = page.locator('.fs-folder-frame.has-actions');
  await expect(frame).toHaveCount(1);
  await frame.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await actions.boundingBox())!.y - (await frame.boundingBox())!.y).toBeCloseTo(-17, 0);
  const frameBox = (await frame.boundingBox())!;
  const groupBox = (await actions.boundingBox())!;
  const row = folderRow(page, name);
  const glyphBox = (await row.locator('.fs-folder-icon svg').boundingBox())!;
  const nameBox = (await row.locator('.fs-folder-name').boundingBox())!;
  const glyph = boxCenter(glyphBox);
  const boxes: Record<string, ActionBox> = {};
  for (const action of ['up', 'down', 'outdent', 'indent', 'add-sibling', 'add-child', 'rename', 'delete']) {
    boxes[action] = await actions.locator(`[data-action="${action}"]`).evaluate(element => {
      // Hidden unavailable actions must retain their exact spatial slot.
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    const box = boxes[action];
    expect(box.width, `${action} uniform target width`).toBe(24);
    expect(box.height, `${action} uniform target height`).toBe(24);
    expect(box.x).toBeGreaterThanOrEqual(frameBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
    expect(box.y).toBeGreaterThanOrEqual(groupBox.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(groupBox.y + groupBox.height + 1);
  }
  // Compare controls with the actual folder SVG, not the row or a detached toolbar.
  expect(boxCenter(boxes.up).x).toBeCloseTo(glyph.x, 0);
  expect(boxCenter(boxes.down).x).toBeCloseTo(glyph.x, 0);
  expect(boxes.up.y + boxes.up.height).toBeLessThanOrEqual(glyphBox.y);
  expect(boxes.down.y).toBeGreaterThanOrEqual(glyphBox.y + glyphBox.height);
  for (const action of ['outdent', 'indent', 'delete']) expect(boxCenter(boxes[action]).y).toBeCloseTo(glyph.y, 0);
  expect(boxes.outdent.x + boxes.outdent.width).toBeLessThanOrEqual(glyphBox.x);
  expect(boxes.indent.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width - 1);
  expect(boxes.delete.x).toBeGreaterThanOrEqual(boxes.indent.x + boxes.indent.width);
  expect(boxes.rename.y + boxes.rename.height).toBeLessThanOrEqual(nameBox.y);
  for (const action of ['rename', 'add-sibling', 'add-child']) {
    expect(boxCenter(boxes[action]).x).toBeGreaterThanOrEqual(nameBox.x);
    expect(boxCenter(boxes[action]).x).toBeLessThanOrEqual(nameBox.x + nameBox.width);
  }
  for (const action of ['add-sibling', 'add-child']) expect(boxes[action].y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
  expect(boxes['add-sibling'].x + boxes['add-sibling'].width).toBeLessThanOrEqual(boxes['add-child'].x);
  const entries = Object.entries(boxes);
  for (let first = 0; first < entries.length; first++) {
    for (let second = first + 1; second < entries.length; second++) {
      const [firstName, a] = entries[first];
      const [secondName, b] = entries[second];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX <= 0.5 || overlapY <= 0.5, `${firstName} must not overlap ${secondName}`).toBe(true);
    }
  }
  expect(frameBox.height).toBe(34);
  expect(groupBox.height).toBe(68);
  expect(groupBox.y).toBeCloseTo(frameBox.y - 17, 0);
  expect(await actions.evaluate(element => element.closest('.fs-tree') === null)).toBe(true);
  await expectActionsReceivePointer(page, name);
  expect(groupBox.width).toBeGreaterThan(0);
  expect(groupBox.height).toBeGreaterThan(0);
  const previousFrame = (await folderRow(page, 'Alpha').locator('..').boundingBox())!;
  const childFrame = (await folderRow(page, 'Working files').locator('..').boundingBox())!;
  expect(previousFrame.y + previousFrame.height).toBeLessThanOrEqual(frameBox.y);
  expect(childFrame.y).toBeGreaterThanOrEqual(frameBox.y + frameBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.fs-tree').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(row.locator('.fs-folder-name')).toHaveCSS('text-overflow', 'ellipsis');
  return actions;
}

for (const [layout, width, theme] of [
  ['desktop', 1440, 'light'], ['mobile', 360, 'light'],
  ['desktop', 1440, 'dark'], ['mobile', 360, 'dark'],
] as const) {
  test(`arranges selected-folder actions around the actual folder and name on ${theme} ${layout}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: layout === 'mobile' ? 1000 : 1100 });
    await page.evaluate(theme => localStorage.setItem('folderseed:theme:v1', theme), theme);
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.fs-app')).toHaveAttribute('data-theme', theme);
    const longName = 'Client deliverables — approved photography and campaign artwork';
    await importText(page, `Project\n  Alpha\n  ${longName}\n    Working files\n  Omega`);
    const longNameAnchor = await folderAnchor(page, longName);
    await openFolderActions(page, longName);
    await expectFolderAnchor(page, longName, longNameAnchor);
    const actions = await expectSpatialFolderActions(page, longName);
    await page.screenshot({ path: testInfo.outputPath(`spatial-folder-actions-${layout}-${theme}.png`), fullPage: true });
    await selectFolder(page, 'Alpha');
    await expectFolderAnchor(page, longName, longNameAnchor);
    await page.keyboard.press('Escape');
    await expectFolderAnchor(page, longName, longNameAnchor);
    if (layout === 'mobile' && theme === 'light') {
      await selectFolder(page, longName);
      await actions.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.getByLabel('Folder name', { exact: true }).fill('Approved deliverables');
      await page.getByRole('button', { name: 'Save name', exact: true }).click();
      await expect(page.locator('.fs-selected-path')).toHaveText('Project/Approved deliverables');
    }
  });
}

test('freezes the selected-folder action frame while another folder is dragged', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await importText(page, 'Project\n  Alpha\n    Nested\n  Beta\n  Gamma');
  await openFolderActions(page, 'Alpha');
  const frame = page.locator('.fs-folder-frame.has-actions');
  const frameBefore = (await frame.boundingBox())!;
  const targetBefore = (await folderRow(page, 'Alpha').boundingBox())!;
  const nestedBefore = (await folderRow(page, 'Nested').boundingBox())!;
  const betaBefore = (await folderRow(page, 'Beta').boundingBox())!;
  await beginPointerFolderDrag(page, 'Gamma');
  const treeBox = (await page.locator('.fs-tree').boundingBox())!;
  const blankX = treeBox.x + treeBox.width - 18;
  expect(blankX).toBeGreaterThan(frameBefore.x + frameBefore.width);
  // The compact frame must not create a dead drag area to its right.
  await page.mouse.move(blankX, targetBefore.y + targetBefore.height / 2, { steps: 12 });
  await page.mouse.move(blankX + 1, targetBefore.y + targetBefore.height / 2);
  await expect(folderRow(page, 'Alpha')).toHaveClass(/is-drop-target/);
  await expect(page.locator('.fs-drop-line')).toHaveCount(0);
  await page.mouse.move(blankX, targetBefore.y + targetBefore.height - 2, { steps: 6 });
  await page.mouse.move(blankX + 1, targetBefore.y + targetBefore.height - 2);
  const actions = page.locator('.fs-context-actions');
  await expect(actions).toHaveAttribute('aria-label', 'Folder actions for Alpha');
  await expect(actions).toHaveAttribute('aria-hidden', 'true');
  for (const button of await actions.locator('button').all()) await expect(button).toBeDisabled();
  const frameDuring = (await frame.boundingBox())!;
  expect(frameDuring.y).toBeCloseTo(frameBefore.y, 0);
  expect(frameDuring.height).toBeCloseTo(frameBefore.height, 0);
  expect((await folderRow(page, 'Alpha').boundingBox())!.y).toBeCloseTo(targetBefore.y, 0);
  expect((await folderRow(page, 'Nested').boundingBox())!.y).toBeCloseTo(nestedBefore.y, 0);
  expect((await folderRow(page, 'Beta').boundingBox())!.y).toBeCloseTo(betaBefore.y, 0);
  const line = page.locator('.fs-drop-line.is-after');
  await expect(line).toBeVisible();
  expect((await line.boundingBox())!.y).toBeGreaterThanOrEqual(nestedBefore.y + nestedBefore.height - 2);
  await page.screenshot({ path: testInfo.outputPath('spatial-folder-actions-drag-frozen.png'), fullPage: true });
  await page.mouse.up();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Nested', 'Gamma', 'Beta']);
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Gamma');
});

test('inserts before or after the complete subtree at selected-row edges beneath the floating controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const placement of ['before', 'after'] as const) {
    await importText(page, 'Project\n  Alpha\n    Nested\n  Beta\n  Gamma');
    await openFolderActions(page, 'Alpha');
    const frame = page.locator('.fs-folder-frame.has-actions');
    const frameBox = (await frame.boundingBox())!;
    const nested = (await folderRow(page, 'Nested').boundingBox())!;
    await beginPointerFolderDrag(page, 'Gamma');
    const x = frameBox.x + frameBox.width / 2;
    const y = placement === 'before' ? frameBox.y + 2 : frameBox.y + frameBox.height - 2;
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.move(x + 1, y);
    const line = page.locator(`.fs-drop-line.is-${placement}`);
    await expect(line).toBeVisible();
    await expect(folderRow(page, 'Alpha')).not.toHaveClass(/is-drop-target/);
    if (placement === 'after') expect((await line.boundingBox())!.y).toBeGreaterThanOrEqual(nested.y + nested.height - 2);
    else expect((await line.boundingBox())!.y).toBeCloseTo(frameBox.y, 0);
    await page.mouse.up();
    await expect(page.locator('.fs-folder-name')).toHaveText(placement === 'before'
      ? ['Project', 'Gamma', 'Alpha', 'Nested', 'Beta']
      : ['Project', 'Alpha', 'Nested', 'Gamma', 'Beta']);
    await expect(page.locator('.fs-selected-path')).toHaveText('Project/Gamma');
  }
});

async function expectNoFolderSelection(page: Page) {
  await expect(page.locator('.fs-folder-select[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('.fs-tree-row.is-selected')).toHaveCount(0);
  await expect(page.locator('.fs-context-actions')).toHaveCount(0);
  await expect(page.locator('.fs-folder-frame.has-actions')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit folder actions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close folder actions', exact: true })).toHaveCount(0);
  await expect(page.locator('.fs-selected-path')).toHaveCount(0);
  await expect(page.locator('.fs-selection-summary')).toHaveClass(/is-empty/);
  await expect(page.getByRole('button', { name: 'Move', exact: true })).toHaveCount(0);
}

test('shows actions on selection, clears with Escape, and starts fresh documents unselected', async ({ page }) => {
  await expectNoFolderSelection(page);
  await importText(page, 'Project\n  Alpha\n    Leaf\n  Beta');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Leaf', 'Beta']);
  await expectNoFolderSelection(page);
  await selectFolder(page, 'Alpha');
  await expect(page.locator('.fs-folder-select[aria-pressed="true"]')).toHaveCount(1);
  await expect(folderRow(page, 'Alpha')).toHaveClass(/is-selected/);
  await expectEightFolderActions(page, 'Alpha');
  await expect(page.getByRole('button', { name: 'Edit folder actions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close folder actions', exact: true })).toHaveCount(0);
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Alpha');
  await expect(page.getByRole('button', { name: 'Move', exact: true })).toBeVisible();
  await selectFolder(page, 'Beta');
  await expect(folderRow(page, 'Alpha')).not.toHaveClass(/is-selected/);
  await expect(folderRow(page, 'Beta')).toHaveClass(/is-selected/);
  await expectEightFolderActions(page, 'Beta');
  await page.keyboard.press('Escape');
  await expectNoFolderSelection(page);
  await folderRow(page, 'Alpha').locator('.fs-folder-select').focus();
  await page.keyboard.press('Enter');
  await expectEightFolderActions(page, 'Alpha');
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Leaf', 'Beta']);
  await expectNoFolderSelection(page);
  await selectFolder(page, 'Alpha');
  await importText(page, 'Replacement\n  Child');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Replacement', 'Child']);
  await expectNoFolderSelection(page);
  await selectFolder(page, 'Child');
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['My project']);
  await expectNoFolderSelection(page);
});

test('clears selection from genuine tree and editor whitespace while keeping keyboard history available', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n  Beta');
  await selectFolder(page, 'Alpha');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('Renamed');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expectEightFolderActions(page, 'Renamed');
  const tree = page.locator('.fs-tree');
  await tree.scrollIntoViewIfNeeded();
  const treeBox = (await tree.boundingBox())!;
  const blank = { x: treeBox.x + treeBox.width / 2, y: treeBox.y + treeBox.height - 10 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('fs-tree'), blank)).toBe(true);
  await page.mouse.click(blank.x, blank.y);
  await expectNoFolderSelection(page);
  expect(await page.locator('.fs-editor').evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta']);
  await expectNoFolderSelection(page);
  await selectFolder(page, 'Alpha');
  const editor = page.locator('.fs-editor');
  const editorBox = (await editor.boundingBox())!;
  await editor.click({ position: { x: 2, y: editorBox.height / 2 } });
  await expectNoFolderSelection(page);
  expect(await editor.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Renamed', 'Beta']);
  await expectNoFolderSelection(page);
});

test('keeps selection for row gaps, disclosures, action controls, and modal interactions', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n    Leaf\n  Beta');
  await selectFolder(page, 'Alpha');
  const actions = await expectEightFolderActions(page, 'Alpha');
  const frame = page.locator('.fs-folder-frame.has-actions');
  const frameBox = (await frame.boundingBox())!;
  const deleteBox = (await actions.locator('[data-action="delete"]').boundingBox())!;
  // A gap immediately above Delete still belongs to the selected row, not editor whitespace.
  await page.mouse.click(deleteBox.x + deleteBox.width / 2, frameBox.y + 4);
  await expectEightFolderActions(page, 'Alpha');
  await page.getByRole('button', { name: 'Collapse Alpha', exact: true }).click();
  await expect(folderRow(page, 'Leaf')).toHaveCount(0);
  await expectEightFolderActions(page, 'Alpha');
  await page.getByRole('button', { name: 'Expand Alpha', exact: true }).click();
  await expect(folderRow(page, 'Leaf')).toBeVisible();
  await expectEightFolderActions(page, 'Alpha');
  await actions.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Folder name', { exact: true }).fill('Temporary');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Folder name', { exact: true })).toHaveCount(0);
  await expectEightFolderActions(page, 'Alpha');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Alpha');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByLabel('Position', { exact: true }).selectOption('end');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectEightFolderActions(page, 'Alpha');
});

test('selects a dragged folder without showing floating actions until the drag ends', async ({ page }) => {
  await importText(page, 'Project\n  Alpha\n  Beta\n  Gamma');
  await expectNoFolderSelection(page);
  const alphaBefore = (await folderRow(page, 'Alpha').boundingBox())!;
  const betaBefore = (await folderRow(page, 'Beta').boundingBox())!;
  const gammaBefore = (await folderRow(page, 'Gamma').boundingBox())!;
  await beginPointerFolderDrag(page, 'Gamma');
  await page.mouse.move(alphaBefore.x + alphaBefore.width - 20, alphaBefore.y + 2, { steps: 12 });
  await page.mouse.move(alphaBefore.x + alphaBefore.width - 19, alphaBefore.y + 2);
  await expect(page.locator('.fs-folder-select[title="Gamma"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fs-context-actions')).toHaveCount(0);
  for (const [name, before] of [['Alpha', alphaBefore], ['Beta', betaBefore], ['Gamma', gammaBefore]] as const) {
    const during = (await folderRow(page, name).boundingBox())!;
    expect(during.y).toBeCloseTo(before.y, 0);
    expect(during.height).toBeCloseTo(before.height, 0);
  }
  await expect(page.locator('.fs-drop-line.is-before')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Gamma', 'Alpha', 'Beta']);
  await expectEightFolderActions(page, 'Gamma');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Gamma');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta', 'Gamma']);
});

for (const [layout, width, theme] of [
  ['desktop', 1440, 'light'], ['mobile', 360, 'light'],
  ['desktop', 1440, 'dark'], ['mobile', 360, 'dark'],
] as const) {
  test(`shows floating actions without moving folders and dismisses them from blank space on ${theme} ${layout}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: layout === 'mobile' ? 1000 : 1100 });
    await page.evaluate(theme => localStorage.setItem('folderseed:theme:v1', theme), theme);
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.fs-app')).toHaveAttribute('data-theme', theme);
    await importText(page, 'Project\n  Alpha\n  References\n    Working files\n  Omega');
    await expectNoFolderSelection(page);
    const initialLayout = await treeLayout(page);
    const initialWorkspace = await workspaceLayout(page);
    for (const row of initialLayout.rows) expect(row.height).toBe(34);
    for (const name of ['Project', 'Alpha', 'Working files']) {
      const before = await folderAnchor(page, name);
      await selectFolder(page, name);
      await expectFolderAnchor(page, name, before, true);
      expect(await treeLayout(page)).toEqual(initialLayout);
      expect(await workspaceLayout(page)).toEqual(initialWorkspace);
      await selectFolder(page, 'Omega');
      await expectFolderAnchor(page, name, before, true);
      expect(await treeLayout(page)).toEqual(initialLayout);
      expect(await workspaceLayout(page)).toEqual(initialWorkspace);
      await page.keyboard.press('Escape');
      await expectFolderAnchor(page, name, before, true);
      expect(await treeLayout(page)).toEqual(initialLayout);
      expect(await workspaceLayout(page)).toEqual(initialWorkspace);
    }
    await page.getByRole('button', { name: 'Collapse References', exact: true }).click();
    await expect(folderRow(page, 'Working files')).toHaveCount(0);
    const collapsedAnchor = await folderAnchor(page, 'References');
    const collapsedLayout = await treeLayout(page);
    await selectFolder(page, 'References');
    await expectFolderAnchor(page, 'References', collapsedAnchor, true);
    expect(await treeLayout(page)).toEqual(collapsedLayout);
    await selectFolder(page, 'Omega');
    await expectFolderAnchor(page, 'References', collapsedAnchor, true);
    expect(await treeLayout(page)).toEqual(collapsedLayout);
    await page.keyboard.press('Escape');
    await expectFolderAnchor(page, 'References', collapsedAnchor, true);
    expect(await treeLayout(page)).toEqual(collapsedLayout);
    await page.getByRole('button', { name: 'Expand References', exact: true }).click();
    await page.locator('.fs-tree').evaluate(tree => { tree.scrollLeft = 0; tree.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`folder-unselected-${layout}-${theme}.png`), fullPage: true });
    const before = await folderAnchor(page, 'References');
    await selectFolder(page, 'References');
    await expectFolderAnchor(page, 'References', before, true);
    expect(await treeLayout(page)).toEqual(initialLayout);
    expect(await workspaceLayout(page)).toEqual(initialWorkspace);
    const targetWidth = 24;
    await expectSpatialFolderActions(page, 'References');
    const frameBox = (await page.locator('.fs-folder-frame.has-actions').boundingBox())!;
    const row = folderRow(page, 'References');
    const nameBox = (await row.locator('.fs-folder-name').boundingBox())!;
    const renderedName = await row.locator('.fs-folder-name').evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const { x, width } = range.getBoundingClientRect();
      return { x, width };
    });
    const indentBox = (await folderActions(page, 'References').locator('[data-action="indent"]').boundingBox())!;
    expect(indentBox.x - (nameBox.x + nameBox.width)).toBeGreaterThanOrEqual(-1);
    expect(indentBox.x - (nameBox.x + nameBox.width)).toBeLessThanOrEqual(2);
    expect(indentBox.x - (renderedName.x + renderedName.width)).toBeLessThanOrEqual(44);
    expect(frameBox.width).toBeLessThanOrEqual(54 + 28 + targetWidth * 2 + Math.max(targetWidth * 2, renderedName.width) + 4);
    await expect(page.getByRole('button', { name: 'Edit folder actions', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close folder actions', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`folder-actions-compact-${layout}-${theme}.png`), fullPage: true });
    await page.locator('.fs-tree-tail').click();
    await expectNoFolderSelection(page);
    await expectFolderAnchor(page, 'References', before, true);
    expect(await treeLayout(page)).toEqual(initialLayout);
    expect(await workspaceLayout(page)).toEqual(initialWorkspace);
    await page.screenshot({ path: testInfo.outputPath(`folder-deselected-${layout}-${theme}.png`), fullPage: true });
  });
}

for (const [layout, width] of [['desktop', 1440], ['mobile', 360]] as const) {
  test(`keeps glyph and name anchors at every supported depth on ${layout}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 1100 });
    const names = Array.from({ length: LIMITS.depth + 1 }, (_, depth) => `Level ${depth}`);
    await importText(page, names.map((name, depth) => `${'  '.repeat(depth)}${name}`).join('\n'));
    await expect(page.locator('.fs-folder-name')).toHaveText(names);
    const anchors = await Promise.all(names.map(name => folderAnchor(page, name)));
    const initialLayout = await treeLayout(page);
    for (const row of initialLayout.rows) expect(row.height).toBe(34);
    for (const [depth, name] of names.entries()) {
      expect(anchors[depth].glyphX).toBeCloseTo(layout === 'mobile' ? (depth === 0 ? 25 : 41 + (depth - 1) * 14) : (depth === 0 ? 25 : 49 + (depth - 1) * 22), 1);
      expect(anchors[depth].nameX).toBeCloseTo(layout === 'mobile' ? (depth === 0 ? 51 : 67 + (depth - 1) * 14) : (depth === 0 ? 53 : 77 + (depth - 1) * 22), 1);
      await selectFolder(page, name);
      await expect(folderActions(page, name)).toBeVisible();
      await expectFolderAnchor(page, name, anchors[depth]);
      expect(await treeLayout(page)).toEqual(initialLayout);
      const otherDepth = depth === 0 ? 1 : 0;
      await selectFolder(page, names[otherDepth]);
      await expectFolderAnchor(page, name, anchors[depth]);
      expect(await treeLayout(page)).toEqual(initialLayout);
      await expectFolderAnchor(page, names[otherDepth], anchors[otherDepth]);
      await page.keyboard.press('Escape');
      await expectNoFolderSelection(page);
      await expectFolderAnchor(page, name, anchors[depth]);
      expect(await treeLayout(page)).toEqual(initialLayout);
    }
    await selectFolder(page, names[LIMITS.depth]);
    const unavailableChild = folderActions(page, names[LIMITS.depth]).locator('[data-action="add-child"]');
    await expect(unavailableChild).toBeDisabled();
    await expect(unavailableChild).toBeHidden();
    await expectFolderAnchor(page, names[LIMITS.depth], anchors[LIMITS.depth]);
    expect(await page.locator('.fs-tree').evaluate(tree => tree.scrollWidth > tree.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const [layout, width] of [['desktop', 1440], ['mobile', 360]] as const) {
  test(`routes floating controls above adjacent rows and outside the tree edges on ${layout}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    await importText(page, 'Project\n  Previous\n  Selected\n  Next');
    await selectFolder(page, 'Selected');
    const previous = (await folderRow(page, 'Previous').boundingBox())!;
    const rename = folderActions(page, 'Selected').getByRole('button', { name: 'Rename', exact: true });
    const renameBox = (await rename.boundingBox())!;
    const coveredPoint = boxCenter(renameBox);
    expect(coveredPoint.y).toBeGreaterThan(previous.y);
    expect(coveredPoint.y).toBeLessThan(previous.y + previous.height);
    await expectActionsReceivePointer(page, 'Selected');
    await page.screenshot({ path: testInfo.outputPath(`floating-actions-overlap-${layout}.png`), fullPage: true });
    // Use a real pointer click in the covered row, not a forced or synthetic button action.
    await page.mouse.click(coveredPoint.x, coveredPoint.y);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Folder name', { exact: true })).toHaveValue('Selected');
    await expectInlineControlsInsideTree(page);
    await page.screenshot({ path: testInfo.outputPath(`inline-rename-${layout}.png`), fullPage: true });
    await inlineName(page).fill('../invalid');
    await inlineName(page).press('Enter');
    await expect(inlineError(page)).toBeVisible();
    const errorBounds = await inlineError(page).evaluate(error => {
      const tree = error.closest<HTMLElement>('.fs-tree')!;
      const left = tree.getBoundingClientRect().left + tree.clientLeft;
      const box = error.getBoundingClientRect();
      return { left, right: left + tree.clientWidth, x: box.x, width: box.width };
    });
    expect(errorBounds.x).toBeGreaterThanOrEqual(errorBounds.left - 0.5);
    expect(errorBounds.x + errorBounds.width).toBeLessThanOrEqual(errorBounds.right + 0.5);
    await expectInlineControlsInsideTree(page);
    await page.screenshot({ path: testInfo.outputPath(`inline-invalid-name-${layout}.png`), fullPage: true });
    // Full-page capture can resize the viewport and shift inner scroll positions; hit-test fresh coordinates.
    const renameCancel = await expectInlineControlsInsideTree(page);
    await page.mouse.click(renameCancel.x, renameCancel.y);
    await expect(inlineName(page)).toHaveCount(0);
    await expect(page.locator('.fs-selected-path')).toHaveText('Project/Selected');
    await expect(folderRow(page, 'Previous').locator('.fs-folder-select')).toHaveAttribute('aria-pressed', 'false');

    await selectFolder(page, 'Project');
    await expectActionsReceivePointer(page, 'Project');
    const tree = page.locator('.fs-tree');
    const rootRename = (await folderActions(page, 'Project').getByRole('button', { name: 'Rename', exact: true }).boundingBox())!;
    expect(boxCenter(rootRename).y).toBeLessThan((await tree.boundingBox())!.y);
    await page.mouse.click(boxCenter(rootRename).x, boxCenter(rootRename).y);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Folder name', { exact: true })).toHaveValue('Project');
    const rootCancel = await expectInlineControlsInsideTree(page);
    await page.mouse.click(rootCancel.x, rootCancel.y);
    await expect(inlineName(page)).toHaveCount(0);

    const names = Array.from({ length: 24 }, (_, index) => `Folder ${String(index + 1).padStart(2, '0')}`);
    await importText(page, ['Project', ...names.map(name => `  ${name}`)].join('\n'));
    await selectFolder(page, 'Folder 24');
    await tree.evaluate(element => {
      const row = [...element.querySelectorAll('.fs-tree-row')].find(row => row.querySelector('.fs-folder-name')?.textContent === 'Folder 24')!;
      element.scrollTop += row.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom;
    });
    const bottomRow = folderRow(page, 'Folder 24');
    await expect.poll(async () => (await folderActions(page, 'Folder 24').boundingBox())!.y - (await bottomRow.boundingBox())!.y).toBeCloseTo(-17, 0);
    expect((await bottomRow.boundingBox())!.y + 34).toBeCloseTo((await tree.boundingBox())!.y + (await tree.boundingBox())!.height, 0);
    await expectActionsReceivePointer(page, 'Folder 24');
    const addChild = folderActions(page, 'Folder 24').getByRole('button', { name: 'Add child folder', exact: true });
    const addPoint = boxCenter((await addChild.boundingBox())!);
    expect(addPoint.y).toBeGreaterThan((await tree.boundingBox())!.y + (await tree.boundingBox())!.height);
    await page.screenshot({ path: testInfo.outputPath(`floating-actions-bottom-edge-${layout}.png`), fullPage: true });
    await page.mouse.click(addPoint.x, addPoint.y);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.fs-inline-placeholder')).toBeVisible();
    await expect(page.getByLabel('Folder name', { exact: true })).toBeFocused();
    await expectInlineControlsInsideTree(page);
    await page.screenshot({ path: testInfo.outputPath(`inline-add-child-${layout}.png`), fullPage: true });
    const addCancel = await expectInlineControlsInsideTree(page);
    await page.mouse.click(addCancel.x, addCancel.y);
    await expect(inlineName(page)).toHaveCount(0);
    await expect(page.locator('.fs-inline-placeholder')).toHaveCount(0);

    await selectFolder(page, 'Folder 08');
    await tree.evaluate(element => {
      const row = [...element.querySelectorAll('.fs-tree-row')].find(row => row.querySelector('.fs-folder-name')?.textContent === 'Folder 08')!;
      element.scrollTop += row.getBoundingClientRect().y - element.getBoundingClientRect().y - 100;
    });
    const anchor = folderRow(page, 'Folder 08');
    await expect.poll(async () => (await folderActions(page, 'Folder 08').boundingBox())!.y - (await anchor.boundingBox())!.y).toBeCloseTo(-17, 0);
    const beforeScroll = (await folderActions(page, 'Folder 08').boundingBox())!;
    await tree.evaluate(element => { element.scrollTop += 34; });
    await expect.poll(async () => (await folderActions(page, 'Folder 08').boundingBox())!.y).toBeCloseTo(beforeScroll.y - 34, 0);
    await expectActionsReceivePointer(page, 'Folder 08');
    await folderActions(page, 'Folder 08').getByRole('button', { name: 'Rename', exact: true }).focus();
    await tree.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('.fs-floating-actions')).toHaveCount(0);
    await expect(page.locator('.fs-editor')).toBeFocused();
    await expect(anchor.locator('.fs-folder-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.fs-selected-path')).toHaveText('Project/Folder 08');
    await tree.evaluate(element => { element.scrollTop = 170; });
    await expect(folderActions(page, 'Folder 08')).toBeVisible();
    await expect.poll(async () => (await folderActions(page, 'Folder 08').boundingBox())!.y - (await anchor.boundingBox())!.y).toBeCloseTo(-17, 0);
    await expectActionsReceivePointer(page, 'Folder 08');
  });
}

const inlineName = (page: Page) => page.getByRole('textbox', { name: 'Folder name', exact: true });
const inlineError = (page: Page) => page.locator('.fs-inline-editor').getByRole('alert');
const savedDocument = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document);

test('renames inline with Enter and blur while preserving descendants, history, and autosave', async ({ page }) => {
  await importText(page, 'Project\n  Parent\n    Child\n  Later');
  await selectFolder(page, 'Parent');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(inlineName(page)).toHaveValue('Parent');
  await expect(inlineName(page)).toHaveAttribute('dir', 'auto');
  await inlineName(page).fill('Renamed parent');
  await expect(page.locator('.fs-preview-row')).toHaveCount(4);
  await expect(page.locator('.fs-preview-row').nth(1)).toContainText('Parent');
  await inlineName(page).press('Enter');
  await expect(inlineName(page)).toHaveCount(0);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Renamed parent', 'Child', 'Later']);
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Renamed parent');
  await expect(page.locator('.fs-folder-select[title="Renamed parent"]')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Parent', 'Child', 'Later']);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Renamed parent', 'Child', 'Later']);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await inlineName(page).fill('Committed on blur');
  await page.locator('.fs-preview h2').click();
  await expect(inlineName(page)).toHaveCount(0);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Committed on blur', 'Child', 'Later']);
  await expect.poll(async () => (await savedDocument(page)).root.children[0].name).toBe('Committed on blur');
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Committed on blur', 'Child', 'Later']);
  await expectNoFolderSelection(page);
});

test('cancels add placeholders without saving a folder or adding an undo step', async ({ page }) => {
  await importText(page, 'Before\n  Original');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Before', 'Original']);
  await importText(page, 'Project\n  Alpha\n  Beta');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta']);
  await expect.poll(async () => (await savedDocument(page))?.root?.name).toBe('Project');
  const before = await savedDocument(page);
  for (const cancellation of ['Escape', 'Cancel editing'] as const) {
    await selectFolder(page, 'Alpha');
    await page.getByRole('button', { name: 'Add sibling folder', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.fs-inline-placeholder')).toHaveCount(1);
    await inlineName(page).fill('Not committed');
    expect(await savedDocument(page)).toEqual(before);
    await expect(page.locator('.fs-preview-row')).toHaveCount(3);
    await expect(page.locator('.fs-preview-row').filter({ hasText: 'Not committed' })).toHaveCount(0);
    if (cancellation === 'Escape') await inlineName(page).press('Escape');
    else await page.getByRole('button', { name: cancellation, exact: true }).click();
    await expect(page.locator('.fs-inline-placeholder')).toHaveCount(0);
    await expect(inlineName(page)).toHaveCount(0);
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta']);
    expect(await savedDocument(page)).toEqual(before);
  }
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Before', 'Original']);
  await page.keyboard.press('Control+Shift+z');
  await selectFolder(page, 'Alpha');
  await page.getByRole('button', { name: 'Add child folder', exact: true }).click();
  await inlineName(page).fill('Unsaved placeholder');
  await expect(page.locator('.fs-save-state')).toContainText('Editing folder name');
  const warningPromise = page.waitForEvent('dialog');
  const reload = page.reload();
  const warning = await warningPromise;
  expect(warning.type()).toBe('beforeunload');
  await warning.accept();
  await reload;
  await expect(page.locator('.fs-inline-placeholder')).toHaveCount(0);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta']);
});

test('keeps invalid inline names focused until corrected without changing the last valid document', async ({ page }) => {
  await importText(page, 'Project\n  Images');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Images']);
  await expect.poll(async () => (await savedDocument(page))?.root?.name).toBe('Project');
  const before = await savedDocument(page);
  await selectFolder(page, 'Project');
  await page.getByRole('button', { name: 'Add child folder', exact: true }).click();
  for (const invalid of ['images', '../escape', '']) {
    await inlineName(page).fill(invalid);
    await page.locator('.fs-preview h2').click();
    await expect(inlineError(page)).toBeVisible();
    await expect(inlineName(page)).toBeFocused();
    await expect(inlineName(page)).toHaveValue(invalid);
    expect(await savedDocument(page)).toEqual(before);
    await expect(page.locator('.fs-preview-row')).toHaveCount(2);
  }
  await inlineName(page).fill('Safe folder');
  await page.locator('.fs-preview h2').click();
  await expect(inlineName(page)).toHaveCount(0);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Images', 'Safe folder']);
  await expect.poll(async () => (await savedDocument(page)).root.children.map((child: { name: string }) => child.name)).toEqual(['Images', 'Safe folder']);
});

test('does not commit an inline name while an input-method composition is active', async ({ page }) => {
  await importText(page, 'Project');
  await selectFolder(page, 'Project');
  await page.getByRole('button', { name: 'Add child folder', exact: true }).click();
  const before = await savedDocument(page);
  await inlineName(page).dispatchEvent('compositionstart');
  await inlineName(page).fill('新しいフォルダー');
  await inlineName(page).press('Enter');
  await expect(inlineName(page)).toBeVisible();
  await expect(page.locator('.fs-inline-placeholder')).toHaveCount(1);
  expect(await savedDocument(page)).toEqual(before);
  await expect(page.locator('.fs-preview-row')).toHaveCount(1);
  await inlineName(page).dispatchEvent('compositionend', { data: '新しいフォルダー' });
  await expect(inlineName(page)).toBeVisible();
  await inlineName(page).press('Enter');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', '新しいフォルダー']);
  await expect(inlineName(page)).toHaveCount(0);
  await expect(page.locator('.fs-folder-select[title="新しいフォルダー"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.fs-folder-name')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project']);
});


test('keeps a menu opened by valid inline blur and prevents collapsing an invalid inline descendant', async ({ page }) => {
  await importText(page, 'Project\n  Parent\n    Child\n  Sibling');
  await selectFolder(page, 'Parent');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await inlineName(page).fill('Renamed parent');
  await page.getByRole('button', { name: 'Change text format', exact: true }).click();
  await expect(inlineName(page)).toHaveCount(0);
  await expect(page.getByRole('menu', { name: 'Text format', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change text format', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Renamed parent', 'Child', 'Sibling']);
  await page.keyboard.press('Escape');
  await selectFolder(page, 'Child');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await inlineName(page).fill('../invalid');
  await page.getByRole('button', { name: 'Collapse Renamed parent', exact: true }).click();
  await expect(inlineError(page)).toBeVisible();
  await expect(inlineName(page)).toBeVisible();
  await expect(inlineName(page)).toBeFocused();
  await expect(inlineName(page)).toHaveValue('../invalid');
  await expect(page.getByRole('button', { name: 'Collapse Renamed parent', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse Renamed parent', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand Renamed parent', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.fs-folder-select[title="Child"]')).toHaveCount(0);
});
