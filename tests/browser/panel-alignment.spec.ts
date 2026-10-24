import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-US' });
const names = ['Project', 'Inspiration', 'References', 'Work', 'Drafts', 'Delivery'];
const source = 'Project // Project overview\n    Inspiration // Collect ideas\n        References // Keep sources\n    Work // Active work\n        Drafts // In progress\n    Delivery // Finished folders';
const formats = ['plain', 'markdown', 'ascii', 'unicode'] as const;
const scenarios = [1920, 1440, 390].flatMap(width => ['light', 'dark'].map(theme => ({ width, theme })));
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
  await page.locator('input[type="file"]').setInputFiles({ name: 'paired-panels.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
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

async function expectVisualRows(page: Page) {
  const geometry = await page.evaluate(() => {
    const editorTop = document.querySelector('.fs-editor')!.getBoundingClientRect().top;
    const previewTop = document.querySelector('.fs-preview')!.getBoundingClientRect().top;
    const rows = (selector: string, nameSelector: string, glyphSelector: string, panelTop: number) => [...document.querySelectorAll(selector)].map(row => {
      const box = row.getBoundingClientRect();
      const name = row.querySelector(nameSelector)!.getBoundingClientRect();
      const glyph = row.querySelector(glyphSelector)!.getBoundingClientRect();
      return { top: box.top - panelTop, height: box.height, nameCenter: name.top + name.height / 2 - panelTop, glyphCenter: glyph.top + glyph.height / 2 - panelTop };
    });
    return {
      editor: rows('.fs-tree-row', '.fs-folder-name', '.fs-folder-icon svg', editorTop),
      preview: rows('.fs-preview-row', '.fs-preview-name', '.fs-preview-folder svg', previewTop),
    };
  });
  expect(geometry.editor).toHaveLength(names.length);
  expect(geometry.preview).toHaveLength(names.length);
  for (let index = 0; index < names.length; index++) {
    const left = geometry.editor[index], right = geometry.preview[index];
    close(left.top, right.top, `${names[index]} row top matches across panels`);
    close(left.height, right.height, `${names[index]} row height matches across panels`);
    close(left.nameCenter, right.nameCenter, `${names[index]} displayed-name center matches`);
    close(left.glyphCenter, right.glyphCenter, `${names[index]} folder-glyph center matches`);
    if (index > 0) {
      close(left.top - geometry.editor[index - 1].top, left.height, `${names[index]} follows the editor row with no extra gap`);
      close(right.top - geometry.preview[index - 1].top, right.height, `${names[index]} follows the preview row with no extra root gap`);
    }
  }
}

async function expectTextLines(page: Page, mobile: boolean) {
  const geometry = await page.evaluate(folderNames => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.fs-text-area textarea')!;
    const pre = document.querySelector<HTMLElement>('.fs-text-preview')!;
    const editorTop = document.querySelector('.fs-editor')!.getBoundingClientRect().top;
    const previewTop = document.querySelector('.fs-preview')!.getBoundingClientRect().top;
    const inputBox = textarea.getBoundingClientRect(), preBox = pre.getBoundingClientRect();
    const inputStyle = getComputedStyle(textarea), preStyle = getComputedStyle(pre);
    const inputContentTop = inputBox.top + parseFloat(inputStyle.borderTopWidth) + parseFloat(inputStyle.paddingTop) - textarea.scrollTop;
    const previewContentTop = preBox.top + parseFloat(preStyle.borderTopWidth) + parseFloat(preStyle.paddingTop) - pre.scrollTop;
    // Native textarea text has no DOM ranges. A hidden mirror with its actual computed
    // metrics lets us compare rendered glyph rectangles, not guessed font baselines.
    const mirror = document.createElement('div');
    for (const property of [
      'box-sizing', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant',
      'font-feature-settings', 'font-variation-settings', 'line-height', 'letter-spacing', 'word-spacing',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'tab-size',
    ]) mirror.style.setProperty(property, inputStyle.getPropertyValue(property));
    Object.assign(mirror.style, {
      position: 'fixed', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre',
      borderStyle: 'solid', borderColor: 'transparent', overflow: 'hidden', margin: '0',
      left: `${inputBox.left}px`, top: `${inputBox.top}px`, width: `${inputBox.width}px`, height: `${inputBox.height}px`,
    });
    mirror.textContent = textarea.value;
    document.body.append(mirror);
    mirror.scrollTop = textarea.scrollTop;
    const characterBoxes = (element: HTMLElement, panelTop: number) => {
      const text = element.firstChild!;
      let offset = 0;
      return element.textContent!.split('\n').map((line, index) => {
        const column = line.indexOf(folderNames[index]);
        if (column < 0) throw new Error(`Missing folder on line ${index + 1}: ${line}`);
        const range = document.createRange();
        range.setStart(text, offset + column);
        range.setEnd(text, offset + column + 1);
        const box = range.getBoundingClientRect();
        offset += line.length + 1;
        return { top: box.top - panelTop, height: box.height };
      });
    };
    try {
      return {
        inputContentTop: inputContentTop - editorTop, previewContentTop: previewContentTop - previewTop,
        inputLineHeight: parseFloat(inputStyle.lineHeight), previewLineHeight: parseFloat(preStyle.lineHeight),
        inputFontSize: parseFloat(inputStyle.fontSize), previewFontSize: parseFloat(preStyle.fontSize),
        inputGlyphs: characterBoxes(mirror, editorTop), previewGlyphs: characterBoxes(pre, previewTop),
      };
    } finally { mirror.remove(); }
  }, names);
  close(geometry.inputContentTop, geometry.previewContentTop, 'first text line shares the same panel-local content origin');
  close(geometry.inputLineHeight, geometry.previewLineHeight, 'text editor and text preview use the same line pitch');
  close(geometry.inputFontSize, geometry.previewFontSize, 'paired text uses matching font sizes');
  if (mobile) expect(geometry.inputFontSize).toBeGreaterThanOrEqual(16);
  expect(geometry.inputGlyphs).toHaveLength(names.length);
  expect(geometry.previewGlyphs).toHaveLength(names.length);
  for (let index = 0; index < names.length; index++) {
    close(geometry.inputGlyphs[index].top, geometry.previewGlyphs[index].top, `${names[index]} rendered text aligns`);
    close(geometry.inputGlyphs[index].height, geometry.previewGlyphs[index].height, `${names[index]} glyph height matches`);
    if (index > 0) {
      close(geometry.inputGlyphs[index].top - geometry.inputGlyphs[index - 1].top, geometry.inputLineHeight, `${names[index]} editor pitch matches its computed line-height`);
      close(geometry.previewGlyphs[index].top - geometry.previewGlyphs[index - 1].top, geometry.previewLineHeight, `${names[index]} preview pitch matches its computed line-height`);
    }
  }
}

async function expectCrossModeRows(page: Page, textInEditor: boolean) {
  const geometry = await page.evaluate(editorText => {
    const text = document.querySelector<HTMLElement>(editorText ? '.fs-text-area textarea' : '.fs-text-preview')!;
    const textPanel = text.closest('.fs-panel')!.getBoundingClientRect();
    const textBox = text.getBoundingClientRect(), style = getComputedStyle(text);
    const contentTop = textBox.top - textPanel.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) - text.scrollTop;
    const lineHeight = parseFloat(style.lineHeight);
    const visualPanel = document.querySelector(editorText ? '.fs-preview' : '.fs-editor')!.getBoundingClientRect();
    const rows = [...document.querySelectorAll(editorText ? '.fs-preview-row' : '.fs-tree-row')].map(row => {
      const box = row.getBoundingClientRect();
      const name = row.querySelector(editorText ? '.fs-preview-name' : '.fs-folder-name')!.getBoundingClientRect();
      return { top: box.top - visualPanel.top, height: box.height, nameCenter: name.top + name.height / 2 - visualPanel.top };
    });
    const value = editorText ? (text as HTMLTextAreaElement).value : text.textContent!;
    return { contentTop, lineHeight, rows, lines: value.split('\n').length };
  }, textInEditor);
  expect(geometry.lines).toBe(names.length);
  expect(geometry.rows).toHaveLength(names.length);
  for (const [index, row] of geometry.rows.entries()) {
    close(row.top, geometry.contentTop + index * geometry.lineHeight, `${names[index]} cross-mode row and text line start match`);
    close(row.height, geometry.lineHeight, `${names[index]} cross-mode row and text line pitch match`);
    close(row.nameCenter, geometry.contentTop + (index + 0.5) * geometry.lineHeight, `${names[index]} cross-mode displayed name matches the text line center`);
  }
}

for (const { width, theme } of scenarios) {
  test(`keeps paired visual rows and all text baselines aligned at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await prepare(page, width, theme);
    const baseline = await frames(page);
    await expectPairedFrame(page, width < 800);
    await expectVisualRows(page);
    await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath(`paired-${width}-${theme}-visual.png`) });
    await page.getByRole('button', { name: 'Text tree', exact: true }).click();
    await expectCrossModeRows(page, false);
    await expectPairedFrame(page, width < 800);
    await expectFrames(page, baseline, 'Visual editor with text preview');
    await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath(`paired-${width}-${theme}-visual-text.png`) });
    await page.getByRole('button', { name: 'Folders', exact: true }).click();
    for (let round = 0; round < 2; round++) {
      for (const format of formats) {
        await page.locator('.fs-format-menu-trigger').click();
        await page.getByRole('menuitemradio').nth(formats.indexOf(format)).click();
        await page.getByRole('button', { name: 'Text tree', exact: true }).click();
        await expect(page.locator('.fs-text-area textarea')).toBeVisible();
        await expectPairedFrame(page, width < 800);
        await expectTextLines(page, width < 800);
        await expectFrames(page, baseline, `${format}, round ${round + 1}`);
        if (round === 0) await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath(`paired-${width}-${theme}-${format}.png`) });
        if (round === 0 && format === 'plain') {
          await page.getByRole('button', { name: 'Folders', exact: true }).click();
          await expectCrossModeRows(page, true);
          await expectPairedFrame(page, width < 800);
          await expectFrames(page, baseline, 'Text editor with folder preview');
          await page.locator('.fs-workspace-grid').screenshot({ path: testInfo.outputPath(`paired-${width}-${theme}-text-folders.png`) });
        }
        await page.getByRole('button', { name: 'Visual editor', exact: true }).click();
        await page.getByRole('button', { name: 'Folders', exact: true }).click();
        await expectVisualRows(page);
        await expectPairedFrame(page, width < 800);
        await expectFrames(page, baseline, `Visual after ${format}, round ${round + 1}`);
      }
    }
  });
}
