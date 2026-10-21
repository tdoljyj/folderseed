import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

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
  await page.getByRole('button', { name: /^Add folder/ }).click();
  await page.getByLabel('Folder name', { exact: true }).fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Add folder', exact: true }).click();
}
async function selectFolder(page: Page, name: string) {
  await page.locator('.fs-folder-select').filter({ has: page.locator('.fs-folder-name', { hasText: new RegExp(`^${name}$`) }) }).click();
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
  await selectFolder(page, 'Beta');
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Beta', 'Notes', 'Alpha']);
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.fs-folder-select[title="Notes"]')).toBeVisible();
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await page.getByRole('button', { name: 'Remove folder', exact: true }).click();
  await expect(page.locator('.fs-folder-select[title="Beta"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.fs-folder-select[title="Notes"]')).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.fs-folder-select[title="Beta"]')).toHaveCount(0);
});

test('rejects duplicate and unsafe names without closing the edit dialog', async ({ page }) => {
  await importText(page, 'Project\n  Images');
  await page.getByRole('button', { name: /^Add folder/ }).click();
  const input = page.getByLabel('Folder name', { exact: true });
  await input.fill('images');
  await page.getByRole('dialog').getByRole('button', { name: 'Add folder', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('already');
  await input.fill('../escape');
  await page.getByRole('dialog').getByRole('button', { name: 'Add folder', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
  await page.getByRole('button', { name: /^Add folder/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('keeps templates available on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Choose a template', { exact: true }).selectOption({ label: 'Start from scratch' });
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['My project']);
  await addFolder(page, 'First folder');
  await expect(page.locator('.fs-folder-name')).toHaveText(['My project', 'First folder']);
});

test('embedded editor emits committed changes without looping on an inline host callback', async ({ page }) => {
  await page.goto('/examples/index.html');
  await expect(page.getByTestId('host-update-count')).toHaveText('1');
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
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill('- Notes');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await addFolder(page, '├── Literal');
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['- Notes', '├── Literal']);
  await chooseTextFormat(page, 'plain');
  await expect(formatButton(page)).toHaveText(formatLabels['plain']);
  await expect(page.getByRole('textbox', { name: 'Folder structure text' })).toHaveValue('- Notes\n    ├── Literal');
  await page.evaluate(() => {
    const key = 'folderseed:draft:v1';
    const stored = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...stored, textFormat: 'auto' }));
  });
  await page.reload();
  await expect(formatButton(page)).toHaveText(formatLabels['plain']);
  await expect(page.locator('.fs-preview-root')).toContainText('- Notes');
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
  const source = (await folderRow(page, 'Gamma').boundingBox())!;
  const target = (await folderRow(page, 'Alpha').boundingBox())!;
  const nested = (await folderRow(page, 'Nested').boundingBox())!;
  await page.mouse.move(source.x + source.width - 18, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width - 30, source.y + source.height / 2, { steps: 4 });
  await page.mouse.move(target.x + target.width - 20, target.y + target.height / 2, { steps: 12 });
  await page.mouse.move(target.x + target.width - 19, target.y + target.height / 2);
  await expect(folderRow(page, 'Alpha')).toHaveClass(/is-drop-target/);
  await expect(page.locator('.fs-drop-line')).toHaveCount(0);
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

test('does not apply document shortcuts inside dialogs or editable fields', async ({ page }) => {
  await importText(page, 'Project\n  Original');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const input = page.getByLabel('Folder name', { exact: true });
  await input.fill('');
  await input.pressSequentially('Changed');
  await input.press('Control+z');
  await expect(input).not.toHaveValue('Changed');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Original']);
  await page.getByRole('button', { name: 'Save name', exact: true }).focus();
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
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width - 18, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 32, box.y + box.height / 2, { steps: 4 });
}

async function hoverAfterAtDepth(page: Page, targetName: string, depth: number) {
  const tree = (await page.locator('.fs-tree').boundingBox())!;
  const target = (await folderRow(page, targetName).boundingBox())!;
  const x = tree.x + 12 + depth * 22 + 5;
  const y = target.y + target.height - 2;
  await page.mouse.move(x, y, { steps: 12 });
  // A second pointer movement ensures Chromium dispatches a dragover at the chosen boundary.
  await page.mouse.move(x + 1, y);
}

async function hoverTreeWhitespaceAtDepth(page: Page, depth: number, useTail: boolean) {
  const tree = (await page.locator('.fs-tree').boundingBox())!;
  const rows = page.locator('.fs-tree-row');
  const last = (await rows.last().boundingBox())!;
  const target = useTail ? (await page.locator('.fs-tree-tail').boundingBox())! : tree;
  const x = tree.x + 12 + depth * 22 + 5;
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
    const x = await beginStraightDownFolderDrag(page, sourceName, widthRatio);
    await expect(page.locator('.fs-bottom-drop-band')).toHaveCount(1);
    await hoverBottomBandVertically(page, x, '03 Final delivery');
    const tree = (await page.locator('.fs-tree').boundingBox())!;
    const line = (await page.locator('.fs-drop-line.is-after').boundingBox())!;
    expect(line.x - tree.x).toBeCloseTo(12 + 22, 0);
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
