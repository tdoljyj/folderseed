import { expect, test, type Page } from '@playwright/test';

const THEME_KEY = 'folderseed:theme:v1';
const DRAFT_KEY = 'folderseed:draft:v1';
const app = (page: Page) => page.locator('.fs-app').last();
const menuTrigger = (page: Page) => page.getByRole('button', { name: 'Open FolderSeed menu', exact: true });
const appMenu = (page: Page) => page.getByRole('menu', { name: 'FolderSeed', exact: true });
const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true });

async function loadApp(page: Page, colorScheme: 'light' | 'dark' = 'light', url = '/') {
  await page.emulateMedia({ colorScheme });
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A little structure.');
  await page.evaluate(() => document.fonts.ready);
}

async function openSettings(page: Page) {
  await menuTrigger(page).click();
  await appMenu(page).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(settings(page)).toBeVisible();
  await expect(appMenu(page)).toHaveCount(0);
}

async function chooseTheme(page: Page, name: 'System' | 'Light' | 'Dark') {
  const radio = settings(page).getByRole('radiogroup', { name: 'Theme', exact: true }).getByRole('radio', { name, exact: true });
  await radio.click();
  await expect(radio).toBeChecked();
  await expect(app(page)).toHaveAttribute('data-theme-preference', name.toLowerCase());
}

async function mountWithThemeKey(page: Page, themeStorageKey: string | false) {
  await loadApp(page, 'light', '/examples/index.html');
  await page.evaluate(async key => {
    // Reuse the actual Vite module URLs already loaded by the embedding example.
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const reactUrl = resources.find(url => new URL(url).pathname.endsWith('/deps/react.js'));
    const domUrl = resources.find(url => new URL(url).pathname.endsWith('/deps/react-dom_client.js'));
    if (!reactUrl || !domUrl) throw new Error('The example did not load its React entry modules.');
    const reactModule = await import(reactUrl);
    const domModule = await import(domUrl);
    // Vite may expose optimized CommonJS dependencies through a default namespace.
    const { createElement } = reactModule.default ?? reactModule;
    const { createRoot } = domModule.default ?? domModule;
    const editorUrl = '/src/ui/FolderEditor.tsx';
    const { FolderEditor } = await import(editorUrl);
    document.getElementById('root')!.hidden = true;
    const container = document.createElement('section');
    container.dataset.testid = 'isolated-theme-editor';
    document.body.append(container);
    createRoot(container).render(createElement(FolderEditor, { storageKey: false, themeStorageKey: key }));
  }, themeStorageKey);
  await expect(page.getByTestId('isolated-theme-editor').locator('.fs-app')).toBeVisible();
}

test('defaults to System and follows live operating-system appearance changes', async ({ page }) => {
  await loadApp(page);
  await expect(app(page)).toHaveAttribute('data-theme-preference', 'system');
  await expect(app(page)).toHaveAttribute('data-theme', 'light');
  await openSettings(page);
  await expect(settings(page).getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await expect(settings(page).getByRole('radio', { name: 'System', exact: true })).toBeChecked();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(app(page)).toHaveAttribute('data-theme', 'light');
});

test('applies manual appearance immediately, ignores system changes, and restores the preference after reload', async ({ page }) => {
  await loadApp(page);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await openSettings(page);
  await chooseTheme(page, 'Dark');
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), THEME_KEY)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await settings(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.reload();
  await expect(app(page)).toHaveAttribute('data-theme-preference', 'dark');
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await openSettings(page);
  await expect(settings(page).getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await chooseTheme(page, 'Light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(app(page)).toHaveAttribute('data-theme', 'light');
  await chooseTheme(page, 'System');
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), THEME_KEY)).toBe('system');
});

test('treats an unknown stored preference as System rather than an arbitrary theme', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, 'sepia'), THEME_KEY);
  await loadApp(page, 'dark');
  await expect(app(page)).toHaveAttribute('data-theme-preference', 'system');
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await openSettings(page);
  await expect(settings(page).getByRole('radio', { name: 'System', exact: true })).toBeChecked();
});

test('changing appearance preserves the exact invalid draft and last valid model', async ({ page }) => {
  await loadApp(page);
  await page.getByRole('button', { name: 'Plain text', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Folder structure text', exact: true });
  await input.fill('Project\n    Valid');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document?.root?.name, DRAFT_KEY)).toBe('Project');
  const invalid = 'Project\n    Valid\n       Unfinished';
  await input.fill(invalid);
  await expect(page.locator('.fs-inline-error')).toContainText('Line 3');
  await expect(page.locator('.fs-save-state')).toContainText('Draft invalid');
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').draft, DRAFT_KEY)).toBe(invalid);
  const storedBefore = await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY);
  await openSettings(page);
  await chooseTheme(page, 'Dark');
  await settings(page).getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(input).toHaveValue(invalid);
  await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY)).toBe(storedBefore);
  await page.reload();
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await expect(input).toHaveValue(invalid);
  await expect(page.locator('.fs-inline-error')).toContainText('Line 3');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DRAFT_KEY);
  expect(saved.document.root.children.map((child: { name: string }) => child.name)).toEqual(['Valid']);
  expect(saved.draft).toBe(invalid);
});

test('supports menu keyboard opening, Escape, Tab, and outside dismissal without stealing focus', async ({ page }) => {
  await loadApp(page);
  await expect(menuTrigger(page)).toHaveCount(1);
  await menuTrigger(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(appMenu(page)).toBeVisible();
  await expect(appMenu(page).getByRole('menuitem', { name: 'Settings', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await expect(appMenu(page).getByRole('menuitem', { name: 'Settings', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(appMenu(page)).toHaveCount(0);
  await expect(menuTrigger(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(appMenu(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(appMenu(page)).toHaveCount(0);
  await expect(settings(page)).toHaveCount(0);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Outside host action';
    document.body.prepend(button);
  });
  await menuTrigger(page).click();
  await page.getByRole('button', { name: 'Outside host action', exact: true }).click();
  await expect(appMenu(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Outside host action', exact: true })).toBeFocused();
});

test('supports radio keyboard changes, modal focus containment, and all settings dismissal paths', async ({ page }) => {
  await loadApp(page);
  await openSettings(page);
  await expect(settings(page).getByRole('radio', { name: 'System', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(settings(page).getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
  await expect(settings(page).getByRole('radio', { name: 'Light', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('ArrowLeft');
  await expect(app(page)).toHaveAttribute('data-theme', 'light');
  await settings(page).getByRole('button', { name: 'Done', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(settings(page).getByRole('button', { name: 'Close settings', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(settings(page).getByRole('button', { name: 'Done', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings(page)).toHaveCount(0);
  await expect(menuTrigger(page)).toBeFocused();
  await openSettings(page);
  await expect(settings(page).getByRole('radio', { name: 'Light', exact: true })).toBeFocused();
  await settings(page).getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(menuTrigger(page)).toBeFocused();
  await openSettings(page);
  const box = (await settings(page).boundingBox())!;
  expect(box.x).toBeGreaterThan(5);
  await page.mouse.click(box.x - 4, box.y + box.height / 2);
  await expect(settings(page)).toHaveCount(0);
  await expect(menuTrigger(page)).toBeFocused();
});

test('keeps appearance usable for the session when theme storage is blocked', async ({ page }) => {
  await page.addInitScript(key => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function (name) {
      if (name === key) throw new DOMException('Theme storage blocked', 'SecurityError');
      return originalGet.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Theme storage blocked', 'SecurityError');
      return originalSet.call(this, name, value);
    };
  }, THEME_KEY);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loadApp(page);
  await openSettings(page);
  await chooseTheme(page, 'Dark');
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  await expect(settings(page).getByRole('status')).toHaveText('Theme is kept for this session only.');
  await chooseTheme(page, 'Light');
  await expect(app(page)).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY)).not.toBeNull();
  expect(errors).toEqual([]);
});

test('falls back safely when matchMedia is unavailable and still allows manual themes', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loadApp(page, 'dark');
  await expect(app(page)).toHaveAttribute('data-theme-preference', 'system');
  await expect(app(page)).toHaveAttribute('data-theme', 'light');
  await openSettings(page);
  await chooseTheme(page, 'Dark');
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('uses a custom theme key independently of document persistence and other editor preferences', async ({ page }) => {
  const customKey = 'host:project-a:theme';
  await page.addInitScript(({ defaultKey, customKey }) => {
    localStorage.setItem(defaultKey, 'dark');
    localStorage.setItem(customKey, 'light');
    localStorage.setItem('host:project-b:theme', 'dark');
  }, { defaultKey: THEME_KEY, customKey });
  await mountWithThemeKey(page, customKey);
  await expect(app(page)).toHaveAttribute('data-theme-preference', 'light');
  await openSettings(page);
  await chooseTheme(page, 'System');
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), customKey)).toBe('system');
  expect(await page.evaluate(key => localStorage.getItem(key), THEME_KEY)).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('host:project-b:theme'))).toBe('dark');
  expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY)).toBeNull();
});

test('can disable theme persistence without reading or changing the default preference', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, 'dark'), THEME_KEY);
  await mountWithThemeKey(page, false);
  await expect(app(page)).toHaveAttribute('data-theme-preference', 'system');
  await expect(app(page)).toHaveAttribute('data-theme', 'light');
  await openSettings(page);
  await chooseTheme(page, 'Light');
  expect(await page.evaluate(key => localStorage.getItem(key), THEME_KEY)).toBe('dark');
  expect(await page.evaluate(key => localStorage.getItem(key), DRAFT_KEY)).toBeNull();
});

test('scopes appearance to the embedded app without changing host styles or emitting document changes', async ({ page }) => {
  await loadApp(page, 'light', '/examples/index.html');
  await expect(page.getByTestId('host-update-count')).toHaveText('1');
  const hostAppearance = () => page.evaluate(() => {
    const host = document.querySelector('section[aria-label="Project folder settings"] > header')!;
    return {
      htmlClass: document.documentElement.className, htmlStyle: document.documentElement.getAttribute('style'),
      bodyClass: document.body.className, bodyStyle: document.body.getAttribute('style'),
      htmlTheme: document.documentElement.getAttribute('data-theme'), bodyTheme: document.body.getAttribute('data-theme'),
      hostColor: getComputedStyle(host).color, hostBackground: getComputedStyle(host).backgroundColor,
      hostColorScheme: getComputedStyle(host).colorScheme, bodyColorScheme: getComputedStyle(document.body).colorScheme,
    };
  });
  const before = await hostAppearance();
  await openSettings(page);
  await chooseTheme(page, 'Dark');
  await settings(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(app(page)).toHaveAttribute('data-theme', 'dark');
  expect(await hostAppearance()).toEqual(before);
  await expect(page.getByTestId('host-update-count')).toHaveText('1');
});

test('renders light and dark desktop menus and dark settings without viewport overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await loadApp(page);
  await menuTrigger(page).click();
  await expect(appMenu(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('theme-light-desktop-menu.png'), fullPage: true });
  await appMenu(page).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await chooseTheme(page, 'Dark');
  await page.screenshot({ path: testInfo.outputPath('theme-dark-desktop-settings.png'), fullPage: true });
  await settings(page).getByRole('button', { name: 'Done', exact: true }).click();
  await menuTrigger(page).click();
  await expect(appMenu(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('theme-dark-desktop-menu.png'), fullPage: true });
});

test('offers the same settings at 360 pixels and restores focus after switching to desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await loadApp(page);
  await expect(menuTrigger(page)).toHaveCount(1);
  await menuTrigger(page).click();
  await expect(appMenu(page)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('theme-light-mobile-menu.png'), fullPage: true });
  await appMenu(page).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await chooseTheme(page, 'Dark');
  const dialogBox = (await settings(page).boundingBox())!;
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(360);
  for (const radio of await settings(page).getByRole('radio').all()) {
    const box = (await radio.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('theme-dark-mobile-settings.png'), fullPage: true });
  await settings(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(menuTrigger(page)).toBeFocused();
  await menuTrigger(page).click();
  await page.screenshot({ path: testInfo.outputPath('theme-dark-mobile-menu.png'), fullPage: true });
  await appMenu(page).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await settings(page).getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(menuTrigger(page)).toHaveCount(1);
  await expect(menuTrigger(page)).toBeFocused();
});
