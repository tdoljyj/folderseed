import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });

const LONG_NAME = 'Long folder ' + 'x'.repeat(68);
const fixture = `Project\n    Parent\n        Leaf\n        Other\n    ${LONG_NAME}\n        Nested\n    Tail`;
const cases = [
  { name: 'light desktop', locale: 'en', width: 1440, height: 1100 },
  { name: 'light mobile', locale: 'en', width: 360, height: 1000 },
  { name: 'Arabic mobile', locale: 'ar', width: 360, height: 1000 },
] as const;

const folder = (page: Page, name: string) => page.locator(`.fs-folder-select[title="${name}"]`);
const row = (page: Page, name: string) => folder(page, name).locator('..');
const item = (page: Page, name: string) => row(page, name).locator('..').locator('..');
const count = (page: Page, name: string) => item(page, name).locator(':scope > .fs-row-count');
const action = (page: Page, name: string) => page.locator(`.fs-context-actions button[data-action="${name}"]`);

async function importText(page: Page, text: string) {
  await page.locator('input[type="file"]').setInputFiles({ name: 'row-affordances.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('.fs-folder-name')).toHaveText(text.split('\n').map(line => line.trim()));
}
async function load(page: Page, scenario: typeof cases[number]) {
  await page.setViewportSize({ width: scenario.width, height: scenario.height });
  await page.addInitScript(locale => {
    localStorage.setItem('folderseed:language:v1', locale);
    localStorage.setItem('folderseed:theme:v1', 'light');
  }, scenario.locale);
  await page.goto('/');
  await expect(page.locator('.fs-app')).toHaveAttribute('lang', scenario.locale);
  await page.evaluate(() => document.fonts.ready);
  await importText(page, fixture);
}
async function clearSelection(page: Page) {
  await page.locator('.fs-editor').press('Escape');
  await expect(page.locator('.fs-folder-select[aria-pressed="true"]')).toHaveCount(0);
}
async function select(page: Page, name: string) {
  // Clear intentional neighboring-row overlays before choosing another folder.
  await clearSelection(page);
  await folder(page, name).scrollIntoViewIfNeeded();
  await folder(page, name).click();
  await expect(folder(page, name)).toHaveAttribute('aria-pressed', 'true');
}

async function geometry(page: Page, name: string) {
  return folder(page, name).evaluate(button => {
    const tree = button.closest<HTMLElement>('.fs-tree')!;
    const origin = tree.getBoundingClientRect();
    const parentRow = button.closest<HTMLElement>('.fs-tree-row')!;
    const parentItem = parentRow.closest<HTMLElement>('.fs-tree-item')!;
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x - origin.x + tree.scrollLeft, y: rect.y - origin.y + tree.scrollTop, width: rect.width, height: rect.height };
    };
    const grip = parentRow.querySelector('.fs-drag-hint')!;
    const disclosure = parentRow.querySelector('.fs-disclosure, .fs-disclosure-placeholder');
    const counter = parentItem.querySelector(':scope > .fs-row-count')!;
    const style = getComputedStyle(counter);
    return {
      row: box(parentRow), item: box(parentItem), grip: box(grip), glyph: box(button.querySelector('.fs-folder-icon svg')!),
      label: box(button.querySelector('.fs-folder-name')!), count: box(counter),
      disclosure: disclosure ? box(disclosure) : null,
      gripFirst: parentRow.firstElementChild === grip,
      gripHasIcon: !!grip.querySelector('svg'),
      countVisible: style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0,
      draggable: parentRow.draggable,
      scrollWidth: tree.scrollWidth,
    };
  });
}
function sameAnchors(before: Awaited<ReturnType<typeof geometry>>, after: Awaited<ReturnType<typeof geometry>>) {
  for (const element of ['grip', 'glyph', 'label', 'count'] as const) {
    for (const axis of ['x', 'y'] as const) expect(after[element][axis], `${element} ${axis} stays stationary`).toBeCloseTo(before[element][axis], 1);
  }
  expect(after.row.height).toBe(34);
  expect(after.countVisible).toBe(true);
  expect(after.scrollWidth).toBe(before.scrollWidth);
}
async function expectCountClearOfActions(page: Page, name: string) {
  const collisions = await count(page, name).evaluate(counter => {
    const c = counter.getBoundingClientRect();
    return [...document.querySelectorAll('.fs-context-actions button')].filter(button => {
      if (getComputedStyle(button).visibility !== 'visible') return false;
      const b = button.getBoundingClientRect();
      return b.left < c.right && b.right > c.left && b.top < c.bottom && b.bottom > c.top;
    }).map(button => button.getAttribute('data-action'));
  });
  expect(collisions, 'the trailing count gutter stays clear of floating controls').toEqual([]);
}

for (const scenario of cases) {
  test(`keeps leading grips, names, trailing counts, and inline slots stable on ${scenario.name}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await load(page, scenario);
    await expect(count(page, 'Project')).toHaveText('3');
    await expect(count(page, 'Parent')).toHaveText('2');
    await expect(count(page, 'Leaf')).toHaveText('');

    for (const [name, depth] of [['Project', 0], ['Parent', 1], ['Leaf', 2], [LONG_NAME, 1]] as const) {
      await clearSelection(page);
      await folder(page, name).scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const before = await geometry(page, name);
      expect(before.gripFirst).toBe(true);
      expect(before.grip.width).toBe(18);
      expect(before.gripHasIcon).toBe(depth > 0);
      expect(before.draggable).toBe(depth > 0);
      expect(before.count.y).toBeCloseTo(before.row.y, 1);
      expect(before.count.x + before.count.width).toBeCloseTo(before.item.x + before.item.width - 9, 1);
      expect(before.glyph.x).toBeCloseTo(55 + depth * 22, 1);
      expect(before.label.x).toBeCloseTo(83 + depth * 22, 1);
      expect(before.grip.x + before.grip.width).toBeLessThanOrEqual(before.disclosure!.x);
      expect(before.disclosure!.x + before.disclosure!.width).toBeLessThanOrEqual(before.glyph.x);
      await row(page, name).hover();
      if (depth > 0) await expect(row(page, name).locator('.fs-drag-hint')).toHaveCSS('opacity', '1');
      sameAnchors(before, await geometry(page, name));
      await folder(page, name).click();
      sameAnchors(before, await geometry(page, name));
      await expectCountClearOfActions(page, name);
      await clearSelection(page);
      sameAnchors(before, await geometry(page, name));
    }

    // Collapsing affects descendants, never this row's grip, count, or selection anchors.
    await row(page, 'Parent').locator('.fs-disclosure').click();
    await expect(folder(page, 'Leaf')).toHaveCount(0);
    await expect(count(page, 'Parent')).toHaveText('2');
    const collapsed = await geometry(page, 'Parent');
    await select(page, 'Parent');
    sameAnchors(collapsed, await geometry(page, 'Parent'));
    await expectCountClearOfActions(page, 'Parent');
    await page.locator('.fs-floating-disclosure').click();
    await expect(folder(page, 'Leaf')).toBeVisible();

    await select(page, LONG_NAME);
    await expectCountClearOfActions(page, LONG_NAME);
    await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`row-affordances-${scenario.locale}-${scenario.width}.png`) });

    const renameBefore = await geometry(page, LONG_NAME);
    await action(page, 'rename').click();
    const inline = page.locator('.fs-inline-editor');
    const editing = await inline.evaluate(editor => {
      const tree = editor.closest<HTMLElement>('.fs-tree')!, origin = tree.getBoundingClientRect();
      const parentRow = editor.closest<HTMLElement>('.fs-tree-row')!;
      const glyph = parentRow.querySelector('.fs-folder-icon svg')!.getBoundingClientRect();
      const input = editor.querySelector('input')!.getBoundingClientRect();
      return { glyphX: glyph.x - origin.x + tree.scrollLeft, glyphY: glyph.y - origin.y + tree.scrollTop,
        inputX: input.x - origin.x + tree.scrollLeft, draggable: parentRow.draggable,
        gripFirst: parentRow.firstElementChild?.classList.contains('fs-drag-hint'), gripIcon: !!parentRow.querySelector('.fs-drag-hint svg') };
    });
    expect(editing.glyphX).toBeCloseTo(renameBefore.glyph.x, 1);
    expect(editing.glyphY).toBeCloseTo(renameBefore.glyph.y, 1);
    expect(editing.inputX).toBeCloseTo(renameBefore.label.x, 1);
    expect(editing.gripFirst).toBe(true);
    expect(editing.gripIcon).toBe(false);
    expect(editing.draggable).toBe(false);
    await inline.locator('input').press('Escape');
    sameAnchors(renameBefore, await geometry(page, LONG_NAME));

    await select(page, 'Parent');
    const siblingGlyph = (await geometry(page, 'Leaf')).glyph.x;
    await action(page, 'add-child').click();
    const placeholder = page.locator('.fs-inline-placeholder');
    await expect(placeholder.locator('.fs-drag-hint')).toHaveClass(/is-fixed/);
    await expect(placeholder.locator('.fs-drag-hint svg')).toHaveCount(0);
    const provisional = await placeholder.evaluate(element => {
      const tree = element.closest<HTMLElement>('.fs-tree')!, origin = tree.getBoundingClientRect();
      const parentRow = element.querySelector<HTMLElement>('.fs-tree-row')!;
      const glyph = element.querySelector('.fs-folder-icon svg')!.getBoundingClientRect();
      const input = element.querySelector('input')!.getBoundingClientRect();
      return { glyphX: glyph.x - origin.x + tree.scrollLeft, inputX: input.x - origin.x + tree.scrollLeft,
        first: parentRow.firstElementChild?.classList.contains('fs-drag-hint'), height: parentRow.getBoundingClientRect().height, draggable: parentRow.draggable };
    });
    expect(provisional.glyphX).toBeCloseTo(siblingGlyph, 1);
    expect(provisional.inputX).toBeCloseTo(siblingGlyph + 28, 1);
    expect(provisional.first).toBe(true);
    expect(provisional.height).toBe(34);
    expect(provisional.draggable).toBe(false);
    await placeholder.locator('input').press('Escape');
    await expect(placeholder).toHaveCount(0);
    await expect(count(page, 'Parent')).toHaveText('2');

    // Deep rows reserve their horizontal extent even before selection; no selection-driven scroll jump.
    await importText(page, ['Deep project', ...Array.from({ length: 12 }, (_, index) => `${'    '.repeat(index + 1)}Level ${index + 1}`)].join('\n'));
    await folder(page, 'Level 10').scrollIntoViewIfNeeded();
    const deep = await geometry(page, 'Level 10');
    await select(page, 'Level 10');
    sameAnchors(deep, await geometry(page, 'Level 10'));
    await expect(count(page, 'Level 10')).toHaveText('1');
    await expectCountClearOfActions(page, 'Level 10');
    await clearSelection(page);
    sameAnchors(deep, await geometry(page, 'Level 10'));
  });
}

type DragWindow = Window & { __gripDrags: { trusted: boolean; name: string | null }[] };

test('starts native row dragging from the leading grip while the root stays fixed, and supports Undo', async ({ page }, testInfo) => {
  await load(page, cases[0]);
  await importText(page, 'Project\n    Alpha\n    Beta\n    Gamma');
  await page.evaluate(() => {
    (window as unknown as DragWindow).__gripDrags = [];
    document.addEventListener('dragstart', event => {
      const target = event.target as Element;
      (window as unknown as DragWindow).__gripDrags.push({ trusted: event.isTrusted, name: target.closest('.fs-tree-row')?.querySelector('.fs-folder-name')?.textContent ?? null });
    }, true);
  });
  const rootGrip = (await row(page, 'Project').locator('.fs-drag-hint').boundingBox())!;
  await page.mouse.move(rootGrip.x + rootGrip.width / 2, rootGrip.y + rootGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(rootGrip.x + rootGrip.width / 2 + 12, rootGrip.y + rootGrip.height / 2 + 12, { steps: 5 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as unknown as DragWindow).__gripDrags)).toEqual([]);
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta', 'Gamma']);
  await clearSelection(page);

  await row(page, 'Beta').hover();
  const grip = (await row(page, 'Beta').locator('.fs-drag-hint').boundingBox())!;
  const target = (await row(page, 'Alpha').boundingBox())!;
  const initialRootCount = await geometry(page, 'Project');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - 10, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + 2, { steps: 12 });
  await page.mouse.move(target.x + target.width / 2 + 1, target.y + 2);
  await expect(page.locator('.fs-drop-line.is-before')).toHaveCount(1);
  await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath('leading-grip-native-drag.png') });
  await page.mouse.up();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Beta', 'Alpha', 'Gamma']);
  expect(await page.evaluate(() => (window as unknown as DragWindow).__gripDrags)).toEqual([{ trusted: true, name: 'Beta' }]);
  await expect(count(page, 'Project')).toHaveText('3');
  expect((await geometry(page, 'Project')).count).toEqual(initialRootCount.count);
  await page.locator('.fs-history button').first().click();
  await expect(page.locator('.fs-folder-name')).toHaveText(['Project', 'Alpha', 'Beta', 'Gamma']);
  await expect(count(page, 'Project')).toHaveText('3');
});

test('updates right-aligned child counts for inline add, immediate delete, and Undo including collapsed parents', async ({ page }) => {
  await load(page, cases[0]);
  await importText(page, 'Project\n    Parent\n        Existing\n    Tail');
  await expect(count(page, 'Project')).toHaveText('2');
  await expect(count(page, 'Parent')).toHaveText('1');
  await select(page, 'Parent');
  await action(page, 'add-child').click();
  await page.locator('.fs-inline-name').fill('Added child');
  await page.locator('.fs-inline-save').click();
  await expect(count(page, 'Parent')).toHaveText('2');
  await expect(count(page, 'Project')).toHaveText('2');
  await expect(count(page, 'Added child')).toHaveText('');
  await action(page, 'delete').click();
  await expect(folder(page, 'Added child')).toHaveCount(0);
  await expect(count(page, 'Parent')).toHaveText('1');
  await page.locator('.fs-notice-undo').click();
  await expect(folder(page, 'Added child')).toBeVisible();
  await expect(count(page, 'Parent')).toHaveText('2');

  await select(page, 'Project');
  await action(page, 'add-child').click();
  await page.locator('.fs-inline-name').fill('Added root child');
  await page.locator('.fs-inline-save').click();
  await expect(count(page, 'Project')).toHaveText('3');
  await select(page, 'Parent');
  await page.locator('.fs-floating-disclosure').click();
  await expect(folder(page, 'Existing')).toHaveCount(0);
  await expect(count(page, 'Parent')).toHaveText('2');
  await expect(count(page, 'Parent')).toBeVisible();
  await action(page, 'delete').click();
  await expect(folder(page, 'Parent')).toHaveCount(0);
  await expect(count(page, 'Project')).toHaveText('2');
  await page.locator('.fs-notice-undo').click();
  await expect(folder(page, 'Parent')).toBeVisible();
  await expect(count(page, 'Parent')).toHaveText('2');
  await expect(count(page, 'Project')).toHaveText('3');
  await select(page, 'Project');
  await expectCountClearOfActions(page, 'Project');
});
