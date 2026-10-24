import { expect, test, type Page } from '@playwright/test';
import { EDITOR_BACKGROUND_SELECTOR } from '../../src/ui/backgroundTap';

test.use({ locale: 'en-US', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const selected = (page: Page) => page.locator('.fs-folder-select[aria-pressed="true"]');
const folder = (page: Page, name: string) => page.locator(`.fs-folder-select[title="${name}"]`);
type TapMeasurement = { pointerType: string; pointerUp: number | null; latency: number | null; blockedClicks: number };
type ProbeWindow = Window & { __backgroundTapMeasurement: TapMeasurement };

async function prepare(page: Page) {
  await page.goto('/');
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', 'en');
  await page.locator('input[type="file"]').setInputFiles({ name: 'touch.txt', mimeType: 'text/plain', buffer: Buffer.from('Project\n    Alpha\n        Leaf\n    Beta') });
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Leaf', 'Beta']);
  await expect.poll(async () => (await savedDocument(page))?.root?.name).toBe('Project');
  await page.evaluate(() => document.fonts.ready);
  await folder(page, 'Alpha').tap();
  await expect(folder(page, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
}

async function backgroundPoint(page: Page) {
  return page.locator('.fs-tree').evaluate((tree, selector) => {
    const box = tree.getBoundingClientRect();
    const bottom = Math.min(box.bottom - 16, innerHeight - 40);
    for (let y = bottom; y >= Math.max(box.top + 16, 20); y -= 16) {
      for (const x of [box.x + box.width / 2, box.right - 12, box.x + 4]) {
        const hit = document.elementFromPoint(x, y);
        if (hit?.matches(selector) && hit.closest('.fs-editor')) return { x, y };
      }
    }
    throw new Error('No exposed editor background is visible for the touch gesture.');
  }, EDITOR_BACKGROUND_SELECTOR);
}

async function savedDocument(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document);
}

test('clears mobile selection on touch pointerup without waiting for a compatibility click', async ({ page }, testInfo) => {
  await prepare(page);
  const measurements: TapMeasurement[] = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    if (repeat) await folder(page, 'Alpha').tap();
    await expect(selected(page)).toHaveCount(1);
    const point = await backgroundPoint(page);
    await page.evaluate(selector => {
      const state: TapMeasurement = { pointerType: '', pointerUp: null, latency: null, blockedClicks: 0 };
      (window as unknown as ProbeWindow).__backgroundTapMeasurement = state;
      const editor = document.querySelector('.fs-editor')!;
      // Measure before React's root capture handler can synchronously clear selection.
      window.addEventListener('pointerup', event => {
        const pointer = event as PointerEvent;
        state.pointerType = pointer.pointerType;
        state.pointerUp = performance.now();
      }, { capture: true, once: true });
      const observer = new MutationObserver(() => {
        if (state.pointerUp !== null && !editor.querySelector('.fs-folder-select[aria-pressed="true"]')) {
          state.latency = performance.now() - state.pointerUp;
          observer.disconnect();
        }
      });
      observer.observe(editor, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'class'] });
      // Block only the compatibility click in this probe, proving pointerup owns clearing.
      window.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.matches(selector)) {
          state.blockedClicks++;
          event.stopImmediatePropagation();
        }
      }, { capture: true, once: true });
    }, EDITOR_BACKGROUND_SELECTOR);
    await page.touchscreen.tap(point.x, point.y);
    await expect(selected(page)).toHaveCount(0);
    await expect(page.locator('.fs-floating-actions')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__backgroundTapMeasurement.latency)).not.toBeNull();
    const measurement = await page.evaluate(() => (window as unknown as ProbeWindow).__backgroundTapMeasurement);
    expect(measurement.pointerType).toBe('touch');
    expect(measurement.blockedClicks, 'the compatibility click cannot be responsible for clearing selection').toBe(1);
    expect(measurement.latency!, 'Chromium emulated-touch pointerup to selection clearing, not a physical-device claim').toBeLessThan(150);
    measurements.push(measurement);
  }
  await testInfo.attach('emulated-touch-clear-latency', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('preserves selection while a real touch swipe scrolls the page', async ({ page }) => {
  await prepare(page);
  const point = await backgroundPoint(page);
  const before = await page.evaluate(() => ({ page: scrollY, tree: document.querySelector('.fs-tree')!.scrollTop }));
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - step * 20, id: 1 }] });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(initial => scrollY > initial.page || document.querySelector('.fs-tree')!.scrollTop > initial.tree, before)).toBe(true);
  await expect(folder(page, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  await session.detach();
});

test('keeps touch controls, disclosures, and modal interactions separate from blank deselection', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Collapse Alpha', exact: true }).tap();
  await expect(folder(page, 'Leaf')).toHaveCount(0);
  await expect(folder(page, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Rename', exact: true }).tap();
  await expect(page.getByRole('textbox', { name: 'Folder name', exact: true })).toBeVisible();
  await expect(page.locator('.fs-tree-row.is-selected')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).tap();
  await expect(folder(page, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Move', exact: true }).tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(folder(page, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Expand Alpha', exact: true }).tap();
  await expect(folder(page, 'Leaf')).toBeVisible();
});

test('does not discard invalid inline names or active composition when blank space is tapped', async ({ page }) => {
  await prepare(page);
  const original = await savedDocument(page);
  await page.getByRole('button', { name: 'Rename', exact: true }).tap();
  const input = page.getByRole('textbox', { name: 'Folder name', exact: true });
  await input.fill('../invalid');
  let point = await backgroundPoint(page);
  await page.touchscreen.tap(point.x, point.y);
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('../invalid');
  await expect(page.locator('.fs-tree-row.is-selected')).toHaveCount(1);
  expect(await savedDocument(page)).toEqual(original);
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).tap();
  await page.getByRole('button', { name: 'Rename', exact: true }).tap();
  await input.dispatchEvent('compositionstart');
  await input.fill('編集中');
  point = await backgroundPoint(page);
  await page.touchscreen.tap(point.x, point.y);
  await expect(input).toHaveValue('編集中');
  await expect(page.locator('.fs-tree-row.is-selected')).toHaveCount(1);
  expect(await savedDocument(page)).toEqual(original);
  await input.dispatchEvent('compositionend', { data: '編集中' });
  await input.press('Escape');
  await expect(folder(page, 'Alpha')).toHaveAttribute('aria-pressed', 'true');
});
