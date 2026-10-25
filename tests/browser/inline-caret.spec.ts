import { expect, test, type Locator, type Page } from '@playwright/test';
import { parseText, serializeJSON } from '../../src/core';

// These are native focused-field screenshots, not a drawn or simulated caret.
test.use({ locale: 'en-US', isMobile: true, hasTouch: true });
const ROOT = 'Planning folder with a long existing name for caret visibility';
const RTL = 'مجلد عمل طويل للتحقق من مؤشر الكتابة في نهاية الاسم';
const LTR_NOTE = 'Long reference information for the working project and its final delivery. '.repeat(5).trim();
const RTL_NOTE = 'ملاحظات طويلة للمشروع ومراجع العمل ومعلومات تفصيلية للتخطيط والتسليم. '.repeat(5).trim();
const draft = `${ROOT} // ${LTR_NOTE}\n    ${RTL} // ${RTL_NOTE}\n        Child // Keep this child\n    Tail // Final notes`;
const wire = JSON.parse(serializeJSON(parseText(draft, 'plain')));
const folder = (page: Page, name: string) => page.locator(`.fs-folder-select[title="${name}"]`);
const comment = (page: Page, name: string) => folder(page, name).locator('..').locator('..').locator('..').locator(':scope > .fs-folder-comment');
const action = (page: Page, name: string) => page.locator(`.fs-context-actions [data-action="${name}"]`);
const scale = (page: Page) => page.evaluate(() => visualViewport?.scale ?? 1);
const saved = (page: Page) => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document));

async function load(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(({ document, draft, width }) => {
    localStorage.setItem('folderseed:language:v1', width === 390 ? 'ar' : 'en');
    localStorage.setItem('folderseed:theme:v1', width === 390 ? 'dark' : 'light');
    localStorage.setItem('folderseed:draft:v1', JSON.stringify({ document, draft, pending: false, mode: 'visual', textFormat: 'plain', indent: 'auto', textLocale: 'en' }));
  }, { document: wire, draft, width });
  await page.goto('/');
  await expect(page.locator('.fs-folder-name')).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
}
async function tapOnce(page: Page, target: Locator) {
  await target.evaluate(element => element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }));
  const point = await target.evaluate(element => {
    const box = element.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === element || !!hit && element.contains(hit) };
  });
  expect(point.hit, 'the first touch reaches the actual control').toBe(true);
  await page.touchscreen.tap(point.x, point.y);
}
async function clear(page: Page) {
  await page.locator('.fs-editor').press('Escape');
  await expect(page.locator('.fs-floating-actions')).toHaveCount(0);
}
async function geometry(page: Page, name: string) {
  return folder(page, name).evaluate(element => {
    const tree = element.closest<HTMLElement>('.fs-tree')!, origin = tree.getBoundingClientRect();
    const row = element.closest('.fs-tree-row')!, item = row.closest('.fs-tree-item')!;
    const box = (target: Element, local = true) => {
      const rect = target.getBoundingClientRect();
      return { x: rect.x + (local ? tree.scrollLeft - origin.x : scrollX), y: rect.y + (local ? tree.scrollTop - origin.y : scrollY), width: rect.width, height: rect.height };
    };
    return {
      row: box(row), glyph: box(element.querySelector('.fs-folder-icon svg')!),
      comment: box(item.querySelector(':scope > .fs-folder-comment')!), count: box(item.querySelector(':scope > .fs-row-count')!),
      panels: ['.fs-editor', '.fs-preview', '.fs-workspace-grid', '.fs-export'].map(selector => box(document.querySelector(selector)!, false)),
    };
  });
}
function stationary(before: Awaited<ReturnType<typeof geometry>>, after: Awaited<ReturnType<typeof geometry>>) {
  for (const key of ['row', 'glyph', 'comment', 'count'] as const) {
    for (const axis of ['x', 'y', 'height'] as const) expect(after[key][axis], `${key} ${axis}`).toBeCloseTo(before[key][axis], 1);
  }
  expect(after.comment.width).toBeCloseTo(before.comment.width, 1);
  expect(after.row.height).toBe(34);
  for (const [index, panel] of before.panels.entries()) for (const key of ['x', 'y', 'width', 'height'] as const) expect(after.panels[index][key], `panel ${index} ${key}`).toBeCloseTo(panel[key], 1);
}
async function caretState(field: Locator) {
  return field.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => ({ value: element.value, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection }));
}
async function focusedEnd(page: Page, field: Locator, originalScale: number) {
  await expect(field).toBeFocused();
  const length = (await field.inputValue()).length;
  await expect.poll(async () => {
    const state = await caretState(field); return [state.start, state.end];
  }).toEqual([length, length]);
  expect(await field.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await scale(page)).toBeCloseTo(originalScale, 4);
}
async function safeNativeBounds(field: Locator, isComment: boolean) {
  const bounds = await field.evaluate(element => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const rect = input.getBoundingClientRect(), style = getComputedStyle(input);
    const editor = input.closest('.fs-inline-editor')!;
    const owner = input.closest('.fs-folder-comment') ?? editor;
    const ownerBox = owner.getBoundingClientRect();
    const box = (target: Element) => {
      const rect = target.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const controls = [...editor.querySelectorAll('button')].filter(button => button.getClientRects().length && getComputedStyle(button).visibility === 'visible').map(box);
    const count = input.closest('.fs-tree-item')?.querySelector(':scope > .fs-row-count');
    return {
      field: box(input), owner: box(owner), leftInset: rect.left - ownerBox.left, rightInset: ownerBox.right - rect.right,
      paddingLeft: parseFloat(style.paddingLeft), paddingRight: parseFloat(style.paddingRight),
      innerWidth: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      controls, count: count ? box(count) : null, overflowing: input.scrollWidth > input.clientWidth, scrollLeft: input.scrollLeft,
    };
  });
  // A browser may paint its real end caret at the native control's own edge.
  // The separate wrapper inset protects that edge from the clipped comment cell.
  if (isComment) {
    expect(bounds.leftInset, 'native field starts inside the clipping boundary').toBeGreaterThanOrEqual(6);
    expect(bounds.rightInset, 'native end edge stays inside the clipping boundary').toBeGreaterThanOrEqual(6);
  }
  expect(bounds.paddingLeft).toBeGreaterThanOrEqual(isComment ? 6 : 5);
  expect(bounds.paddingRight).toBeGreaterThanOrEqual(isComment ? 6 : 5);
  expect(bounds.innerWidth, 'the inset still leaves usable native text space').toBeGreaterThan(2);
  expect(bounds.field.top).toBeGreaterThanOrEqual(bounds.owner.top - 0.5);
  expect(bounds.field.bottom).toBeLessThanOrEqual(bounds.owner.bottom + 0.5);
  for (const other of [...bounds.controls, ...(bounds.count ? [bounds.count] : [])]) {
    const overlapX = Math.min(bounds.field.right, other.right) - Math.max(bounds.field.left, other.left);
    const overlapY = Math.min(bounds.field.bottom, other.bottom) - Math.max(bounds.field.top, other.top);
    expect(overlapX > 0.5 && overlapY > 0.5, 'native field does not overlap controls or child count').toBe(false);
  }
  return bounds;
}

for (const width of [320, 390, 768]) {
  test(`keeps real native end carets inside mobile inline fields at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await load(page, width);
    const originalScale = await scale(page), original = await saved(page);
    for (const [name, note, direction] of [[ROOT, LTR_NOTE, 'ltr'], [RTL, RTL_NOTE, 'rtl']] as const) {
      await clear(page);
      const before = await geometry(page, name);
      await tapOnce(page, comment(page, name));
      const field = page.locator('.fs-inline-comment');
      await focusedEnd(page, field, originalScale);
      await expect(field).toHaveValue(note);
      await expect(field).toHaveCSS('direction', direction);
      await expect.poll(() => field.evaluate(element => Math.abs(element.scrollLeft))).toBeGreaterThan(0);
      const bounds = await safeNativeBounds(field, true);
      expect(bounds.overflowing).toBe(true);
      stationary(before, await geometry(page, name));
      await testInfo.attach(`${direction}-comment-native-bounds`, { body: JSON.stringify(bounds, null, 2), contentType: 'application/json' });
      await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`native-caret-${width}-${direction}-comment.png`), caret: 'initial' });
      await field.pressSequentially('X');
      await expect(field).toHaveValue(`${note}X`);
      await focusedEnd(page, field, originalScale);
      await safeNativeBounds(field, true);
      stationary(before, await geometry(page, name));
      await field.press('Escape');
      expect(await saved(page)).toBe(original);
      stationary(before, await geometry(page, name));

      await tapOnce(page, folder(page, name).locator('.fs-folder-icon'));
      await tapOnce(page, action(page, 'rename'));
      const input = page.locator('input.fs-inline-name');
      await focusedEnd(page, input, originalScale);
      await expect(input).toHaveValue(name);
      await expect(input).toHaveCSS('direction', direction);
      await safeNativeBounds(input, false);
      stationary(before, await geometry(page, name));
      await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`native-caret-${width}-${direction}-rename.png`), caret: 'initial' });
      await input.press('Escape');
      stationary(before, await geometry(page, name));
    }

    await clear(page);
    const beforeAdd = await geometry(page, ROOT);
    await tapOnce(page, folder(page, ROOT).locator('.fs-folder-icon'));
    await tapOnce(page, action(page, 'add-child'));
    const added = page.locator('input.fs-inline-name');
    await expect(added).toHaveValue('');
    await focusedEnd(page, added, originalScale);
    await safeNativeBounds(added, false);
    await added.pressSequentially('A new folder with a long typed title');
    await focusedEnd(page, added, originalScale);
    await safeNativeBounds(added, false);
    expect(await saved(page)).toBe(original);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`native-caret-${width}-new-folder.png`), caret: 'initial' });
    await added.press('Escape');
    stationary(beforeAdd, await geometry(page, ROOT));

    if (width === 390) {
      await clear(page);
      await tapOnce(page, comment(page, ROOT));
      const field = page.locator('.fs-inline-comment');
      await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 10, 'backward'));
      await field.pressSequentially('Q');
      await expect(field).toHaveValue(`${LTR_NOTE.slice(0, 5)}Q${LTR_NOTE.slice(10)}`);
      expect((await caretState(field)).start).toBe(6);
      await field.dispatchEvent('compositionstart');
      const composing = '输入中的说明 // Keep the raw selection and spaces';
      await field.fill(composing);
      await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 8, 'backward'));
      const selected = await caretState(field);
      await page.setViewportSize({ width: 400, height: 1000 });
      expect(await caretState(field)).toEqual(selected);
      await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
      expect(await saved(page)).toBe(original);
      await field.dispatchEvent('compositionend', { data: '输入中的说明' });
      expect(await caretState(field)).toEqual(selected);
      await page.setViewportSize({ width, height: 1000 });
      expect(await caretState(field)).toEqual(selected);
      await safeNativeBounds(field, true);
      await field.press('Escape');
      expect(await saved(page)).toBe(original);
    }
    expect(await scale(page)).toBeCloseTo(originalScale, 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
