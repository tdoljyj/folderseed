import { expect, test, type Page } from '@playwright/test';
import { flatten, serializeJSON } from '../../src/core';
import { makeTemplate } from '../../src/ui/templates';

test.use({ locale: 'en-US' });
const fixture = makeTemplate(0);
const names = flatten(fixture).map(({ node }) => node.name);
const formats = ['plain', 'markdown', 'ascii', 'unicode'] as const;
const scenarios = [1920, 1440, 390].flatMap(width => ['light', 'dark'].map(theme => ({ width, theme, touch: width === 390 })));
scenarios.push({ width: 1440, theme: 'dark', touch: true });
const close = (actual: number, expected: number, message: string) => expect(Math.abs(actual - expected), message).toBeLessThanOrEqual(1);

async function prepare(page: Page, width: number, theme: string) {
  await page.setViewportSize({ width, height: 1100 });
  await page.addInitScript(appearance => {
    localStorage.setItem('folderseed:language:v1', 'en');
    localStorage.setItem('folderseed:theme:v1', appearance);
  }, theme);
  await page.goto('/');
  await expect(page.locator('.fs-app')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('input[type="file"]').setInputFiles({ name: 'paired-panels.json', mimeType: 'application/json', buffer: Buffer.from(serializeJSON(fixture)) });
  await expect(page.locator('.fs-folder-name')).toHaveText(names);
  await expect(page.locator('.fs-preview-name')).toHaveText(names);
}

async function frames(page: Page) {
  return page.evaluate(() => Object.fromEntries(['.fs-editor', '.fs-preview', '.fs-workspace-grid', '.fs-export'].map(selector => {
    const box = document.querySelector(selector)!.getBoundingClientRect();
    // Document coordinates exclude scrolling caused by mode controls or screenshots.
    return [selector, { x: box.x + scrollX, y: box.y + scrollY, width: box.width, ...(selector === '.fs-export' ? {} : { height: box.height }) }];
  })));
}
async function expectFrames(page: Page, baseline: Awaited<ReturnType<typeof frames>>, state: string) {
  const actual = await frames(page);
  for (const [selector, box] of Object.entries(baseline)) {
    for (const [property, value] of Object.entries(box)) {
      close(actual[selector][property as keyof typeof box]!, value!, `${state}: ${selector} ${property}`);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${state}: page remains horizontally bounded`).toBe(true);
}

async function expectPairedFrame(page: Page, mobile: boolean) {
  const geometry = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const editor = box('.fs-editor'), preview = box('.fs-preview');
    const editorHeading = box('.fs-editor > .fs-panel-heading'), previewHeading = box('.fs-preview > .fs-panel-heading');
    const editorToolbar = box('.fs-editor-toolbar'), previewToolbar = box('.fs-preview-toolbar');
    const editorBody = box('.fs-visual-area, .fs-text-area'), canvas = box('.fs-preview-canvas'), stats = box('.fs-preview-stats');
    const local = (value: DOMRect, panel: DOMRect) => ({ top: value.top - panel.top, height: value.height });
    return {
      editor: { top: editor.top, height: editor.height }, preview: { top: preview.top, height: preview.height },
      editorHeading: local(editorHeading, editor), previewHeading: local(previewHeading, preview),
      editorToolbar: local(editorToolbar, editor), previewToolbar: local(previewToolbar, preview),
      editorBody: local(editorBody, editor), previewBody: { top: canvas.top - preview.top, height: canvas.height + stats.height },
      expectedBody: parseFloat(getComputedStyle(document.querySelector('.fs-app')!).getPropertyValue('--fs-editor-body-height')),
      statsGap: stats.top - canvas.bottom,
    };
  });
  if (!mobile) close(geometry.editor.top, geometry.preview.top, 'paired desktop panels share a top edge');
  close(geometry.editor.height, geometry.preview.height, 'paired panels share one height');
  for (const [left, right] of [
    [geometry.editorHeading, geometry.previewHeading], [geometry.editorToolbar, geometry.previewToolbar], [geometry.editorBody, geometry.previewBody],
  ]) {
    close(left.top, right.top, 'paired landmarks have the same panel-local top');
    close(left.height, right.height, 'paired landmarks have the same height');
  }
  close(geometry.editorBody.height, geometry.expectedBody, 'editor keeps its configured fixed body');
  close(geometry.previewBody.height, geometry.expectedBody, 'preview canvas and stats fill the same fixed body');
  close(geometry.statsGap, 0, 'preview statistics follow the canvas without a gap');
}

// The baseline belongs to the first visual state, not whichever two modes happen
// to be displayed now. Equal simultaneous shifts in both panels must still fail.
async function contentGeometry(page: Page) {
  return page.evaluate(folderNames => {
    type Row = { center: number; pitch: number; commentX: number; nameCenter?: number; glyphCenter?: number; gapCells?: number };
    function scrollOffset(element: HTMLElement, panel: Element) {
      let x = 0, y = 0;
      for (let current: HTMLElement | null = element; current && current !== panel; current = current.parentElement) {
        x += current.scrollLeft; y += current.scrollTop;
      }
      return { x, y };
    }
    function firstCharacter(element: Element) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.length) continue;
        const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 1);
        return range.getBoundingClientRect();
      }
      throw new Error('Expected a visible comment text node.');
    }
    function panelGeometry(selector: string) {
      const panel = document.querySelector<HTMLElement>(selector)!;
      const panelBox = panel.getBoundingClientRect();
      const bodyTop = panel.querySelector('.fs-editor-toolbar, .fs-preview-toolbar')!.getBoundingClientRect().bottom - panelBox.top;
      const text = panel.querySelector<HTMLElement>('textarea, .fs-text-preview');
      if (!text) {
        const editor = selector === '.fs-editor';
        const rows: Row[] = [...panel.querySelectorAll<HTMLElement>(editor ? '.fs-tree-row' : '.fs-preview-row')].map(row => {
          const box = row.getBoundingClientRect(), scroll = scrollOffset(row, panel);
          const name = row.querySelector(editor ? '.fs-folder-name' : '.fs-preview-name')!.getBoundingClientRect();
          const glyph = row.querySelector(editor ? '.fs-folder-icon svg' : '.fs-preview-folder svg')!.getBoundingClientRect();
          const cell = editor ? row.closest('.fs-tree-item')!.querySelector<HTMLElement>(':scope > .fs-folder-comment')! : row.querySelector<HTMLElement>('.fs-preview-comment')!;
          const comment = firstCharacter(cell), commentScroll = scrollOffset(cell, panel);
          return {
            center: box.top + box.height / 2 - panelBox.top + scroll.y, pitch: box.height,
            nameCenter: name.top + name.height / 2 - panelBox.top + scroll.y,
            glyphCenter: glyph.top + glyph.height / 2 - panelBox.top + scroll.y,
            commentX: comment.left - panelBox.left + commentScroll.x,
          };
        });
        return { kind: 'visual', fontSize: 0, contentInset: rows[0].center - rows[0].pitch / 2 - bodyTop, rows };
      }
      const box = text.getBoundingClientRect(), style = getComputedStyle(text), scroll = scrollOffset(text, panel);
      const input = text instanceof HTMLTextAreaElement;
      const value = input ? text.value : text.textContent!;
      let mirror: HTMLElement | undefined;
      let surface = text;
      if (input) {
        mirror = document.createElement('div');
        for (const property of [
          'box-sizing', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant',
          'font-feature-settings', 'font-variation-settings', 'line-height', 'letter-spacing', 'word-spacing',
          'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
          'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'tab-size', 'direction', 'text-align',
        ]) mirror.style.setProperty(property, style.getPropertyValue(property));
        Object.assign(mirror.style, {
          position: 'fixed', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre',
          borderStyle: 'solid', borderColor: 'transparent', overflow: 'hidden', margin: '0',
          left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
        });
        mirror.textContent = value; document.body.append(mirror);
        mirror.scrollTop = text.scrollTop; mirror.scrollLeft = text.scrollLeft;
        surface = mirror;
      }
      try {
        const pitch = parseFloat(style.lineHeight);
        const top = box.top - panelBox.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + scroll.y - text.scrollTop;
        let offset = 0;
        const rows: Row[] = value.split('\n').map((line, index) => {
          if (!line.includes(folderNames[index])) throw new Error(`Missing folder ${folderNames[index]} in generated line ${index + 1}.`);
          const separator = line.indexOf('// ');
          if (separator < 0) throw new Error('Generated fixture lost a comment.');
          const range = document.createRange();
          range.setStart(surface.firstChild!, offset + separator + 3); range.setEnd(surface.firstChild!, offset + separator + 4);
          const comment = range.getBoundingClientRect();
          offset += line.length + 1;
          return {
            center: top + (index + 0.5) * pitch, pitch,
            commentX: comment.left - panelBox.left + scroll.x,
            gapCells: line.slice(0, separator).match(/ +$/)?.[0].length ?? 0,
          };
        });
        return { kind: 'text', fontSize: parseFloat(style.fontSize), contentInset: rows[0].center - pitch / 2 - bodyTop, rows };
      } finally { mirror?.remove(); }
    }
    return { editor: panelGeometry('.fs-editor'), preview: panelGeometry('.fs-preview') };
  }, names);
}

type ContentGeometry = Awaited<ReturnType<typeof contentGeometry>>;
async function expectCanonicalContent(page: Page, baseline: ContentGeometry, state: string, touch: boolean, mobile: boolean, textColumn?: number) {
  const actual = await contentGeometry(page);
  for (const [panel, content] of Object.entries(actual)) {
    expect(content.rows, `${state}: ${panel} rows`).toHaveLength(names.length);
    close(content.contentInset, 44, `${state}: ${panel} keeps the shared 44px content origin`);
    if (content.kind === 'text' && touch) expect(content.fontSize, `${state}: touch text avoids native input zoom`).toBeGreaterThanOrEqual(16);
    for (const [index, row] of content.rows.entries()) {
      const expected = baseline.editor.rows[index];
      close(row.center, expected.center, `${state}: ${panel} ${names[index]} center stays on the original visual row`);
      close(row.pitch, 34, `${state}: ${panel} ${names[index]} uses the canonical row pitch`);
      // Mobile visual columns intentionally stay compact; full-width generated
      // text has its own locally scrollable column, shared by all text formats.
      const expectedX = mobile && content.kind === 'text' ? textColumn ?? content.rows[0].commentX : expected.commentX;
      close(row.commentX, expectedX, `${state}: ${panel} ${names[index]} literal comment content shares its canonical X`);
      if ('nameCenter' in row && row.nameCenter !== undefined) close(row.nameCenter, expected.center, `${state}: ${panel} name center`);
      if ('glyphCenter' in row && row.glyphCenter !== undefined) close(row.glyphCenter, expected.center, `${state}: ${panel} glyph center`);
      if ('gapCells' in row && row.gapCells !== undefined) expect(row.gapCells, `${state}: four cells between the name/syntax and separator`).toBeGreaterThanOrEqual(4);
    }
  }
  return actual;
}

for (const { width, theme, touch } of scenarios) {
  test.describe(`${width}px ${theme}${touch ? ' touch' : ''}`, () => {
    test.use({ hasTouch: touch });
    test('keeps one visual baseline and comment column across all generated modes and preview combinations', async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await prepare(page, width, theme);
      const baselineFrames = await frames(page), baseline = await contentGeometry(page);
      let textColumn: number | undefined;
      const expectContent = async (state: string) => {
        const actual = await expectCanonicalContent(page, baseline, state, touch, width < 800, textColumn);
        textColumn ??= Object.values(actual).find(content => content.kind === 'text')?.rows[0].commentX;
      };
      await expectContent('initial visual/folders');
      await expectPairedFrame(page, width < 800);
      await testInfo.attach('canonical-visual-geometry', { body: JSON.stringify(baseline), contentType: 'application/json' });
      await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath(`canonical-${width}-${theme}-visual.png`) });
      for (let round = 0; round < 2; round++) {
        for (const format of formats) {
          await page.locator('.fs-format-menu-trigger').click();
          await page.getByRole('menuitemradio').nth(formats.indexOf(format)).click();
          await expect(page.locator('.fs-text-area textarea')).toBeVisible();
          for (const preview of ['Folders', 'Text tree'] as const) {
            await page.getByRole('button', { name: preview, exact: true }).click();
            const state = `${format}/${preview}, round ${round + 1}`;
            await expectContent(state);
            await expectPairedFrame(page, width < 800);
            await expectFrames(page, baselineFrames, state);
            if (round === 0) await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath(`canonical-${width}-${theme}-${format}-${preview.replace(' ', '-')}.png`) });
          }
          await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
          for (const preview of ['Text tree', 'Folders'] as const) {
            await page.getByRole('button', { name: preview, exact: true }).click();
            const state = `Visual/${preview} after ${format}, round ${round + 1}`;
            await expectContent(state);
            await expectPairedFrame(page, width < 800);
            await expectFrames(page, baselineFrames, state);
          }
        }
      }
    });
  });
}
