import { expect, test, type Locator, type Page } from '@playwright/test';
import { parseText, serializeJSON } from '../../src/core';

test.use({ locale: 'en-US', isMobile: true, hasTouch: true });

const widths = [320, 360, 390, 430];
const rootName = `Workspace ${'planning'.repeat(10)}`;
const note = 'Optional reference notes with multilingual text 我的说明 العربية. '.repeat(5);
const outline = [
  `${rootName} // ${note}`,
  ...Array.from({ length: 20 }, (_, index) => `${'    '.repeat(index + 1)}Level ${index + 1} ${'documentation'.repeat(5)} // ${note}`),
].join('\n');
const wireDocument = JSON.parse(serializeJSON(parseText(outline, 'plain')));

async function expectShellContained(page: Page, width: number) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    boxes: ['.fs-app', '.fs-sidebar', '.fs-main'].map(selector => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      return { selector, left: rect.left, right: rect.right, width: rect.width };
    }),
    overflow: ['html', 'body', '#root', '.fs-app', '.fs-sidebar', '.fs-main'].map(selector => ({
      selector, value: getComputedStyle(document.querySelector(selector)!).overflowX,
    })),
  }));
  // A mobile layout viewport must not expand to hide a shell overflow at its initial scale.
  expect(layout.viewport).toBe(width);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport);
  for (const box of layout.boxes) {
    expect(box.width, `${box.selector} has a real layout width`).toBeGreaterThan(0);
    expect(box.left, `${box.selector} left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(box.right, `${box.selector} right edge`).toBeLessThanOrEqual(width + 0.5);
  }
  for (const style of layout.overflow) {
    expect(['hidden', 'clip'].includes(style.value), `${style.selector} must fit without a clipping mask`).toBe(false);
  }
}

async function tapVisibleCenter(page: Page, target: Locator, width: number) {
  await expect(target).toBeVisible();
  const point = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      width: box.width, height: box.height, viewportHeight: innerHeight,
      receivesPointer: hit === element || !!hit && element.contains(hit) };
  });
  expect(point.left).toBeGreaterThanOrEqual(0);
  expect(point.right).toBeLessThanOrEqual(width);
  expect(point.top).toBeGreaterThanOrEqual(0);
  expect(point.bottom).toBeLessThanOrEqual(point.viewportHeight);
  expect(point.width).toBeGreaterThanOrEqual(24);
  expect(point.height).toBeGreaterThanOrEqual(24);
  expect(point.receivesPointer, 'the visible center remains inside the actual control').toBe(true);
  await page.touchscreen.tap(point.x, point.y);
}

async function headerBounds(page: Page) {
  return page.locator('.fs-sidebar').evaluate(sidebar =>
    [sidebar, sidebar.querySelector('.fs-brand')!, sidebar.querySelector('.fs-app-menu-mobile .fs-app-menu-trigger')!].map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
}

for (const locale of ['en', 'zh-CN', 'ar']) {
  test(`keeps the mobile header and Settings reachable at 320–430 pixels with a saved deep project in ${locale}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.addInitScript(({ language, document, draft }) => {
      localStorage.setItem('folderseed:language:v1', language);
      localStorage.setItem('folderseed:theme:v1', 'light');
      localStorage.setItem('folderseed:draft:v1', JSON.stringify({ document, draft, pending: false, mode: 'visual', textFormat: 'plain', indent: 4 }));
    }, { language: locale, document: wireDocument, draft: outline });

    for (const width of widths) {
      await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: width === 430 ? 'reduce' : 'no-preference' });
        await page.goto('/');
        await expect(page.locator('.fs-app')).toHaveAttribute('lang', locale);
        await expect(page.locator('.fs-app')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('.fs-folder-name').first()).toHaveText(rootName);
        await expect(page.locator('.fs-folder-name')).toHaveCount(21);
        await expect(page.locator('.fs-folder-comment').first()).toHaveAttribute('title', note);
        await expectShellContained(page, width);
        // Deep indentation is scrollable locally, never by widening or clipping the page shell.
        expect(await page.locator('.fs-tree').evaluate(tree => tree.scrollWidth > tree.clientWidth)).toBe(true);
        const trigger = page.locator('.fs-app-menu-mobile .fs-app-menu-trigger');
        await tapVisibleCenter(page, trigger, width);
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const menu = page.locator('.fs-app-menu-mobile [role="menu"]');
        await expect(menu).toBeVisible();
        const menuBounds = (await menu.boundingBox())!;
        expect(menuBounds.x).toBeGreaterThanOrEqual(0);
        expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width);
        await expectShellContained(page, width);
        await tapVisibleCenter(page, menu.getByRole('menuitem'), width);
        const dialog = page.locator('.fs-settings-dialog');
        await expect(dialog).toBeVisible();
        const bounds = (await dialog.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await expectShellContained(page, width);
        if (width === 320) await page.screenshot({ path: testInfo.outputPath(`settings-${locale}-320.png`) });
        await tapVisibleCenter(page, dialog.locator('.fs-dialog-top .fs-icon-button'), width);
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await expectShellContained(page, width);
        if (width === 320) await page.screenshot({ path: testInfo.outputPath(`header-${locale}-320.png`) });
        // Leave restored header focus before checking ordinary page-scroll behavior.
        await page.locator('.fs-heading h1').click();
        const header = page.locator('.fs-sidebar');
        const beforeScroll = await headerBounds(page);
        const mainFlow = () => page.locator('.fs-main').evaluate(main => {
          const box = main.getBoundingClientRect();
          return { top: box.top + scrollY, height: box.height };
        });
        const flowBefore = await mainFlow();
        const scrollPage = async (top: number) => {
          await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), top);
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        };
        for (const top of [10, 8, 16, 0]) {
          await scrollPage(top);
          await expect(header).not.toHaveClass(/is-scroll-hidden/);
        }
        await scrollPage(600);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(150);
        await expect(header).toHaveClass(/is-scroll-hidden/);
        await expect.poll(async () => { const box = (await header.boundingBox())!; return box.y + box.height; }).toBeLessThanOrEqual(0.5);
        const hidden = await headerBounds(page);
        for (const [index, bounds] of beforeScroll.entries()) {
          for (const key of ['x', 'width', 'height'] as const) expect(hidden[index][key]).toBeCloseTo(bounds[key], 1);
        }
        expect(await mainFlow()).toEqual(flowBefore);
        await expectShellContained(page, width);
        await scrollPage((await page.evaluate(() => scrollY)) - 40);
        await expect(header).not.toHaveClass(/is-scroll-hidden/);
        await expect.poll(async () => (await header.boundingBox())!.y).toBeCloseTo(0, 1);
        expect(await headerBounds(page)).toEqual(beforeScroll);
        if (width === 430) {
          expect(await header.evaluate(element => getComputedStyle(element).transitionDuration.split(',').every(duration => parseFloat(duration) === 0))).toBe(true);
        }

        // Keyboard-visible focus, the open menu, and Settings keep the bar usable while the document moves.
        await page.keyboard.press('Tab');
        await trigger.focus();
        expect(await trigger.evaluate(element => element.matches(':focus-visible'))).toBe(true);
        await scrollPage((await page.evaluate(() => scrollY)) + 30);
        await expect(header).not.toHaveClass(/is-scroll-hidden/);
        await tapVisibleCenter(page, trigger, width);
        await expect(menu).toBeVisible();
        await scrollPage((await page.evaluate(() => scrollY)) + 40);
        await expect(header).not.toHaveClass(/is-scroll-hidden/);
        await tapVisibleCenter(page, menu.getByRole('menuitem'), width);
        await expect(dialog).toBeVisible();
        await scrollPage((await page.evaluate(() => scrollY)) - 80);
        await scrollPage((await page.evaluate(() => scrollY)) + 40);
        await expect(header).not.toHaveClass(/is-scroll-hidden/);
        const scrolledDialog = (await dialog.boundingBox())!;
        expect(scrolledDialog.x).toBeGreaterThanOrEqual(0);
        expect(scrolledDialog.x + scrolledDialog.width).toBeLessThanOrEqual(width);
        if (width === 320) await page.screenshot({ path: testInfo.outputPath(`settings-scrolled-${locale}-320.png`) });
        const scrollPosition = await page.evaluate(() => scrollY);
        await tapVisibleCenter(page, dialog.locator('.fs-dialog-top .fs-icon-button'), width);
        await expect(dialog).toHaveCount(0);
        expect(await page.evaluate(() => scrollY)).toBeCloseTo(scrollPosition, 1);
        expect(await mainFlow()).toEqual(flowBefore);
        await expectShellContained(page, width);

        // Selecting deep content may scroll the page; subsequent tree-only scrolling must not control its header.
        await page.locator('.fs-folder-select').last().click();
        await expect(page.locator('.fs-folder-select').last()).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.fs-floating-actions')).toBeVisible();
        await expectShellContained(page, width);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const treeOnlyState = await header.getAttribute('class');
        const documentScroll = await page.evaluate(() => scrollY);
        for (const edge of ['start', 'end']) {
          await page.locator('.fs-tree').evaluate((tree, edge) => {
            tree.scrollLeft = edge === 'start' ? 0 : tree.scrollWidth - tree.clientWidth;
            tree.scrollTop = edge === 'start' ? 0 : tree.scrollHeight - tree.clientHeight;
          }, edge);
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          if (edge === 'end') {
            expect(await page.locator('.fs-tree').evaluate(tree => tree.scrollLeft)).toBeGreaterThan(0);
            expect(await page.locator('.fs-tree').evaluate(tree => tree.scrollTop)).toBeGreaterThan(0);
          }
          expect(await header.getAttribute('class')).toBe(treeOnlyState);
          expect(await page.evaluate(() => scrollY)).toBe(documentScroll);
          await expectShellContained(page, width);
        }
        expect(await mainFlow()).toEqual(flowBefore);
        await scrollPage(0);
        await expect(header).not.toHaveClass(/is-scroll-hidden/);
        await expect.poll(async () => (await header.boundingBox())!.y).toBeCloseTo(0, 1);

      });
    }
  });
}
