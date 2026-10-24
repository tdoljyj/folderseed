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
    if (part === 'grip' && before.grip.width === 0) { expect(after.grip.width).toBe(0); continue; }
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
async function caretAtEnd(field: Locator) {
  await expect.poll(() => field.evaluate(element => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    return { start: input.selectionStart, end: input.selectionEnd, length: input.value.length };
  })).toEqual({ start: (await field.inputValue()).length, end: (await field.inputValue()).length, length: (await field.inputValue()).length });
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
      expect(before.grip.width).toBe(depth === 0 ? 0 : 14);
      expect(before.disclosure!.x).toBeCloseTo(depth === 0 ? 1 : 17 + (depth - 1) * 14, 1);
      expect(before.disclosure!.width).toBe(24);
      expect(before.glyph.x).toBeCloseTo(depth === 0 ? 25 : 41 + (depth - 1) * 14, 1);
      expect(before.name.x).toBeCloseTo(depth === 0 ? 51 : 67 + (depth - 1) * 14, 1);
      // Previous mobile slots allowed commentStart - depthInset - 138 px for a long name.
      const previousNameWidth = before.comment.x - Math.max(0, depth - 1) * 14 - 138;
      expect(before.name.width - previousNameWidth).toBeGreaterThanOrEqual(15.5);
      await tapOnce(page, folder(page, name));
      await expect(folder(page, name)).toHaveAttribute('aria-pressed', 'true');
      stationary(before, await anchor(page, name));
      expect(await panels(page)).toEqual(layout);
      if (depth === 0) {
        const disclosure = page.locator('.fs-floating-disclosure');
        await expect(disclosure).toBeVisible();
        const selectedDisclosure = await disclosure.evaluate(element => {
          const tree = document.querySelector<HTMLElement>('.fs-tree')!, origin = tree.getBoundingClientRect(), box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return { x: box.x - origin.x + tree.scrollLeft, centerY: box.y + box.height / 2 - origin.y + tree.scrollTop,
            width: box.width, height: box.height, hit: hit === element || !!hit && element.contains(hit) };
        });
        expect(selectedDisclosure.x).toBeCloseTo(before.disclosure!.x, 1);
        expect(selectedDisclosure.centerY).toBeCloseTo(before.disclosure!.y + before.disclosure!.height / 2, 1);
        expect(selectedDisclosure.width).toBe(24);
        expect(selectedDisclosure.height).toBe(24);
        expect(selectedDisclosure.hit).toBe(true);
      }
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
    await caretAtEnd(page.locator('.fs-inline-name'));
    await page.locator('.fs-inline-name').press('Escape');
    await tapOnce(page, action(page, 'add-child'));
    await largeFocusedField(page, page.locator('.fs-inline-name'), scale);
    await caretAtEnd(page.locator('.fs-inline-name'));
    await page.locator('.fs-inline-name').press('Escape');
    await clear(page);
    const beforeComment = await anchor(page, ROOT);
    await tapOnce(page, comment(page, ROOT));
    const field = page.locator('.fs-inline-comment');
    await largeFocusedField(page, field, scale);
    await caretAtEnd(field);
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


for (const width of [320, 390]) {
  test(`keeps a childless root flush left and places an editable caret at the end at ${width}px`, async ({ page }, testInfo) => {
    await load(page, width, 'en', 'dark');
    await tapOnce(page, folder(page, ROOT));
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`mobile-root-children-selected-${width}-dark.png`) });
    await clear(page);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`mobile-root-children-deselected-${width}-dark.png`) });
    const name = 'Solo root planning', note = 'An existing root note with enough details for horizontal editing.';
    await page.locator('input[type="file"]').setInputFiles({ name: 'solo-root.txt', mimeType: 'text/plain', buffer: Buffer.from(`${name} // ${note}`) });
    await expect(page.locator('.fs-folder-name')).toHaveText([name]);
    const before = await anchor(page, name), layout = await panels(page);
    expect(before.grip.width).toBe(0);
    expect(before.disclosure?.width ?? 0).toBe(0);
    expect(before.glyph.x).toBeCloseTo(1, 1);
    expect(before.name.x).toBeCloseTo(27, 1);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`mobile-root-empty-${width}-dark.png`) });
    await tapOnce(page, folder(page, name));
    stationary(before, await anchor(page, name));
    await expect(row(page, name).locator('.fs-disclosure')).toHaveCount(0);
    await expect(page.locator('.fs-floating-disclosure')).toHaveCount(0);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`mobile-root-selected-${width}-dark.png`) });
    await tapOnce(page, action(page, 'rename'));
    const input = page.locator('.fs-inline-name');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(name);
    await caretAtEnd(input);
    await input.pressSequentially('X');
    await expect(input).toHaveValue(`${name}X`);
    await caretAtEnd(input);
    // A later tap deliberately moves the caret; rerendering must not force it back to the end.
    await input.evaluate(element => { element.scrollLeft = 0; });
    const box = (await input.boundingBox())!;
    await page.touchscreen.tap(box.x + 7, box.y + box.height / 2);
    const caret = await input.evaluate(element => (element as HTMLInputElement).selectionStart!);
    const oldValue = await input.inputValue();
    expect(caret).toBeLessThan(oldValue.length);
    await input.pressSequentially('Q');
    await expect(input).toHaveValue(`${oldValue.slice(0, caret)}Q${oldValue.slice(caret)}`);
    expect(await input.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(caret + 1);
    expect(await input.evaluate(element => (element as HTMLInputElement).selectionEnd)).toBe(caret + 1);
    await input.press('Escape');
    await clear(page);
    stationary(before, await anchor(page, name));

    await tapOnce(page, comment(page, name));
    const field = page.locator('.fs-inline-comment');
    await expect(field).toBeFocused();
    await caretAtEnd(field);
    await field.pressSequentially('X');
    await expect(field).toHaveValue(`${note}X`);
    await caretAtEnd(field);
    await field.evaluate(element => { element.scrollLeft = 0; });
    const commentBox = (await field.boundingBox())!;
    await page.touchscreen.tap(commentBox.x + 5, commentBox.y + commentBox.height / 2);
    const commentCaret = await field.evaluate(element => (element as HTMLTextAreaElement).selectionStart);
    expect(commentCaret).toBeLessThan(note.length);
    await field.pressSequentially('Q');
    await expect(field).toHaveValue(`${note.slice(0, commentCaret)}Q${note.slice(commentCaret)}X`);
    expect(await field.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(commentCaret + 1);
    expect(await field.evaluate(element => (element as HTMLTextAreaElement).selectionEnd)).toBe(commentCaret + 1);
    await field.press('Escape');
    await clear(page);
    stationary(before, await anchor(page, name));
    expect(await panels(page)).toEqual(layout);
    await expect(comment(page, name)).toHaveText(note);
    if (width === 320) {
      await tapOnce(page, folder(page, name));
      await tapOnce(page, action(page, 'rename'));
      await input.dispatchEvent('compositionstart');
      await input.fill('Composed root');
      await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
      await expect(input).toHaveValue('Composed root');
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1')!).document.root.name)).toBe(name);
      await input.dispatchEvent('compositionend', { data: 'Composed root' });
      await input.press('Escape');
      await expect(folder(page, name)).toBeVisible();
    }
    await shellFits(page, width);
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
  test('maps a native after-subtree drag to the first mobile depth with no extra leading indent', async ({ page }, testInfo) => {
    await load(page, 390, 'en', 'dark');
    const source = 'Project\n    A\n        Source // Move this subtree\n            Leaf // Keep this note\n        B\n            C';
    await page.locator('input[type="file"]').setInputFiles({ name: 'mobile-outdent.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'Source', 'Leaf', 'B', 'C']);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1')!).document);
    await row(page, 'Source').hover();
    const grip = (await row(page, 'Source').locator('.fs-drag-hint').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 10, { steps: 4 });
    const tree = (await page.locator('.fs-tree').boundingBox())!, target = (await row(page, 'C').boundingBox())!;
    const lines: number[] = [];
    for (const [depth, ancestor] of [[3, 'C'], [2, 'B'], [1, 'A']] as const) {
      const x = tree.x + (depth - 1) * 14 + 5, y = target.y + target.height - 2;
      await page.mouse.move(x, y, { steps: 12 });
      await page.mouse.move(x + 1, y);
      const line = page.locator('.fs-drop-line.is-after');
      await expect(line).toHaveCount(1);
      await expect(page.locator('.fs-tree-help')).toContainText(`Release to insert after ${ancestor}`);
      const lineX = (await line.boundingBox())!.x - tree.x;
      expect(lineX).toBeCloseTo((depth - 1) * 14, 1);
      lines.push(lineX);
    }
    expect(lines[0] - lines[1]).toBeCloseTo(14, 1);
    expect(lines[1] - lines[2]).toBeCloseTo(14, 1);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath('mobile-first-depth-outdent-dark.png') });
    await page.mouse.up();
    await expect(page.locator('.fs-selected-path')).toHaveText('Project/Source');
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'A', 'B', 'C', 'Source', 'Leaf']);
    await expect(comment(page, 'Source')).toHaveText('Move this subtree');
    await expect(comment(page, 'Leaf')).toHaveText('Keep this note');
    await page.locator('.fs-history button').first().click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1')!).document)).toEqual(before);
    await shellFits(page, 390);
  });

});
