import { expect, test, type Page } from '@playwright/test';

// Generated output has a canonical grid. Raw text is deliberately not reformatted
// merely to fit that grid: source spelling, indentation and IME selection win.
test.use({ locale: 'en-US' });
const DRAFT_KEY = 'folderseed:draft:v1';
const input = (page: Page) => page.locator('.fs-text-area textarea');

async function load(page: Page, raw: string) {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.addInitScript(() => localStorage.setItem('folderseed:language:v1', 'en'));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.locator('input[type="file"]').setInputFiles({ name: 'raw-layout.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document?.root?.name, DRAFT_KEY)).toBe('Project');
  await page.locator('.fs-format-activate').click();
  await expect(input(page)).toBeVisible();
  await expect(input(page)).toHaveValue(raw);
}
async function sourceState(page: Page) {
  return input(page).evaluate((element: HTMLTextAreaElement) => ({
    value: element.value, start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection,
  }));
}
async function resizeAndRetain(page: Page, expected: Awaited<ReturnType<typeof sourceState>>) {
  for (const width of [390, 1920, 1440]) {
    await page.setViewportSize({ width, height: 1050 });
    // ResizeObserver and font measurement may update layout, never textarea bytes/caret.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await sourceState(page)).toEqual(expected);
    await expect(input(page)).toHaveCSS('line-height', '34px');
    if (width === 390) expect(await input(page).evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
}

for (const raw of [
  'Project // Root note\n  A // Short\n  Longer child       // Deliberate spacing',
  'Project // Root note\n  Same // First\n  Same // Duplicate invalid draft',
]) {
  test(`preserves ${raw.includes('Duplicate') ? 'invalid' : 'valid'} raw draft spacing and selection on resize and preview changes`, async ({ page }) => {
    const valid = 'Project // Root note\n  A // Short\n  Longer child       // Deliberate spacing';
    await load(page, valid);
    if (raw !== valid) {
      await input(page).fill(raw);
      await expect(page.locator('.fs-text-area .fs-inline-error')).toBeVisible();
    }
    await input(page).evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(5, 12, 'backward'); });
    const before = await sourceState(page);
    await resizeAndRetain(page, before);
    for (const preview of ['Text tree', 'Folders'] as const) {
      await page.getByRole('button', { name: preview, exact: true }).click();
      expect(await sourceState(page)).toEqual(before);
    }
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').draft, DRAFT_KEY)).toBe(raw);
    await page.reload();
    await expect(input(page)).toHaveValue(raw);
  });
}

test('does not realign a composing or newly typed raw draft during responsive measurement', async ({ page }) => {
  await load(page, 'Project // Original\n  Child // Original child');
  const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document, DRAFT_KEY);
  const composed = 'Project // 正在输入\n  Child      // 保留我的空格';
  await input(page).dispatchEvent('compositionstart', { data: '' });
  await input(page).fill(composed);
  await input(page).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(11, 15));
  const composing = await sourceState(page);
  await resizeAndRetain(page, composing);
  await page.getByRole('button', { name: 'Text tree', exact: true }).click();
  expect(await sourceState(page)).toEqual(composing);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document, DRAFT_KEY)).toEqual(original);
  await expect(page.locator('.fs-download')).toBeDisabled();
  await input(page).dispatchEvent('compositionend', { data: '正在输入' });
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document.root.comment, DRAFT_KEY)).toBe('正在输入');
  expect(await sourceState(page)).toEqual(composing);

  const typed = 'Project // Typed\n  Child           // Keep this spacing too';
  await input(page).fill(typed);
  await input(page).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(8, 13, 'forward'));
  const pending = await sourceState(page);
  await resizeAndRetain(page, pending);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').draft, DRAFT_KEY)).toBe(typed);
  expect(await sourceState(page)).toEqual(pending);
});


for (const width of [1440, 390]) {
  test(`keeps a commentless tree compact and preserves first-comment cancel/save/undo at ${width}px`, async ({ page }) => {
    const raw = 'Project\n  Client deliverables — approved photography and campaign artwork';
    await load(page, raw);
    await page.setViewportSize({ width, height: 1050 });
    await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
    const cell = page.getByRole('button', { name: 'Edit comment for Project', exact: true });
    const column = () => page.locator('.fs-app').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--fs-shared-comment-x')));
    const initialColumn = await column();
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document, DRAFT_KEY);
    const before = await saved();
    const rows = () => page.locator('.fs-tree').evaluate(tree => [...tree.querySelectorAll('.fs-tree-row')].map(row => {
      const box = row.getBoundingClientRect(), origin = tree.getBoundingClientRect();
      return { y: box.y - origin.y + tree.scrollTop, height: box.height };
    }));
    const baseline = await rows();
    expect(await page.locator('.fs-tree').evaluate(tree => tree.scrollWidth <= tree.clientWidth + 1)).toBe(true);
    await cell.click();
    const editor = page.locator('.fs-inline-comment');
    await expect(editor).toBeFocused();
    await editor.fill('Cancelled first note');
    expect(await column()).toBeCloseTo(initialColumn, 1);
    await editor.press('Escape');
    expect(await saved()).toEqual(before);
    expect(await column()).toBeCloseTo(initialColumn, 1);
    await cell.click();
    await editor.fill('First saved note');
    await expect(editor).toBeFocused();
    await editor.press('Enter');
    await expect.poll(async () => (await saved()).root.comment).toBe('First saved note');
    expect(await rows()).toEqual(baseline);
    if (width > 800) expect(await column()).toBeGreaterThan(initialColumn);
    else expect(await column()).toBeCloseTo(initialColumn, 1);
    await page.locator('.fs-editor').press('Control+z');
    await expect.poll(saved).toEqual(before);
    expect(await rows()).toEqual(baseline);
    expect(await column()).toBeCloseTo(initialColumn, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('freezes a localized clean draft on focus before responsive font changes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('folderseed:language:v1', 'en'));
  await page.reload();
  await page.locator('.fs-format-activate').click();
  await input(page).focus();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').generated, DRAFT_KEY)).toBe(false);
  await page.evaluate(() => localStorage.setItem('folderseed:language:v1', 'zh-CN'));
  await page.reload();
  await input(page).focus();
  await input(page).evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 12));
  const frozen = await sourceState(page);
  await resizeAndRetain(page, frozen);
});
