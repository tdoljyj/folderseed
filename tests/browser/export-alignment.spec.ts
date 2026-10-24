import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { flatten, parseJSON, serializeJSON, type DirectoryDocument } from '../../src/core';

// Inspect downloaded vector/raster content, not only the on-screen preview.
test.use({ locale: 'en-US' });

const fixture: DirectoryDocument = {
  version: 1,
  root: {
    id: 'root', name: 'WWWmmm project', comment: 'Root explanation',
    commentBinding: { source: 'folderseed-template', key: 'alignment.root' },
    children: [
      { id: 'short', name: 'A', comment: '  Keep <script> & "quotes" // literal text  ', children: [] },
      { id: 'wide', name: 'WWWmmm research & development', children: [
        { id: 'deep', name: '资料 🧑🏽‍💻 a\u0301\u0323', comment: '完整说明 👩‍👩‍👧‍👦 a\u0301\u0323', children: [] },
      ] },
      { id: 'arabic', name: 'مجلد', comment: 'تعليق كامل للمجلد', children: [] },
      { id: 'end', name: 'Z', comment: 'Last complete note', children: [] },
    ],
  },
};

async function download(page: Page, card: number, suffix: string) {
  await page.locator('.fs-export-options [role="radio"]').nth(card).click();
  const pending = page.waitForEvent('download');
  await page.locator('.fs-download').click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe(`${fixture.root.name}.${suffix}`);
  expect(await file.failure()).toBeNull();
  return readFile((await file.path())!);
}

for (const width of [1440, 390]) {
  test(`downloads aligned SVG/PNG and unchanged ZIP/JSON at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('folderseed:language:v1', 'en'));
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const canonical = parseJSON(serializeJSON(fixture));
    await page.locator('input[type="file"]').setInputFiles({
      name: 'alignment.json', mimeType: 'application/json', buffer: Buffer.from(serializeJSON(canonical)),
    });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('folderseed:draft:v1') ?? '{}').document?.root?.id)).toBe('root');

    const svg = (await download(page, 4, 'svg')).toString();
    await testInfo.attach(`aligned-${width}.svg`, { body: Buffer.from(svg), contentType: 'image/svg+xml' });
    const geometry = await page.evaluate(async source => {
      const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
      if (parsed.querySelector('parsererror')) throw new Error('Downloaded SVG is invalid XML.');
      const element = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
      element.style.cssText = 'position:absolute;left:-20000px;top:0;pointer-events:none';
      document.body.append(element);
      try {
        await document.fonts.ready;
        const bounds = (text: SVGTextElement) => {
          const box = text.getBBox();
          return {
            text: text.textContent, x: Number(text.getAttribute('x')), y: Number(text.getAttribute('y')),
            left: box.x, right: box.x + box.width,
            start: text.getStartPositionOfChar(0).x,
          };
        };
        return {
          width: element.viewBox.baseVal.width, height: element.viewBox.baseVal.height,
          names: [...element.querySelectorAll<SVGTextElement>('text[fill="#1d1d1f"]')].map(bounds),
          comments: [...element.querySelectorAll<SVGTextElement>('text')].filter(text => text.querySelector('tspan')).map(bounds),
          forbidden: element.querySelectorAll('script, foreignObject, image, style, [href], [onload]').length,
        };
      } finally { element.remove(); }
    }, svg);
    await testInfo.attach(`aligned-${width}-geometry.json`, { body: Buffer.from(JSON.stringify(geometry, null, 2)), contentType: 'application/json' });
    const rows = flatten(canonical);
    expect(geometry.forbidden).toBe(0);
    expect(geometry.names.map(row => row.text)).toEqual(rows.map(({ node }) => node.name));
    expect(geometry.names.map(row => row.x)).toEqual(rows.map(({ depth }) => 66 + depth * 28));
    expect(geometry.names.map(row => row.y)).toEqual(rows.map((_, index) => 117 + index * 32));
    expect(geometry.comments.map(row => row.text)).toEqual(rows.filter(({ node }) => node.comment).map(({ node }) => ` // ${node.comment}`));
    expect(new Set(geometry.comments.map(row => row.x)).size).toBe(1);
    const column = geometry.comments[0].x;
    expect(Math.max(...geometry.names.map(row => row.right))).toBeLessThanOrEqual(column - 24);
    for (const row of geometry.comments) {
      expect(row.start).toBeCloseTo(column, 1);
      expect(row.left).toBeGreaterThanOrEqual(column - 1);
      expect(row.right).toBeLessThanOrEqual(geometry.width - 32);
    }
    expect(geometry.comments.map(row => row.y)).toEqual(rows.flatMap(({ node }, index) => node.comment ? [117 + index * 32] : []));

    const png = await download(page, 5, 'png');
    await testInfo.attach(`aligned-${width}.png`, { body: png, contentType: 'image/png' });
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const pngWidth = png.readUInt32BE(16), pngHeight = png.readUInt32BE(20);
    expect(pngWidth).toBe(geometry.width * 2);
    expect(pngHeight).toBe(geometry.height * 2);
    expect(pngWidth).toBeLessThanOrEqual(8192);
    expect(pngHeight).toBeLessThanOrEqual(8192);
    expect(pngWidth * pngHeight).toBeLessThanOrEqual(32_000_000);
    const raster = await page.evaluate(async ({ data, column, baselines }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const ink = baselines.map(y => {
        const { data } = context.getImageData(column * 2, (y - 14) * 2, 160, 36);
        let pixels = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3] > 0 && data[index] < 190 && data[index + 1] < 190 && data[index + 2] < 190) pixels++;
        }
        return pixels;
      });
      return { width: image.naturalWidth, height: image.naturalHeight, ink };
    }, { data: png.toString('base64'), column, baselines: geometry.comments.map(row => row.y) });
    expect(raster.width).toBe(pngWidth);
    expect(raster.height).toBe(pngHeight);
    expect(raster.ink.every(pixels => pixels > 20)).toBe(true);

    const json = (await download(page, 3, 'json')).toString();
    expect(JSON.parse(json).version).toBe(3);
    expect(parseJSON(json)).toEqual(canonical);
    const zip = unzipSync(await download(page, 0, 'zip'));
    expect(Object.keys(zip)).toEqual(rows.map(({ path }) => `${path}/`));
    expect(Object.values(zip).every(bytes => bytes.length === 0)).toBe(true);
    expect(Object.keys(zip).every(path => !path.includes(' // '))).toBe(true);
  });
}
