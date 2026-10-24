import { expect, test, type Page } from '@playwright/test';
import { parseText, serializeJSON } from '../../src/core';

const TEXT = 'Project\n    Planning\n        Before\n        Working\n            Child\n        After\n    Delivery';
const folder = (page: Page, name: string) => page.locator(`.fs-folder-select[title="${name}"]`);
const row = (page: Page, name: string) => folder(page, name).locator('..');
async function anchors(page: Page, name: string) {
  return folder(page, name).evaluate(element => {
    const tree = element.closest<HTMLElement>('.fs-tree')!, origin = tree.getBoundingClientRect();
    const position = (target: Element) => {
      const box = target.getBoundingClientRect();
      return { x: box.x - origin.x + tree.scrollLeft, y: box.y - origin.y + tree.scrollTop, width: box.width, height: box.height };
    };
    return { glyph: position(element.querySelector('.fs-folder-icon svg')!), name: position(element.querySelector('.fs-folder-name')!), row: position(element.closest('.fs-tree-row')!) };
  });
}
const panels = (page: Page) => page.locator('.fs-editor, .fs-preview, .fs-workspace-grid, .fs-export').evaluateAll(elements => elements.map(element => {
  const box = element.getBoundingClientRect(); return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
}));
async function stationary(page: Page, name: string, before: Awaited<ReturnType<typeof anchors>>) {
  const after = await anchors(page, name);
  for (const part of ['glyph', 'name'] as const) for (const axis of ['x', 'y'] as const) expect(after[part][axis]).toBeCloseTo(before[part][axis], 1);
  expect(after.row.height).toBe(34);
}
async function clear(page: Page) {
  await page.locator('.fs-editor').press('Escape');
  await expect(page.locator('.fs-floating-actions')).toHaveCount(0);
}
async function hitTargets(page: Page) {
  const targets = await page.locator('.fs-context-actions button, .fs-floating-disclosure').evaluateAll(elements => elements.filter(element => getComputedStyle(element).visibility === 'visible').map(element => {
    const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { action: element.getAttribute('data-action') ?? 'disclosure', x: box.x, y: box.y, width: box.width, height: box.height, hit: hit === element || !!hit && element.contains(hit) };
  }));
  for (const target of targets) {
    expect(target.hit, `${target.action} receives pointer clicks`).toBe(true);
    expect(target.height).toBe(24);
    if (target.action !== 'disclosure') expect(target.width).toBe(24);
  }
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    const a = targets[i], b = targets[j];
    expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .5, `${a.action}/${b.action} do not overlap`).toBe(false);
  }
}

for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [1024, 'light'], [768, 'dark']] as const) {
  test(`removes unused root space without selection movement at ${width}px ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1080 });
    await page.addInitScript(({ document, theme, draft }) => {
      localStorage.setItem('folderseed:language:v1', 'en');
      localStorage.setItem('folderseed:theme:v1', theme);
      localStorage.setItem('folderseed:draft:v1', JSON.stringify({ document, draft, mode: 'visual', textFormat: 'plain', pending: false, indent: 'auto', textLocale: 'en' }));
    }, { document: JSON.parse(serializeJSON(parseText(TEXT, 'plain'))), theme, draft: TEXT });
    await page.goto('/');
    await expect(page.locator('.fs-folder-name')).toHaveCount(7);
    await page.evaluate(() => document.fonts.ready);
    const layout = await panels(page);
    for (const [name, depth] of [['Project', 0], ['Planning', 1], ['Working', 2]] as const) {
      await clear(page);
      await folder(page, name).scrollIntoViewIfNeeded();
      const before = await anchors(page, name);
      expect(before.glyph.x).toBeCloseTo(depth === 0 ? 25 : 49 + (depth - 1) * 22, 1);
      expect(before.name.x).toBeCloseTo(depth === 0 ? 53 : 77 + (depth - 1) * 22, 1);
      const grip = row(page, name).locator('.fs-drag-hint');
      if (depth === 0) await expect(grip).toBeHidden();
      else { expect((await grip.boundingBox())!.width).toBe(16); await expect(grip.locator('svg')).toHaveCount(1); }
      await folder(page, name).click();
      await stationary(page, name, before);
      expect(await panels(page)).toEqual(layout);
      await hitTargets(page);
      if (depth === 0) {
        const disclosure = (await page.locator('.fs-floating-disclosure').boundingBox())!;
        const glyph = (await folder(page, name).locator('.fs-folder-icon').boundingBox())!;
        expect(disclosure.width).toBe(24);
        expect(disclosure.x + disclosure.width).toBeCloseTo(glyph.x, 1);
        expect(disclosure.y + disclosure.height / 2).toBeCloseTo(glyph.y + glyph.height / 2, 1);
        await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`desktop-root-selected-${width}-${theme}.png`) });
        await page.locator('.fs-floating-disclosure').click();
        await expect(page.locator('.fs-folder-name')).toHaveCount(1);
        await stationary(page, name, before);
        await hitTargets(page);
        await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`desktop-root-collapsed-${width}-${theme}.png`) });
        await page.locator('.fs-floating-disclosure').click();
        await expect(page.locator('.fs-folder-name')).toHaveCount(7);
      } else if (name === 'Working') {
        await expect(page.locator('.fs-context-actions button:visible')).toHaveCount(8);
        await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`desktop-eight-actions-${width}-${theme}.png`) });
      }
      await clear(page);
      await stationary(page, name, before);
      expect(await panels(page)).toEqual(layout);
    }
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`desktop-root-deselected-${width}-${theme}.png`) });
    await page.locator('input[type="file"]').setInputFiles({ name: 'solo.txt', mimeType: 'text/plain', buffer: Buffer.from('Solo') });
    await expect(page.locator('.fs-folder-name')).toHaveText(['Solo']);
    const solo = await anchors(page, 'Solo');
    expect(solo.glyph.x).toBeCloseTo(1, 1);
    expect(solo.name.x).toBeCloseTo(29, 1);
    await expect(row(page, 'Solo').locator('.fs-drag-hint')).toBeHidden();
    await expect(row(page, 'Solo').locator('.fs-disclosure-placeholder')).toBeHidden();
    await folder(page, 'Solo').click();
    await stationary(page, 'Solo', solo);
    await expect(page.locator('.fs-floating-disclosure')).toHaveCount(0);
    await hitTargets(page);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`desktop-root-leaf-${width}-${theme}.png`) });
    await clear(page);
    await stationary(page, 'Solo', solo);
    expect(await panels(page)).toEqual(layout);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
