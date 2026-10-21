import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

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
async function downloadFormat(page: Page, name: string, format: string) {
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `Download ${format.toUpperCase()}`, exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
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
  test(`preserves ${name} and blocks malformed text without losing the last applied tree`, async ({ page }) => {
    await page.getByRole('tab', { name: 'Text editor', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Folder structure text' });
    await input.fill(`Root\n${indentation}Child\n${indentation}${indentation}Grandchild`);
    await expect(page.locator('.fs-preview-stats')).toContainText('3 levels');
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await input.fill('Root\n  Good\n     Bad');
    await expect(page.locator('.fs-inline-error')).toContainText('Line 3');
    await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
    await expect(page.locator('.fs-preview-row')).toHaveCount(3);
    await page.getByRole('tab', { name: 'Visual editor', exact: true }).click();
    await expect(input).toBeVisible();
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(input).toHaveValue('Root\n  Child\n    Grandchild');
    await page.getByRole('tab', { name: 'Visual editor', exact: true }).click();
    await expect(page.locator('.fs-folder-name')).toHaveText(['Root', 'Child', 'Grandchild']);
  });
}

test('persists valid structure and unfinished text drafts across refresh', async ({ page }) => {
  await importText(page, 'Saved\n  Nested');
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Saved', 'Nested']);
  await page.getByRole('tab', { name: 'Text editor', exact: true }).click();
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Saved\n  Nested\n     unfinished');
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
  expect(md.toString()).toContain('├── Assets');
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
  await expect(page.getByRole('alert')).toBeVisible();
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
  await page.getByRole('tab', { name: 'Text editor', exact: true }).click();
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Changed\n  Draft');
  await expect(page.getByTestId('host-update-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(page.getByTestId('host-update-count')).toHaveText('3');
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
  await page.getByRole('tab', { name: 'Text editor', exact: true }).click();
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

for (const [label, indent] of [['4 spaces', '    '], ['Tabs', '\t']] as const) {
  test(`keeps explicit ${label} after apply, continued editing, and refresh`, async ({ page }) => {
    await page.getByRole('tab', { name: 'Text editor', exact: true }).click();
    await page.getByLabel('Indentation', { exact: true }).selectOption({ label });
    const input = page.getByRole('textbox', { name: 'Folder structure text' });
    await input.fill(`Root\n${indent}Child`);
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await expect(input).toHaveValue(`Root\n${indent}Child`);
    await input.fill(`Root\n${indent}Child\n${indent}Another`);
    await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeEnabled();
    page.on('dialog', dialog => dialog.accept());
    await page.reload();
    await expect(page.getByLabel('Indentation', { exact: true })).toHaveValue(label === 'Tabs' ? 'tabs' : '4');
    await expect(page.getByRole('button', { name: 'Apply changes', exact: true })).toBeEnabled();
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
