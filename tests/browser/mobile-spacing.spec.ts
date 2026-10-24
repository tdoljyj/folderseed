import { expect, test, type Locator, type Page } from '@playwright/test';
import { parseText, serializeJSON } from '../../src/core';

const ROOT = 'Root planning folder with a deliberately long title';
const PARENT = 'Planning materials with a deliberately long title';
const SELECTED = 'Selected working folder with a deliberately long title';
const NOTE = 'Reference information with useful details 我的说明 العربية. '.repeat(5);
const TEXT = `${ROOT} // ${NOTE}\n    ${PARENT} // ${NOTE}\n        Before // Earlier work\n        ${SELECTED} // ${NOTE}\n            Child // Keep this child\n        After // Later work\n    Tail // Final folder`;
const wire = JSON.parse(serializeJSON(parseText(TEXT, 'plain')));
const folder = (page: Page, name: string) => page.locator(`.fs-folder-select[title="${name}"]`);
const row = (page: Page, name: string) => folder(page, name).locator('..');
const item = (page: Page, name: string) => row(page, name).locator('..').locator('..');
const comment = (page: Page, name: string) => item(page, name).locator(':scope > .fs-folder-comment');
const action = (page: Page, name: string) => page.locator(`.fs-context-actions button[data-action="${name}"]`);
const viewportScale = (page: Page) => page.evaluate(() => visualViewport?.scale ?? 1);

test.use({ locale: 'en-US', isMobile: true, hasTouch: true });

async function load(page: Page, width: number, locale = 'en', theme = 'light') {
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(({ locale, theme, document, draft }) => {
    localStorage.setItem('folderseed:language:v1', locale);
    localStorage.setItem('folderseed:theme:v1', theme);
    localStorage.setItem('folderseed:draft:v1', JSON.stringify({ document, draft, mode: 'visual', textFormat: 'plain', pending: false, indent: 'auto', textLocale: 'en' }));
  }, { locale, theme, document: wire, draft: TEXT });
  await page.goto('/');
  await expect(page.locator('.fs-folder-name')).toHaveCount(7);
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', locale);
  await page.evaluate(() => document.fonts.ready);
}
async function clear(page: Page) {
  await page.locator('.fs-editor').press('Escape');
  await expect(page.locator('.fs-floating-actions')).toHaveCount(0);
}
async function tapOnce(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const point = await target.evaluate(element => {
    const box = element.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === element || !!hit && element.contains(hit) };
  });
  expect(point.hit, 'the one-tap center reaches the actual control').toBe(true);
  await page.touchscreen.tap(point.x, point.y);
}
async function anchor(page: Page, name: string) {
  return folder(page, name).evaluate(element => {
    const tree = element.closest<HTMLElement>('.fs-tree')!, origin = tree.getBoundingClientRect();
    const row = element.closest('.fs-tree-row')!, item = row.closest('.fs-tree-item')!;
    const box = (target: Element) => {
      const rect = target.getBoundingClientRect();
      return { x: rect.x - origin.x + tree.scrollLeft, y: rect.y - origin.y + tree.scrollTop, width: rect.width, height: rect.height };
    };
    return {
      glyph: box(element.querySelector('.fs-folder-icon svg')!), name: box(element.querySelector('.fs-folder-name')!),
      grip: box(row.querySelector('.fs-drag-hint')!), row: box(row), count: box(item.querySelector(':scope > .fs-row-count')!),
      comment: box(item.querySelector(':scope > .fs-folder-comment')!),
      disclosure: row.querySelector('.fs-disclosure, .fs-disclosure-placeholder') ? box(row.querySelector('.fs-disclosure, .fs-disclosure-placeholder')!) : null,
    };
  });
}
function stationary(before: Awaited<ReturnType<typeof anchor>>, after: Awaited<ReturnType<typeof anchor>>) {
  for (const part of ['glyph', 'name', 'grip', 'count', 'comment'] as const) {
    for (const axis of ['x', 'y'] as const) expect(after[part][axis], `${part} ${axis}`).toBeCloseTo(before[part][axis], 1);
  }
  expect(after.row.height).toBe(34);
}
const panels = (page: Page) => page.evaluate(() => ['.fs-editor', '.fs-preview', '.fs-workspace-grid', '.fs-export'].map(selector => {
  const rect = document.querySelector(selector)!.getBoundingClientRect();
  return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
}));
async function shellFits(page: Page, width: number) {
  expect(await page.evaluate(() => innerWidth)).toBe(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const boxes = await page.locator('.fs-app, .fs-sidebar, .fs-main').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect(); return { left: box.left, right: box.right };
  }));
  for (const box of boxes) { expect(box.left).toBeGreaterThanOrEqual(-0.5); expect(box.right).toBeLessThanOrEqual(width + 0.5); }
}
async function usableActions(page: Page) {
  const targets = await page.locator('.fs-context-actions button, .fs-floating-disclosure').evaluateAll(elements => elements.filter(element => getComputedStyle(element).visibility === 'visible').map(element => {
    const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { name: element.getAttribute('data-action') ?? 'disclosure', x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      hit: hit === element || !!hit && element.contains(hit), svg: element.querySelector('svg')?.getBoundingClientRect().width };
  }));
  expect(targets.filter(target => target.name !== 'disclosure')).toHaveLength(8);
  for (const target of targets) {
    expect(target.width, target.name).toBe(target.name === 'disclosure' ? 18 : 24);
    expect(target.height, target.name).toBe(24);
    expect(target.hit, `${target.name} center receives a real pointer`).toBe(true);
    if (target.name !== 'disclosure') expect(target.svg).toBe(16);
  }
  for (let a = 0; a < targets.length; a++) for (let b = a + 1; b < targets.length; b++) {
    const left = targets[a], right = targets[b];
    const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
    const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
    expect(overlapX > 0.5 && overlapY > 0.5, `${left.name} and ${right.name} hitboxes do not overlap`).toBe(false);
  }
  const count = await item(page, SELECTED).locator(':scope > .fs-row-count').boundingBox();
  for (const target of targets) expect(target.x < count!.x + count!.width && target.x + target.width > count!.x && target.y < count!.y + count!.height && target.y + target.height > count!.y, `${target.name} leaves the count clear`).toBe(false);
}
async function checkNativeSelect(page: Page, select: Locator, scale: number) {
  await expect(select).toBeVisible();
  await select.focus();
  await largeFocusedField(page, select, scale);
  await select.evaluate(element => (element as HTMLSelectElement).blur());
  expect(await viewportScale(page)).toBeCloseTo(scale, 4);
}
async function largeFocusedField(page: Page, field: Locator, scale: number) {
  await expect(field).toBeFocused();
  expect(await field.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await viewportScale(page)).toBeCloseTo(scale, 4);
}

for (const scenario of [
  { width: 320, locale: 'en', theme: 'light' },
  { width: 360, locale: 'zh-CN', theme: 'light' },
  { width: 390, locale: 'ar', theme: 'dark' },
  { width: 430, locale: 'en', theme: 'dark' },
]) {
  test(`keeps compact mobile spacing and one-tap editable fields at ${scenario.width}px in ${scenario.locale}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await load(page, scenario.width, scenario.locale, scenario.theme);
    const scale = await viewportScale(page), layout = await panels(page);
    for (const [name, depth] of [[ROOT, 0], [PARENT, 1], [SELECTED, 2]] as const) {
      await clear(page);
      const before = await anchor(page, name);
      expect(before.row.height).toBe(34);
      expect(before.grip.width).toBe(14);
      expect(before.disclosure!.x).toBeCloseTo(17 + depth * 14, 1);
      expect(before.disclosure!.width).toBe(24);
      expect(before.glyph.x).toBeCloseTo(41 + depth * 14, 1);
      expect(before.name.x).toBeCloseTo(67 + depth * 14, 1);
      // Previous mobile slots allowed commentStart - depthInset - 138 px for a long name.
      const previousNameWidth = before.comment.x - depth * 14 - 138;
      expect(before.name.width - previousNameWidth).toBeGreaterThanOrEqual(15.5);
      await tapOnce(page, folder(page, name));
      await expect(folder(page, name)).toHaveAttribute('aria-pressed', 'true');
      stationary(before, await anchor(page, name));
      expect(await panels(page)).toEqual(layout);
      if (name === SELECTED) await usableActions(page);
      await clear(page);
      stationary(before, await anchor(page, name));
    }
    await shellFits(page, scenario.width);
    await tapOnce(page, folder(page, SELECTED));
    if ([320, 390].includes(scenario.width)) await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`compact-mobile-${scenario.width}-${scenario.locale}-${scenario.theme}.png`) });

    // A single trusted tap opens and focuses rename/add immediately, without a second tap.
    await tapOnce(page, action(page, 'rename'));
    await largeFocusedField(page, page.locator('.fs-inline-name'), scale);
    await page.locator('.fs-inline-name').press('Escape');
    await tapOnce(page, action(page, 'add-child'));
    await largeFocusedField(page, page.locator('.fs-inline-name'), scale);
    await page.locator('.fs-inline-name').press('Escape');
    await clear(page);
    const beforeComment = await anchor(page, ROOT);
    await tapOnce(page, comment(page, ROOT));
    const field = page.locator('.fs-inline-comment');
    await largeFocusedField(page, field, scale);
    stationary(beforeComment, await anchor(page, ROOT));
    const box = (await comment(page, ROOT).boundingBox())!, inputBox = (await field.boundingBox())!;
    expect(inputBox.x).toBeGreaterThanOrEqual(box.x);
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(box.x + box.width);
    expect(inputBox.y).toBeGreaterThanOrEqual(box.y);
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(box.y + box.height);
    await expect(field).toHaveValue(NOTE);
    await field.press('End');
    await expect.poll(() => field.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    if ([320, 390].includes(scenario.width)) await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`compact-comment-focus-${scenario.width}-${scenario.locale}-${scenario.theme}.png`) });
    await field.press('Escape');
    expect(await panels(page)).toEqual(layout);

    if (scenario.width === 430) {
      await checkNativeSelect(page, page.locator('.fs-mobile-templates select'), scale);
      await tapOnce(page, folder(page, PARENT));
      await tapOnce(page, page.locator('.fs-advanced-move'));
      await checkNativeSelect(page, page.locator('#destination'), scale);
      await checkNativeSelect(page, page.locator('#destination-position'), scale);
      await page.locator('dialog.fs-dialog').press('Escape');
      for (const [index, selector] of [[1, '#text-export-style'], [2, '#markdown-export-style']] as const) {
        await tapOnce(page, page.locator('.fs-export-options [role="radio"]').nth(index));
        await checkNativeSelect(page, page.locator(selector), scale);
      }
      await clear(page);
    }
    await tapOnce(page, page.locator('.fs-format-activate'));
    await tapOnce(page, page.locator('.fs-text-area textarea'));
    await largeFocusedField(page, page.locator('.fs-text-area textarea'), scale);
    await tapOnce(page, page.locator('.fs-editor-tabs > button'));
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator('.fs-sidebar')).not.toHaveClass(/is-scroll-hidden/);
    await tapOnce(page, page.locator('.fs-app-menu-mobile .fs-app-menu-trigger'));
    await tapOnce(page, page.getByRole('menuitem'));
    const dialog = (await page.locator('.fs-settings-dialog').boundingBox())!;
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(scenario.width);
    if (scenario.width === 430) await checkNativeSelect(page, page.locator('.fs-language-select'), scale);
    await page.locator('.fs-settings-dialog').press('Escape');
    await shellFits(page, scenario.width);
    expect(await viewportScale(page)).toBeCloseTo(scale, 4);
  });
}

test.describe('compact layout with native pointer dragging', () => {
  test.use({ isMobile: false, hasTouch: false });
  test('starts a native drag from the compact leading grip and restores the subtree with Undo', async ({ page }) => {
    await load(page, 360);
    await row(page, SELECTED).hover();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1')!).document);
    await page.evaluate(() => document.addEventListener('dragstart', event => {
      document.documentElement.dataset.compactDragTrusted = String(event.isTrusted);
    }, { capture: true, once: true }));
    const grip = (await row(page, SELECTED).locator('.fs-drag-hint').boundingBox())!;
    const target = (await row(page, 'Before').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - 10, { steps: 4 });
    await page.mouse.move(target.x + 70, target.y + 2, { steps: 12 });
    await page.mouse.move(target.x + 71, target.y + 2);
    await expect(page.locator('.fs-drop-line.is-before')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('.fs-folder-name')).toHaveText([ROOT, PARENT, SELECTED, 'Child', 'Before', 'After', 'Tail']);
    await expect(page.locator('html')).toHaveAttribute('data-compact-drag-trusted', 'true');
    await expect(item(page, SELECTED).locator(':scope > .fs-row-count')).toHaveText('1');
    await expect(comment(page, SELECTED)).toHaveText(NOTE);
    await page.locator('.fs-history button').first().click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1')!).document)).toEqual(before);
    await expect(page.locator('.fs-folder-name')).toHaveText([ROOT, PARENT, 'Before', SELECTED, 'Child', 'After', 'Tail']);
    await shellFits(page, 360);
  });
});
