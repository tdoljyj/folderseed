import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { flatten, formatText, formatTree, parseText } from '../../src/core';

test.use({ locale: 'en-US' });
const DRAFT_KEY = 'folderseed:draft:v1';
const source = 'Project // 项目说明\n    Short //   literal spacing  \n        `Nested` // a ``code`` note\n    Much longer sibling // 保存原文';
const expected = parseText(source, 'plain');
const formats = ['markdown', 'ascii', 'unicode', 'plain'] as const;
const labels = { plain: 'Plain text', markdown: 'Markdown list', ascii: 'ASCII tree', unicode: 'Unicode tree' };
const textInput = (page: Page) => page.getByRole('textbox', { name: 'Folder structure text', exact: true });

async function textOptions(page: Page) {
  const minimumCommentColumn = await page.locator('.fs-app').evaluate(element => parseInt(getComputedStyle(element).getPropertyValue('--fs-text-comment-column'), 10));
  expect(Number.isSafeInteger(minimumCommentColumn) && minimumCommentColumn > 0).toBe(true);
  return { minimumCommentColumn };
}

function expectAligned(text: string, commentColumn: number) {
  const columns = text.split('\n').filter(line => line.includes(' // ')).map(line => line.indexOf(' // '));
  expect(columns).toHaveLength(4);
  expect(new Set(columns).size).toBe(1);
  expect(columns.every(column => column + 4 === commentColumn)).toBe(true);
}
async function chooseFormat(page: Page, format: keyof typeof labels) {
  await page.getByRole('button', { name: 'Change text format', exact: true }).click();
  await page.getByRole('menuitemradio', { name: labels[format], exact: true }).click();
}
async function load(page: Page) {
  await page.addInitScript(() => localStorage.setItem('folderseed:language:v1', 'en'));
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'aligned.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').document?.root?.name, DRAFT_KEY)).toBe('Project');
}

for (const width of [1440, 390]) {
  test(`aligns all switched formats, preview, clipboard and text downloads at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await load(page);
    // Switching away and back twice also exercises parsed padded labels, not just the first projection.
    for (let pass = 0; pass < 2; pass++) {
      for (const format of formats) {
        await chooseFormat(page, format);
        const options = await textOptions(page);
        const text = await textInput(page).inputValue();
        expect(text).toBe(formatText(expected, format, 4, options));
        expectAligned(text, options.minimumCommentColumn);
        if (pass === 0) await page.locator('.fs-editor').screenshot({ path: testInfo.outputPath(`aligned-${format}-${width}.png`) });
      }
    }
    await page.getByRole('button', { name: 'Text tree', exact: true }).click();
    const options = await textOptions(page);
    await expect(page.locator('.fs-text-preview')).toHaveText(formatTree(expected, options));
    expectAligned((await page.locator('.fs-text-preview').textContent())!, options.minimumCommentColumn);
    await page.getByRole('button', { name: 'Copy tree', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(formatTree(expected, options));

    for (const [format, card, parser] of [
      ['txt', 1, 'plain'], ['ascii', 1, 'ascii'], ['unicode', 1, 'unicode'], ['md', 2, 'markdown'], ['md-tree', 2, 'markdown'],
    ] as const) {
      await page.locator('.fs-export-options [role="radio"]').nth(card).click();
      await page.getByLabel(card === 1 ? 'Text export style' : 'Markdown export style', { exact: true }).selectOption(format);
      const downloading = page.waitForEvent('download');
      await page.locator('.fs-download').click();
      const file = await downloading;
      expect(await file.failure()).toBeNull();
      const text = await readFile((await file.path())!, 'utf8');
      expectAligned(text, options.minimumCommentColumn);
      const content = (value: ReturnType<typeof parseText>) => flatten(value).map(({ node, path }) => ({ name: node.name, comment: node.comment, path }));
      expect(content(parseText(text, parser))).toEqual(content(expected));
    }
  });
}

test('alignment never reformats raw typing, moves the caret, or commits unfinished composition', async ({ page }) => {
  await load(page);
  await chooseFormat(page, 'plain');
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-02T00:00:00Z'));
  const input = textInput(page);
  const raw = 'Typed // root\n  Small // short\n  A much longer name // long';
  await input.fill(raw);
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(3, 3));
  await page.clock.fastForward(1000);
  await expect(input).toHaveValue(raw);
  expect(await input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(3);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.root.name, DRAFT_KEY)).toBe('Typed');
  await input.dispatchEvent('compositionstart');
  const composing = raw.replace('Typed', 'Composing');
  await input.fill(composing);
  await page.clock.fastForward(1000);
  await expect(input).toHaveValue(composing);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.root.name, DRAFT_KEY)).toBe('Typed');
  await expect(page.locator('.fs-download')).toBeDisabled();
  await input.dispatchEvent('compositionend', { data: 'Composing' });
  await page.clock.fastForward(1000);
  await expect(input).toHaveValue(composing);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).document.root.name, DRAFT_KEY)).toBe('Composing');
  await page.reload();
  await expect(input).toHaveValue(composing);
});
