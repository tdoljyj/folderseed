import { expect, test, type Page } from '@playwright/test';
import type { DirectoryDocument } from '../../src/core';

test.use({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });

const actions = (page: Page, name: string) => page.getByRole('group', { name: `Folder actions for ${name}`, exact: true });
const folder = (page: Page, name: string) => page.locator('.fs-folder-select').filter({ has: page.locator('.fs-folder-name', { hasText: new RegExp(`^${name}$`) }) });

async function savedDocument(page: Page): Promise<DirectoryDocument> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document);
}

async function loadFixture(page: Page, text: string) {
  await page.goto('/');
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', 'en');
  await page.locator('input[type="file"]').setInputFiles({ name: 'structure.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('.fs-folder-name')).toHaveText(text.split('\n').map(name => name.trim()));
  await expect.poll(async () => (await savedDocument(page))?.root?.name).toBe('Project');
}

async function selectFolder(page: Page, name: string) {
  // Clear any floating controls before selecting a different row with a real pointer.
  await page.keyboard.press('Escape');
  await folder(page, name).click();
  await expect(folder(page, name)).toHaveAttribute('aria-pressed', 'true');
  await expect(actions(page, name)).toBeVisible();
}

test('appends the first sibling subtree inside its collapsed next sibling and preserves exact undo history', async ({ page }) => {
  await loadFixture(page, 'Project\n  First\n    Leaf\n  Next\n    Existing A\n    Existing B\n  Last');
  const original = await savedDocument(page);
  const firstId = original.root.children[0].id;
  const expected = structuredClone(original);
  const [first] = expected.root.children.splice(0, 1);
  expected.root.children[0].children.push(first);
  await page.getByRole('button', { name: 'Collapse Next', exact: true }).click();
  await expect(folder(page, 'Existing A')).toHaveCount(0);
  await selectFolder(page, 'First');
  const indent = actions(page, 'First').getByRole('button', { name: 'Move into next sibling', exact: true });
  await expect(indent).toBeEnabled();
  await expect(indent).toHaveAttribute('title', 'Move inside the next sibling folder');
  await indent.click();
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Next/First');
  await expect(folder(page, 'First')).toHaveAttribute('data-folder-id', firstId);
  await expect(folder(page, 'First')).toHaveAttribute('aria-pressed', 'true');
  await expect(folder(page, 'First')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Collapse Next', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Next', 'Existing A', 'Existing B', 'First', 'Leaf', 'Last']);
  await expect.poll(() => savedDocument(page)).toEqual(expected);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/First');
  await expect.poll(() => savedDocument(page)).toEqual(original);
  await expect(folder(page, 'First')).toHaveAttribute('data-folder-id', firstId);
  await expect(folder(page, 'First')).toBeFocused();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => savedDocument(page)).toEqual(expected);
  await page.reload();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Next', 'Existing A', 'Existing B', 'First', 'Leaf', 'Last']);
  expect(await savedDocument(page)).toEqual(expected);
});

test('keeps the root and an only child from indenting when no sibling destination exists', async ({ page }) => {
  await loadFixture(page, 'Project\n  Only\n    Leaf');
  const original = await savedDocument(page);
  for (const name of ['Project', 'Only', 'Leaf']) {
    await selectFolder(page, name);
    const indent = actions(page, name).locator('[data-action="indent"]');
    await expect(indent).toBeDisabled();
    await expect(indent).toBeHidden();
    await expect(indent).toHaveCSS('visibility', 'hidden');
    await expect(indent).toHaveCSS('pointer-events', 'none');
    await expect(indent).toHaveAttribute('aria-label', 'Move into previous sibling');
  }
  expect(await savedDocument(page)).toEqual(original);
});

test('still appends non-first siblings inside the previous sibling rather than the next', async ({ page }) => {
  await loadFixture(page, 'Project\n  Previous\n    Existing previous\n  Middle\n    Leaf\n  Next\n    Existing next');
  const original = await savedDocument(page);
  const middleId = original.root.children[1].id;
  const expected = structuredClone(original);
  const [middle] = expected.root.children.splice(1, 1);
  expected.root.children[0].children.push(middle);
  await page.getByRole('button', { name: 'Collapse Previous', exact: true }).click();
  await selectFolder(page, 'Middle');
  const indent = actions(page, 'Middle').getByRole('button', { name: 'Move into previous sibling', exact: true });
  await expect(indent).toHaveAttribute('title', 'Move inside the previous sibling folder');
  await indent.click();
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Previous/Middle');
  await expect(folder(page, 'Middle')).toHaveAttribute('data-folder-id', middleId);
  await expect(folder(page, 'Middle')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Collapse Previous', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => savedDocument(page)).toEqual(expected);
  await page.keyboard.press('Control+z');
  await expect.poll(() => savedDocument(page)).toEqual(original);
  await expect(page.locator('.fs-selected-path')).toHaveText('Project/Middle');
});
