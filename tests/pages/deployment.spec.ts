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
  await page.getByRole('tab', { name: 'Text editor', exact: true }).click();
  await page.getByRole('textbox', { name: 'Folder structure text' }).fill('Pages test\n  Assets\n    Images\n  Notes');
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await page.getByRole('tab', { name: 'Visual editor', exact: true }).click();
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Pages test', 'Assets', 'Images', 'Notes']);
  for (const [name, extension] of [['Folder ZIP', 'zip'], ['Plain text', 'txt'], ['Markdown', 'md'], ['Project JSON', 'json'], ['Vector SVG', 'svg'], ['Image PNG', 'png']]) {
    await page.getByRole('radio', { name: new RegExp('^' + name) }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download ' + extension.toUpperCase(), exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toBe('Pages test.' + extension);
    const bytes = await readFile((await download.path())!);
    expect(bytes.length).toBeGreaterThan(0);
    if (extension === 'zip') expect(Object.keys(unzipSync(bytes))).toEqual(['Pages test/', 'Pages test/Assets/', 'Pages test/Assets/Images/', 'Pages test/Notes/']);
    if (extension === 'json') expect(JSON.parse(bytes.toString()).root.name).toBe('Pages test');
    if (extension === 'png') expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }
});
