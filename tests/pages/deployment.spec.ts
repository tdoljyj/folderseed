import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

test('serves every production asset below the Pages project path', async ({ page, request }) => {
  const failures: string[] = [];
  const assets: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => failures.push(request.url()));
  page.on('response', response => {
    if (response.status() >= 400) failures.push(response.url());
    assets.push(response.url());
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A little structure.');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('FolderSeed') && font.status === 'loaded'))).toBe(true);
  const icon = await page.locator('link[rel="icon"]').evaluate((element: HTMLLinkElement) => element.href);
  expect(new URL(icon).pathname).toBe('/folderseed/favicon.svg');
  const favicon = await request.get(icon);
  expect(favicon.ok()).toBe(true);
  expect(await favicon.text()).toContain('<svg');
  for (const extension of ['.js', '.css', '.ttf']) {
    expect(assets.some(url => new URL(url).pathname.endsWith(extension))).toBe(true);
  }
  expect(assets.every(url => new URL(url).pathname.startsWith('/folderseed/'))).toBe(true);
  expect(failures).toEqual([]);
});

test('edits, reloads, and downloads every format from the production app', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Plain text', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change text format', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Indentation', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Pages test\n  Assets\n    Images\n  Notes');
  await expect(page.locator('.fs-save-state')).toHaveText('Saved on this device');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document?.root?.name)).toBe('Pages test');
  await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Pages test', 'Assets', 'Images', 'Notes']);
  await page.locator('.fs-folder-select[title="Notes"]').click();
  const actions = page.getByRole('group', { name: 'Folder actions for Notes', exact: true });
  await expect(actions.getByRole('button')).toHaveCount(8);
  await actions.getByRole('button', { name: 'Move into previous sibling', exact: true }).click();
  await expect(page.locator('.fs-selected-path')).toHaveText('Pages test/Assets/Notes');
  await actions.getByRole('button', { name: 'Move to parent level', exact: true }).click();
  await expect(page.locator('.fs-selected-path')).toHaveText('Pages test/Notes');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Pages test', 'Assets', 'Images', 'Notes']);
  for (const [name, extension] of [['Folder ZIP', 'zip'], ['Plain text', 'txt'], ['Plain text', 'ascii'], ['Plain text', 'unicode'], ['Markdown', 'md'], ['Markdown', 'md-tree'], ['Project JSON', 'json'], ['Vector SVG', 'svg'], ['Image PNG', 'png']]) {
    await page.getByRole('radio', { name: new RegExp('^' + name) }).click();
    if (['txt', 'ascii', 'unicode'].includes(extension)) await page.getByLabel('Text export style', { exact: true }).selectOption(extension);
    if (['md', 'md-tree'].includes(extension)) await page.getByLabel('Markdown export style', { exact: true }).selectOption(extension);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download ' + extension.toUpperCase(), exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const suffix = ({ ascii: 'ascii.txt', unicode: 'tree.txt', 'md-tree': 'tree.md' } as Record<string, string>)[extension] ?? extension;
    expect(download.suggestedFilename()).toBe('Pages test.' + suffix);
    const bytes = await readFile((await download.path())!);
    expect(bytes.length).toBeGreaterThan(0);
    if (extension === 'zip') expect(Object.keys(unzipSync(bytes))).toEqual(['Pages test/', 'Pages test/Assets/', 'Pages test/Assets/Images/', 'Pages test/Notes/']);
    if (extension === 'txt') expect(bytes.toString()).toBe('Pages test\n    Assets\n        Images\n    Notes\n');
    if (extension === 'json') expect(JSON.parse(bytes.toString()).root.name).toBe('Pages test');
    if (extension === 'png') expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
});
