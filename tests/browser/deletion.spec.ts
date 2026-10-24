import { expect, test, type Page } from '@playwright/test';
import type { DirectoryDocument } from '../../src/core';

test.use({ locale: 'en-US' });

const DRAFT_KEY = 'folderseed:draft:v1';
const ORIGINAL = 'Project\n  Before\n  Branch\n    Child\n      Leaf\n  After';
const ORIGINAL_NAMES = ['Project', 'Before', 'Branch', 'Child', 'Leaf', 'After'];
const folderNames = (page: Page) => page.locator('.fs-folder-name');
const deleteButton = (page: Page) => page.locator('.fs-context-actions [data-action="delete"]');
const noticeUndo = (page: Page) => page.locator('.fs-notice-undo');
const historyUndo = (page: Page) => page.locator('.fs-history').getByRole('button', { name: 'Undo', exact: true });

async function savedDocument(page: Page): Promise<DirectoryDocument | undefined> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document, DRAFT_KEY);
}
async function importText(page: Page, text: string): Promise<DirectoryDocument> {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'deletion-test.plain.txt', mimeType: 'text/plain', buffer: Buffer.from(text),
  });
  await expect(folderNames(page)).toHaveText(text.split('\n').map(line => line.trim()));
  await expect.poll(async () => (await savedDocument(page))?.root.name).toBe(text.split('\n')[0]);
  return (await savedDocument(page))!;
}
async function selectFolder(page: Page, name: string) {
  const button = page.locator('.fs-folder-select').filter({
    has: page.locator('.fs-folder-name', { hasText: new RegExp(`^${name}$`) }),
  });
  // Keyboard selection avoids neighboring floating controls while exercising a real user action.
  await button.focus();
  await button.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(deleteButton(page)).toBeAttached();
  if (await deleteButton(page).isEnabled()) await expect(deleteButton(page)).toBeVisible();
  else await expect(deleteButton(page)).toBeHidden();
}
async function deleteFolder(page: Page, name: string) {
  await selectFolder(page, name);
  await deleteButton(page).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator(`.fs-folder-select[title="${name}"]`)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', 'en');
  await page.evaluate(() => document.fonts.ready);
});

test('one click removes the complete subtree without confirmation and notice Undo restores its original position', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  const before = await importText(page, ORIGINAL);
  await deleteFolder(page, 'Branch');
  await expect(folderNames(page)).toHaveText(['Project', 'Before', 'After']);
  await expect(page.locator('.fs-folder-select[title="Project"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.fs-delete-notice[role="status"]')).toContainText('Folder removed. You can undo this.');
  await expect(noticeUndo(page)).toHaveAccessibleName('Undo');
  await expect(noticeUndo(page)).toBeEnabled();
  await noticeUndo(page).click();
  await expect(folderNames(page)).toHaveText(ORIGINAL_NAMES);
  await expect.poll(() => savedDocument(page)).toEqual(before);
  await expect(noticeUndo(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(nativeDialogs).toEqual([]);
});

for (const shortcut of ['Control+z', 'Meta+z']) {
  test(`${shortcut} restores a deleted subtree and its sibling position`, async ({ page }) => {
    const before = await importText(page, ORIGINAL);
    await deleteFolder(page, 'Branch');
    await expect(page.locator('.fs-folder-select[title="Project"]')).toBeFocused();
    await page.keyboard.press(shortcut);
    await expect(folderNames(page)).toHaveText(ORIGINAL_NAMES);
    await expect.poll(() => savedDocument(page)).toEqual(before);
    await expect(noticeUndo(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('the root cannot be deleted', async ({ page }) => {
  const before = await importText(page, ORIGINAL);
  await selectFolder(page, 'Project');
  await expect(deleteButton(page)).toBeDisabled();
  await expect(deleteButton(page)).toBeHidden();
  await page.keyboard.press('Delete');
  await expect(folderNames(page)).toHaveText(ORIGINAL_NAMES);
  expect(await savedDocument(page)).toEqual(before);
  await expect(noticeUndo(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('repeated deletes expose Undo for only the latest deletion', async ({ page }) => {
  const text = 'Project\n  Alpha\n    Alpha child\n  Beta\n    Beta child\n  Gamma';
  const before = await importText(page, text);
  await deleteFolder(page, 'Alpha');
  await deleteFolder(page, 'Beta');
  await expect(folderNames(page)).toHaveText(['Project', 'Gamma']);
  await expect(noticeUndo(page)).toHaveCount(1);
  await noticeUndo(page).click();
  await expect(folderNames(page)).toHaveText(['Project', 'Beta', 'Beta child', 'Gamma']);
  await expect(noticeUndo(page)).toHaveCount(0);
  await historyUndo(page).click();
  await expect(folderNames(page)).toHaveText(text.split('\n').map(line => line.trim()));
  await expect.poll(() => savedDocument(page)).toEqual(before);
});

test('starting an intervening rename invalidates stale notice Undo without undoing that edit', async ({ page }) => {
  const before = await importText(page, 'Project\n  Alpha\n  Beta');
  await deleteFolder(page, 'Alpha');
  await expect(noticeUndo(page)).toBeVisible();
  await selectFolder(page, 'Beta');
  await page.locator('.fs-context-actions [data-action="rename"]').click();
  await expect(noticeUndo(page)).toHaveCount(0);
  await page.getByLabel('Folder name', { exact: true }).fill('Renamed');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(folderNames(page)).toHaveText(['Project', 'Renamed']);
  await expect(noticeUndo(page)).toHaveCount(0);
  await historyUndo(page).click();
  await expect(folderNames(page)).toHaveText(['Project', 'Beta']);
  await expect(noticeUndo(page)).toHaveCount(0);
  await historyUndo(page).click();
  await expect(folderNames(page)).toHaveText(['Project', 'Alpha', 'Beta']);
  await expect.poll(() => savedDocument(page)).toEqual(before);
});

test('dismissing the deletion message leaves ordinary history Undo available', async ({ page }) => {
  const before = await importText(page, ORIGINAL);
  await deleteFolder(page, 'Branch');
  await page.locator('.fs-delete-notice').getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await expect(page.locator('.fs-delete-notice')).toHaveCount(0);
  await expect(noticeUndo(page)).toHaveCount(0);
  await historyUndo(page).click();
  await expect(folderNames(page)).toHaveText(ORIGINAL_NAMES);
  await expect.poll(() => savedDocument(page)).toEqual(before);
});

for (const invalidName of ['../escape', 'Before']) {
  test(`an invalid inline name (${invalidName}) keeps deletion unavailable and preserves the subtree`, async ({ page }) => {
    const before = await importText(page, ORIGINAL);
    await selectFolder(page, 'Branch');
    await page.locator('.fs-context-actions [data-action="rename"]').click();
    const input = page.getByLabel('Folder name', { exact: true });
    await input.fill(invalidName);
    // Floating actions are intentionally unavailable until inline naming is resolved.
    await expect(deleteButton(page)).toHaveCount(0);
    const otherFolder = page.locator('.fs-folder-select[title="After"]');
    await otherFolder.click();
    await expect(otherFolder).toHaveAttribute('aria-pressed', 'false');
    await expect(input).toHaveValue(invalidName);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.fs-inline-editor').getByRole('alert')).toBeVisible();
    await expect(input).toBeFocused();
    await expect(deleteButton(page)).toHaveCount(0);
    await expect(page.locator('.fs-folder-select[title="Leaf"]')).toBeVisible();
    expect(await savedDocument(page)).toEqual(before);
    await expect(noticeUndo(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await input.press('Escape');
    await expect(folderNames(page)).toHaveText(ORIGINAL_NAMES);
    await deleteButton(page).click();
    await expect(folderNames(page)).toHaveText(['Project', 'Before', 'After']);
    await noticeUndo(page).click();
    await expect.poll(() => savedDocument(page)).toEqual(before);
  });
}

test('Chinese UI localizes immediate deletion and Undo without changing folder names', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('folderseed:language:v1', 'zh-CN'));
  await page.reload();
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', 'zh-CN');
  await page.evaluate(() => document.fonts.ready);
  const before = await importText(page, 'Project\n  Keep\n  Folder\n    Nested');
  await selectFolder(page, 'Folder');
  await expect(deleteButton(page)).toHaveAccessibleName('删除文件夹');
  await deleteButton(page).click();
  await expect(folderNames(page)).toHaveText(['Project', 'Keep']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.fs-delete-notice[role="status"]')).toContainText('已删除文件夹。可以撤销此操作。');
  await expect(noticeUndo(page)).toHaveAccessibleName('撤销');
  await noticeUndo(page).click();
  await expect(folderNames(page)).toHaveText(['Project', 'Keep', 'Folder', 'Nested']);
  await expect.poll(() => savedDocument(page)).toEqual(before);
});

for (const [label, width, height] of [['desktop', 1440, 1080], ['mobile', 390, 844]] as const) {
  test(`${label} deletion notice stays within the viewport without moving editor frames`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await importText(page, ORIGINAL);
    await deleteFolder(page, 'Branch');
    const notice = page.locator('.fs-delete-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCSS('position', 'fixed');
    const box = (await notice.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    const frames = page.locator('.fs-workspace-grid, .fs-editor, .fs-preview, .fs-export');
    const before = await frames.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    await page.screenshot({ path: testInfo.outputPath(`deletion-notice-${label}.png`), animations: 'disabled' });
    await notice.locator('.fs-notice-dismiss').click();
    await expect(notice).toHaveCount(0);
    const after = await frames.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(after).toHaveLength(before.length);
    for (let index = 0; index < before.length; index++) {
      for (const dimension of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(after[index][dimension] - before[index][dimension])).toBeLessThan(1);
      }
    }
  });
}
