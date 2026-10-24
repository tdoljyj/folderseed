import { expect, test, type Locator, type Page } from '@playwright/test';
import { parseText, type DirectoryDocument } from '../../src/core';

test.use({ locale: 'en-US', viewport: { width: 1600, height: 1100 } });

const DRAFT_KEY = 'folderseed:draft:v1';
const outline = 'Project\n    Alpha\n        Leaf\n    Beta';
const editor = (app: Locator) => app.locator(':scope > .fs-main > .fs-workspace-grid > .fs-editor');
const folder = (app: Locator, name: string) => editor(app).locator(`.fs-folder-select[title="${name}"]`);
const selected = (app: Locator) => editor(app).locator('.fs-folder-select[aria-pressed="true"]');
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document, DRAFT_KEY);

async function prepare(page: Page) {
  await page.goto('/');
  const app = page.locator('.fs-app');
  await expect(app).toHaveAttribute('lang', 'en');
  await app.locator('input[type="file"]').setInputFiles({ name: 'background.plain.txt', mimeType: 'text/plain', buffer: Buffer.from(outline) });
  await expect(editor(app).locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Leaf', 'Beta']);
  await expect.poll(async () => (await saved(page))?.root.name).toBe('Project');
  await page.evaluate(() => document.fonts.ready);
  return app;
}

async function selectFolder(app: Locator, name = 'Alpha') {
  const button = folder(app, name);
  await button.focus();
  await button.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(app).locator('.fs-floating-actions')).toBeVisible();
}

/** Find a real hit on app main padding or workspace gutter, strictly outside every editor card. */
async function outsidePoint(app: Locator, kind: 'main' | 'gutter' = 'main') {
  await editor(app).scrollIntoViewIfNeeded();
  return app.evaluate((root, kind) => {
    const main = root.querySelector(':scope > .fs-main')!;
    const grid = main.querySelector(':scope > .fs-workspace-grid')!;
    const card = grid.querySelector(':scope > .fs-editor')!.getBoundingClientRect();
    const target = kind === 'gutter' ? grid : main;
    const area = target.getBoundingClientRect();
    const candidates: { x: number; y: number }[] = [];
    const preview = grid.querySelector(':scope > .fs-preview')!.getBoundingClientRect();
    if (kind === 'gutter' && preview.left > card.right) candidates.push({ x: (card.right + preview.left) / 2, y: Math.max(24, Math.min(innerHeight - 24, card.top + 160)) });
    if (kind === 'gutter' && preview.top > card.bottom) candidates.push({ x: card.left + card.width / 2, y: (card.bottom + preview.top) / 2 });
    for (let y = Math.max(24, area.top + 8); y <= Math.min(innerHeight - 24, area.bottom - 8); y += 24) {
      for (const x of [area.left + 6, area.right - 6, (card.right + preview.left) / 2]) candidates.push({ x, y });
    }
    for (const point of candidates) {
      if (point.x < 4 || point.x > innerWidth - 4 || point.y < 4 || point.y > innerHeight - 4) continue;
      if (point.x >= card.left && point.x <= card.right && point.y >= card.top && point.y <= card.bottom) continue;
      const clear = [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) => {
        const hit = document.elementFromPoint(point.x + dx, point.y + dy);
        return hit === target && hit.closest('.fs-app') === root && !hit.closest('.fs-editor');
      });
      if (clear) return point;
    }
    throw new Error(`No exposed ${kind} background exists outside this editor card.`);
  }, kind);
}

async function layout(app: Locator) {
  return app.locator(':scope > .fs-main > .fs-workspace-grid > .fs-panel').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
  }));
}
async function expectUnmoved(app: Locator, before: Awaited<ReturnType<typeof layout>>) {
  const after = await layout(app);
  expect(after).toHaveLength(before.length);
  for (let index = 0; index < before.length; index++) {
    for (const dimension of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after[index][dimension] - before[index][dimension])).toBeLessThanOrEqual(0.75);
  }
}
async function expectCleared(app: Locator) {
  await expect(selected(app)).toHaveCount(0);
  await expect(editor(app).locator('.fs-floating-actions')).toHaveCount(0);
}

test('desktop main padding and workspace gutter clear selection without shifting frames or swallowing controls', async ({ page }) => {
  const app = await prepare(page);
  const original = await saved(page);
  await selectFolder(app);
  const before = await layout(app);
  await app.getByRole('button', { name: 'Text tree', exact: true }).click();
  await expect(folder(app, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  await app.getByRole('radio', { name: /^Markdown/ }).click();
  await expect(folder(app, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  await editor(app).getByRole('button', { name: 'Move', exact: true }).click();
  await expect(app.getByRole('dialog')).toBeVisible();
  await app.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(folder(app, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  for (const kind of ['main', 'gutter'] as const) {
    if (kind === 'gutter') await selectFolder(app);
    const point = await outsidePoint(app, kind);
    await page.mouse.click(point.x, point.y);
    await expectCleared(app);
    await expectUnmoved(app, before);
  }
  expect(await saved(page)).toEqual(original);
});

test.describe('touch app background', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a real touch tap outside the mobile editor clears selection while controls retain it', async ({ page }) => {
    const app = await prepare(page);
    await folder(app, 'Alpha').tap();
    await expect(folder(app, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
    await editor(app).getByRole('button', { name: 'Collapse Alpha', exact: true }).tap();
    await expect(folder(app, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
    await editor(app).getByRole('button', { name: 'Expand Alpha', exact: true }).tap();
    const before = await layout(app);
    const original = await saved(page);
    const point = await outsidePoint(app);
    await page.touchscreen.tap(point.x, point.y);
    await expectCleared(app);
    await expectUnmoved(app, before);
    expect(await saved(page)).toEqual(original);
  });
});

test('outside-card clicks commit valid inline names but preserve invalid names and raw drafts', async ({ page }) => {
  const app = await prepare(page);
  await selectFolder(app);
  await editor(app).getByRole('button', { name: 'Rename', exact: true }).click();
  const inline = editor(app).getByRole('textbox', { name: 'Folder name', exact: true });
  await inline.fill('Renamed');
  let point = await outsidePoint(app);
  await page.mouse.click(point.x, point.y);
  await expect(inline).toHaveCount(0);
  await expect(folder(app, 'Renamed')).toBeVisible();
  await expectCleared(app);
  await expect.poll(async () => (await saved(page)).root.children[0].name).toBe('Renamed');
  const valid = await saved(page);

  await selectFolder(app, 'Renamed');
  await editor(app).getByRole('button', { name: 'Rename', exact: true }).click();
  await inline.fill('../invalid');
  point = await outsidePoint(app);
  await page.mouse.click(point.x, point.y);
  await expect(inline).toHaveValue('../invalid');
  await expect(inline).toHaveAttribute('aria-invalid', 'true');
  await expect(inline).toBeFocused();
  await expect(editor(app).locator('.fs-tree-row.is-selected')).toHaveCount(1);
  expect(await saved(page)).toEqual(valid);
  await inline.press('Escape');
  await editor(app).locator('.fs-format-activate').click();
  const raw = editor(app).getByRole('textbox', { name: 'Folder structure text', exact: true });
  const invalid = 'Project\n    Renamed\n       Unfinished';
  await raw.fill(invalid);
  await expect(editor(app).locator('.fs-text-area .fs-inline-error')).toBeVisible();
  point = await outsidePoint(app);
  await page.mouse.click(point.x, point.y);
  await expect(raw).toHaveValue(invalid);
  await expect(app.locator('.fs-download')).toBeDisabled();
  expect(await saved(page)).toEqual(valid);
  await editor(app).getByRole('button', { name: 'Revert text', exact: true }).click();
  await editor(app).getByRole('button', { name: 'Visual editor', exact: true }).click();
  await expect(folder(app, 'Renamed')).toHaveAttribute('aria-pressed', 'true');
});

async function mountEditor(page: Page, id: string, parent: string, initialDocument: DirectoryDocument) {
  await page.evaluate(async ({ id, parent, initialDocument }) => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const reactUrl = resources.find(url => new URL(url).pathname.endsWith('/deps/react.js'));
    const domUrl = resources.find(url => new URL(url).pathname.endsWith('/deps/react-dom_client.js'));
    if (!reactUrl || !domUrl) throw new Error('The embedding example did not expose its loaded React modules.');
    const reactModule = await import(reactUrl);
    const domModule = await import(domUrl);
    const { createElement } = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const moduleUrl = '/src/ui/FolderEditor.tsx';
    const { FolderEditor } = await import(moduleUrl);
    const container = document.createElement('section');
    container.dataset.testid = id;
    document.querySelector(parent)!.append(container);
    createRoot(container).render(createElement(FolderEditor, {
      initialDocument, storageKey: false, themeStorageKey: false, languageStorageKey: false,
    }));
  }, { id, parent, initialDocument });
  const app = page.getByTestId(id).locator(':scope > .fs-app');
  await expect(app).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return app;
}

test('background clearing belongs only to its editor instance, never the host or a nested editor', async ({ page }) => {
  await page.goto('/examples/index.html');
  await page.evaluate(() => {
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('section');
    host.id = 'selection-test-host';
    const blank = document.createElement('div');
    blank.dataset.testid = 'host-background';
    blank.className = 'fs-main';
    blank.style.cssText = 'height:80px;padding:16px;margin:0;max-width:none;';
    host.append(blank);
    const control = document.createElement('button');
    control.textContent = 'Host control';
    host.append(control);
    document.body.append(host);
  });
  const outer = await mountEditor(page, 'outer-editor', '#selection-test-host', parseText('Outer\n    Alpha\n    Beta', 'plain'));
  await selectFolder(outer);
  const inner = await mountEditor(page, 'inner-editor', '[data-testid="outer-editor"] > .fs-app > .fs-main', parseText('Inner\n    Alpha\n    Beta', 'plain'));
  await selectFolder(inner);
  await expect(folder(outer, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  const hostBlank = page.getByTestId('host-background');
  await hostBlank.scrollIntoViewIfNeeded();
  const hostPoint = await hostBlank.evaluate(element => {
    const box = element.getBoundingClientRect();
    const point = { x: box.x + 8, y: box.y + 8 };
    if (document.elementFromPoint(point.x, point.y) !== element || element.closest('.fs-app')) throw new Error('Expected actual host background outside every editor.');
    return point;
  });
  await page.mouse.click(hostPoint.x, hostPoint.y);
  await page.getByRole('button', { name: 'Host control', exact: true }).click();
  await expect(folder(outer, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  await expect(folder(inner, 'Alpha')).toHaveAttribute('aria-pressed', 'true');

  let point = await outsidePoint(inner);
  await page.mouse.click(point.x, point.y);
  await expectCleared(inner);
  await expect(folder(outer, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  await selectFolder(inner);
  point = await outsidePoint(outer);
  await page.mouse.click(point.x, point.y);
  await expectCleared(outer);
  await expect(folder(inner, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
});
