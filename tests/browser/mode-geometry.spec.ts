import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });

const DRAFT_KEY = 'folderseed:draft:v1';
const LANGUAGE_KEY = 'folderseed:language:v1';
const formats = ['plain', 'markdown', 'ascii', 'unicode'] as const;
const scenarios = [
  { name: 'English desktop', locale: 'en', width: 1440, height: 1050 },
  { name: 'Chinese mobile', locale: 'zh-CN', width: 360, height: 900 },
  { name: 'Arabic mobile', locale: 'ar', width: 360, height: 900 },
] as const;

type Dimensions = { x: number; y: number; width: number; height?: number };
type Layout = Record<string, Dimensions>;

const visualButton = (page: Page) => page.locator('.fs-editor-tabs button[aria-controls="visual-editor"]');
const textInput = (page: Page) => page.locator('.fs-text-area textarea');

async function prepare(page: Page, scenario: typeof scenarios[number]) {
  await page.setViewportSize({ width: scenario.width, height: scenario.height });
  await page.addInitScript(({ key, locale }) => localStorage.setItem(key, locale), { key: LANGUAGE_KEY, locale: scenario.locale });
  await page.goto('/');
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', scenario.locale);
  await expect(page.locator('.fs-app')).toHaveAttribute('dir', scenario.locale === 'ar' ? 'rtl' : 'ltr');
  await page.evaluate(() => document.fonts.ready);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'mode-geometry.txt', mimeType: 'text/plain', buffer: Buffer.from('Project\n    Kept\n    محفوظ'),
  });
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Kept', 'محفوظ']);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document?.root?.name, DRAFT_KEY)).toBe('Project');
}

async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => Object.fromEntries([
    '.fs-editor', '.fs-preview', '.fs-workspace-grid', '.fs-export',
  ].map(selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing layout landmark: ${selector}`);
    const box = element.getBoundingClientRect();
    // Browser scrolling to a control must not masquerade as a layout change.
    const dimensions = { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width };
    // The export explanation can legitimately wrap when a draft is invalid; its position must not move.
    return [selector, selector === '.fs-export' ? dimensions : { ...dimensions, height: box.height }];
  })));
}

async function expectSameLayout(page: Page, expected: Layout, state: string) {
  const actual = await layout(page);
  for (const [selector, dimensions] of Object.entries(expected)) {
    for (const property of Object.keys(dimensions) as (keyof Dimensions)[]) {
      expect(Math.abs(actual[selector][property]! - dimensions[property]!), `${state}: ${selector} ${property}`).toBeLessThanOrEqual(0.75);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${state}: no horizontal page overflow`).toBe(true);
}

async function chooseFormat(page: Page, format: typeof formats[number]) {
  await page.locator('.fs-format-menu-trigger').click();
  await page.locator('.fs-format-menu [role="menuitemradio"]').nth(formats.indexOf(format)).click();
  await expect(textInput(page)).toBeVisible();
  await expect(page.locator('.fs-format-activate')).toHaveAttribute('aria-pressed', 'true');
}

async function savedDocument(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document, DRAFT_KEY);
}

for (const scenario of scenarios) {
  test(`preserves workspace geometry through repeated Visual and all text-format switches on ${scenario.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await prepare(page, scenario);
    const baseline = await layout(page);
    const documentBefore = await savedDocument(page);
    const previewBefore = await page.locator('.fs-preview-row').allTextContents();
    await testInfo.attach('visual-layout', { body: JSON.stringify(baseline), contentType: 'application/json' });

    for (let round = 0; round < 2; round++) {
      // Cover both reserved empty-footer space and a visible selected path/Move control.
      if (round === 1) {
        await page.locator('.fs-folder-select[title="Project"]').click();
        await expectSameLayout(page, baseline, 'selected visual folder');
      }
      for (const format of formats) {
        await chooseFormat(page, format);
        await expect(page.locator('.fs-text-area .fs-inline-error')).toHaveCount(0);
        await expectSameLayout(page, baseline, `round ${round + 1}: ${format}`);
        expect(await page.locator('.fs-preview-row').allTextContents()).toEqual(previewBefore);
        await visualButton(page).click();
        await expect(page.locator('.fs-visual-area')).toBeVisible();
        await expectSameLayout(page, baseline, `round ${round + 1}: Visual after ${format}`);
        await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Kept', 'محفوظ']);
      }
    }

    // Reopening the current format through the label must use the same stable content frame.
    await page.locator('.fs-format-activate').click();
    await expectSameLayout(page, baseline, 'reopened current text format');
    expect(await savedDocument(page)).toEqual(documentBefore);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`mode-geometry-${scenario.locale}-valid.png`) });

    // The empty-root hint is another mode-specific element and must not resize the shared body.
    await visualButton(page).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'empty-root.txt', mimeType: 'text/plain', buffer: Buffer.from('Root only') });
    await expect(page.locator('.fs-folder-name')).toHaveText(['Root only']);
    await expect(page.locator('.fs-empty-hint')).toBeVisible();
    await expectSameLayout(page, baseline, 'root-only Visual with empty-state hint');
    await chooseFormat(page, 'plain');
    await expectSameLayout(page, baseline, 'root-only plain text');
    await visualButton(page).click();
    await expect(page.locator('.fs-empty-hint')).toBeVisible();
    await expectSameLayout(page, baseline, 'root-only Visual restored');
  });

  test(`bounds resized text and wrapped invalid feedback without losing error protection on ${scenario.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await prepare(page, scenario);
    const baseline = await layout(page);
    const documentBefore = await savedDocument(page);
    const previewBefore = await page.locator('.fs-preview-row').allTextContents();
    await chooseFormat(page, 'plain');
    await expectSameLayout(page, baseline, 'initial plain text');

    const duplicate = 'Repeated' + 'x'.repeat(92);
    const invalid = ['Project', `    ${duplicate}`, `    ${duplicate}`,
      ...Array.from({ length: 180 }, (_, index) => `    Unfinished ${index}`),
    ].join('\n');
    await textInput(page).fill(invalid);
    const error = page.locator('.fs-text-area .fs-inline-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(duplicate);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').draft, DRAFT_KEY)).toBe(invalid);
    await expectSameLayout(page, baseline, 'long invalid draft');
    await expect(page.locator('.fs-download')).toBeDisabled();
    await expect(page.locator('.fs-import')).toBeDisabled();
    await expect(page.locator('.fs-copy')).toBeDisabled();
    expect(await savedDocument(page)).toEqual(documentBefore);
    expect(await page.locator('.fs-preview-row').allTextContents()).toEqual(previewBefore);

    const overflow = await error.evaluate(element => {
      const area = element.closest<HTMLElement>('.fs-text-area')!;
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      return {
        errorFits: element.scrollWidth <= element.clientWidth + 1,
        areaFits: area.scrollWidth <= area.clientWidth + 1,
        height: element.clientHeight,
        lineHeight: Number.isFinite(lineHeight) ? lineHeight : 16,
      };
    });
    expect(overflow.errorFits, 'long folder names wrap inside the error').toBe(true);
    expect(overflow.areaFits, 'feedback does not create horizontal body scrolling').toBe(true);
    if (scenario.width === 360) expect(overflow.height).toBeGreaterThan(overflow.lineHeight * 2);

    const textScroll = await textInput(page).evaluate(element => {
      element.scrollTop = element.scrollHeight;
      return { scrollable: element.scrollHeight > element.clientHeight, top: element.scrollTop };
    });
    expect(textScroll.scrollable).toBe(true);
    expect(textScroll.top).toBeGreaterThan(0);
    await expectSameLayout(page, baseline, 'textarea scrolled to its last line');

    // Stress the same CSS sizing boundary as a very large native textarea resize, without grip-coordinate flakiness.
    await expect(textInput(page)).toHaveCSS('resize', 'vertical');
    await textInput(page).evaluate(element => { element.style.height = '10000px'; });
    const resized = await textInput(page).evaluate(element => ({
      height: element.getBoundingClientRect().height,
      bodyHeight: element.closest('.fs-text-area')!.getBoundingClientRect().height,
    }));
    expect(resized.height).toBeLessThanOrEqual(resized.bodyHeight);
    await expectSameLayout(page, baseline, 'oversized textarea resize');

    // Correction remains reachable by scrolling inside the bounded body, not by growing either panel.
    const revert = page.locator('.fs-text-actions button');
    await revert.scrollIntoViewIfNeeded();
    const correction = await revert.evaluate(element => {
      const area = element.closest<HTMLElement>('.fs-text-area')!;
      const box = element.getBoundingClientRect();
      const body = area.getBoundingClientRect();
      return {
        top: box.top, bottom: box.bottom, bodyTop: body.top, bodyBottom: body.bottom,
        scrollTop: area.scrollTop,
        hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === element,
      };
    });
    expect(correction.scrollTop).toBeGreaterThan(0);
    expect(correction.top).toBeGreaterThanOrEqual(correction.bodyTop - 1);
    expect(correction.bottom).toBeLessThanOrEqual(correction.bodyBottom + 1);
    expect(correction.hit, 'Revert can receive a real pointer click after internal scrolling').toBe(true);
    await expectSameLayout(page, baseline, 'feedback scrolled to Revert');
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`mode-geometry-${scenario.locale}-invalid.png`) });
    await textInput(page).evaluate(element => element.style.removeProperty('height'));

    // Invalid drafts may be reinterpreted, but neither tab switching nor format switching may discard them.
    for (const format of ['markdown', 'ascii', 'unicode', 'plain'] as const) {
      await chooseFormat(page, format);
      await expect(textInput(page)).toHaveValue(invalid);
      await expect(error).toBeVisible();
      await expectSameLayout(page, baseline, `invalid ${format}`);
      await visualButton(page).click();
      await expect(textInput(page)).toBeVisible();
      await expect(textInput(page)).toHaveValue(invalid);
      await expect(page.locator('.fs-download')).toBeDisabled();
      await expectSameLayout(page, baseline, `blocked Visual switch from ${format}`);
      expect(await savedDocument(page)).toEqual(documentBefore);
    }

    await revert.click();
    await expect(error).toHaveCount(0);
    await expect(page.locator('.fs-download')).toBeEnabled();
    await expectSameLayout(page, baseline, 'reverted valid text');
    await visualButton(page).click();
    await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Kept', 'محفوظ']);
    await expectSameLayout(page, baseline, 'Visual restored after invalid draft');
    expect(await savedDocument(page)).toEqual(documentBefore);
  });
}
