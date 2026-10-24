import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });

const sidebar = (page: Page) => page.locator('.fs-sidebar');
const navigation = (page: Page) => page.locator('.fs-sidebar-navigation');
const trigger = (page: Page) => page.locator('.fs-app-menu-trigger:visible');
const menu = (page: Page) => page.getByRole('menu', { name: 'FolderSeed', exact: true });
const settings = (page: Page) => page.locator('.fs-settings-dialog');

async function loadApp(page: Page, width = 1440, height = 1000, language = 'en') {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(value => localStorage.setItem('folderseed:language:v1', value), language);
  await page.goto('/');
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', language);
  await expect(sidebar(page)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function paintWheel(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function pageScroll(page: Page) {
  return page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
}

async function wheelMainTo(page: Page, target: number) {
  const point = await page.locator('.fs-main').evaluate(main => {
    const box = main.getBoundingClientRect();
    const x = Math.max(4, box.left + 8);
    const y = innerHeight / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, mainGutter: !!hit?.closest('.fs-main') && !hit.closest('.fs-tree, .fs-sidebar, textarea, select') };
  });
  expect(point.mainGutter, 'The real wheel targets the main gutter, never the folder tree').toBe(true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, target - (await pageScroll(page)).y);
  await paintWheel(page);
  await expect.poll(async () => (await pageScroll(page)).y).toBeCloseTo(target, 0);
}

async function sidebarBounds(page: Page, includeNavigation = true) {
  return sidebar(page).evaluate((aside, include) => {
    const selectors = ['.fs-brand', '.fs-privacy-card', '.fs-sidebar-footer', '.fs-sidebar-footer .fs-app-menu-trigger'];
    if (include) selectors.push('.fs-sidebar-navigation', '.fs-nav-active', '.fs-templates');
    return Object.fromEntries(selectors.map(selector => {
      const { x, y, width, height } = aside.querySelector(selector)!.getBoundingClientRect();
      return [selector, { x, y, width, height }];
    }));
  }, includeNavigation);
}

async function clickVisibleCenter(locator: Locator) {
  const point = await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, inside: box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, receivesPointer: hit === element || !!hit && element.contains(hit) };
  });
  expect(point.inside, 'The control is already fully inside the viewport before clicking').toBe(true);
  expect(point.receivesPointer, 'The visible center routes to the control without locator auto-scrolling').toBe(true);
  await locator.page().mouse.click(point.x, point.y);
}

async function expectPopupInsideViewport(page: Page) {
  await expect(menu(page)).toBeVisible();
  const bounds = await menu(page).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight };
  });
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
}

async function wheelNavigationTo(page: Page, target: number) {
  const area = await navigation(page).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, scrollTop: element.scrollTop };
  });
  await page.mouse.move(area.x, area.y);
  await page.mouse.wheel(0, target - area.scrollTop);
  await paintWheel(page);
  await expect.poll(() => navigation(page).evaluate(element => element.scrollTop)).toBeCloseTo(target, 0);
}

test('keeps every desktop sidebar section stationary while the main page scrolls', async ({ page }, testInfo) => {
  await loadApp(page);
  const initial = await sidebarBounds(page);
  const scroll = await pageScroll(page);
  expect(scroll.y).toBe(0);
  expect(scroll.max).toBeGreaterThan(100);
  for (const target of [Math.floor(scroll.max / 2), scroll.max]) {
    await wheelMainTo(page, target);
    expect(await sidebarBounds(page)).toEqual(initial);
    const box = (await sidebar(page).boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.height).toBe(1000);
  }
  // A viewport screenshot preserves the actual scrolled position and sticky sidebar.
  await page.screenshot({ path: testInfo.outputPath('sidebar-desktop-main-scrolled.png') });
  await wheelMainTo(page, 0);
  expect(await sidebarBounds(page)).toEqual(initial);
});

test('scrolls short desktop navigation independently and keeps every template and Settings reachable', async ({ page }, testInfo) => {
  await loadApp(page, 900, 600);
  const stationary = await sidebarBounds(page, false);
  const limit = await navigation(page).evaluate(element => element.scrollHeight - element.clientHeight);
  expect(limit).toBeGreaterThan(0);
  await wheelNavigationTo(page, limit);
  expect((await pageScroll(page)).y).toBe(0);
  expect(await sidebarBounds(page, false)).toEqual(stationary);
  await page.mouse.wheel(0, 240);
  await paintWheel(page);
  expect((await pageScroll(page)).y).toBe(0);

  const templates = navigation(page).locator('.fs-template');
  await expect(templates).toHaveCount(4);
  for (const template of await templates.all()) {
    const target = await template.evaluate(button => {
      const area = button.closest<HTMLElement>('.fs-sidebar-navigation')!;
      const box = button.getBoundingClientRect();
      const areaBox = area.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(area.scrollHeight - area.clientHeight, area.scrollTop + box.y + box.height / 2 - areaBox.y - area.clientHeight / 2)));
    });
    await wheelNavigationTo(page, target);
    await clickVisibleCenter(template);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await pageScroll(page)).y).toBe(0);
    expect(await sidebarBounds(page, false)).toEqual(stationary);
  }
  await clickVisibleCenter(trigger(page));
  await expectPopupInsideViewport(page);
  await page.screenshot({ path: testInfo.outputPath('sidebar-short-height-menu.png') });
  await clickVisibleCenter(menu(page).getByRole('menuitem'));
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  expect((await pageScroll(page)).y).toBe(0);
});

test('opens the bottom sidebar menu and restores Settings focus without scrolling the main page', async ({ page }) => {
  await loadApp(page);
  const bottom = (await pageScroll(page)).max;
  await wheelMainTo(page, bottom);
  const before = await sidebarBounds(page);
  await clickVisibleCenter(trigger(page));
  await expectPopupInsideViewport(page);
  expect((await pageScroll(page)).y).toBe(bottom);
  await clickVisibleCenter(menu(page).getByRole('menuitem'));
  await expect(settings(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  expect((await pageScroll(page)).y).toBe(bottom);
  expect(await sidebarBounds(page)).toEqual(before);
});

test('keeps the Arabic desktop sidebar and its popup in bounds without changing host direction', async ({ page }, testInfo) => {
  await loadApp(page, 1440, 1000, 'ar');
  await expect(page.locator('.fs-app')).toHaveAttribute('dir', 'rtl');
  expect(await page.locator('html').getAttribute('lang')).toBe('en');
  expect(await page.locator('html').getAttribute('dir')).not.toBe('rtl');
  const initial = await sidebarBounds(page);
  const side = (await sidebar(page).boundingBox())!;
  const main = (await page.locator('.fs-main').boundingBox())!;
  expect(side.x).toBeGreaterThan(main.x);
  await wheelMainTo(page, (await pageScroll(page)).max);
  expect(await sidebarBounds(page)).toEqual(initial);
  await clickVisibleCenter(trigger(page));
  await expectPopupInsideViewport(page);
  await page.screenshot({ path: testInfo.outputPath('sidebar-arabic-scrolled-menu.png') });
  await clickVisibleCenter(menu(page).getByRole('menuitem'));
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('preserves the mobile scrolling header and keeps its Settings menu reachable', async ({ page }, testInfo) => {
  await loadApp(page, 360, 800);
  await expect(navigation(page)).not.toBeVisible();
  await expect(page.locator('.fs-sidebar-footer')).not.toBeVisible();
  await expect(trigger(page)).toHaveCount(1);
  const initial = (await sidebar(page).boundingBox())!;
  const target = Math.min(500, (await pageScroll(page)).max);
  expect(target).toBeGreaterThan(initial.height);
  await wheelMainTo(page, target);
  const scrolled = (await sidebar(page).boundingBox())!;
  expect(scrolled.y).toBeCloseTo(initial.y - target, 0);
  expect(scrolled.height).toBe(initial.height);
  expect(scrolled.y + scrolled.height).toBeLessThan(0);
  await wheelMainTo(page, 0);
  await clickVisibleCenter(trigger(page));
  await expectPopupInsideViewport(page);
  await page.screenshot({ path: testInfo.outputPath('sidebar-mobile-menu.png') });
  await clickVisibleCenter(menu(page).getByRole('menuitem'));
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
