import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// PREVIEW ONLY: source CSS is read, never changed. Every layout declaration is identical.
const palettes = [
  { id: 'A-graphite', title: 'Graphite / Warm white', mood: 'Quiet, editorial, timeless', ink: '#282824', muted: '#626159', primary: '#363A35', dark: '#252923', paper: '#FFFEFB', surface: '#F6F4EE', sidebar: '#EEECE4', soft: '#FAF8F2', line: '#DEDCD2', faint: '#EEECE4', selection: '#E8EBE2', selectionLine: '#B7C0AD', rootFill: '#DCE3D5', folder: '#927045', folderFill: '#F1E5CF', secondary: '#6C6653', secondaryFill: '#EDE9DE', shadow: '#29271F' },
  { id: 'B-indigo', title: 'Indigo / Cool gray', mood: 'Precise, composed, contemporary', ink: '#272A3E', muted: '#5C6276', primary: '#4C4697', dark: '#383276', paper: '#FFFFFF', surface: '#F3F4F8', sidebar: '#EDEEF5', soft: '#F8F9FC', line: '#DCDFEA', faint: '#EEF0F6', selection: '#EBEAF8', selectionLine: '#B9B5DD', rootFill: '#DFDCF5', folder: '#8A754C', folderFill: '#F0E8D6', secondary: '#676B85', secondaryFill: '#E9EBF4', shadow: '#272840' },
  { id: 'C-teal', title: 'Deep teal / Mist white', mood: 'Grounded, fresh, quietly confident', ink: '#203936', muted: '#536C66', primary: '#17665F', dark: '#104D47', paper: '#FDFFFD', surface: '#F1F6F3', sidebar: '#E6EEEA', soft: '#F7FAF7', line: '#D5E1DA', faint: '#EAF1EC', selection: '#E0EEEA', selectionLine: '#A7C7BD', rootFill: '#D2E8DF', folder: '#877346', folderFill: '#EEE7D3', secondary: '#627563', secondaryFill: '#E4ECE1', shadow: '#163D32' },
];
type Palette = typeof palettes[number];
function cssFor(source: string, p: Palette) {
  const map: Record<string, string> = {};
  const set = (colors: string[], value: string) => colors.forEach(color => { map[color] = value; });
  set(['#222b3b', '#3f4a5b'], p.ink);
  set(['#596579'], p.muted);
  set(['#426fbe', '#365fa8', '#426ac0', '#4b75ba', '#3560a8'], p.primary);
  set(['#365fa8'], p.dark);
  set(['#ffffff', '#fff'], p.paper);
  set(['#f7f8fa'], p.surface);
  set(['#f1f3f5'], p.sidebar);
  set(['#fafbfc'], p.soft);
  set(['#f3f4f6'], p.faint);
  set(['#e3e6eb', '#dce0e6'], p.line);
  set(['#cbd1da', '#929dab'], p.selectionLine);
  set(['#e7efff', '#e8efff', '#eaf1ff', '#f0f5ff', '#f5f8ff', '#edf3ff'], p.selection);
  set(['#c7d7fb', '#d4dff5', '#d4e0f7', '#87a9ed', '#d6e3fc'], p.selectionLine);
  set(['#dbeafe'], p.rootFill);
  set(['#b0812f', '#93672b'], p.folder);
  set(['#f8e7bd', '#fbf2e2'], p.folderFill);
  set(['#efdfc1'], p.line);
  set(['#5263a5'], p.secondary);
  set(['#edf0fd'], p.secondaryFill);
  set(['#dce1f5'], p.line);
  set(['#17202e05'], `${p.shadow}05`);
  set(['#172b4d10'], `${p.shadow}10`);
  set(['#172b4d30'], `${p.shadow}30`);
  set(['#172b4d66'], `${p.shadow}66`);
  return source.replace(/#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, color => map[color.toLowerCase()] ?? color) + `
    .fs-app .fs-primary, .fs-app .fs-brand-mark { color: #ffffff; }
    .fs-app .fs-export-options button.is-active .fs-radio-dot { background: ${p.paper}; }
    .fs-app *, .fs-app *::before, .fs-app *::after { animation: none !important; transition: none !important; }
  `;
}
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const rgb = hex.replace('#', '').match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const [x, y] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (x + .05) / (y + .05);
}

test('three isolated palettes and a same-layout triptych', async ({ page }) => {
  const output = resolve('artifacts/palette-preview');
  await mkdir(output, { recursive: true });
  const source = await readFile(resolve('src/ui/style.css'), 'utf8');
  const shots: { palette: Palette; png: Buffer; contrast: Record<string, number> }[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let referenceGeometry: unknown;
  for (const palette of palettes) {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A little structure.');
    await page.addStyleTag({ content: cssFor(source, palette) });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible();
    const geometry = await page.locator('.fs-sidebar, .fs-heading, .fs-panel, .fs-download').evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }));
    if (referenceGeometry) expect(geometry).toEqual(referenceGeometry);
    else referenceGeometry = geometry;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    const ratios = { body: contrast(palette.ink, palette.paper), mutedOnSidebar: contrast(palette.muted, palette.sidebar), mutedOnSelection: contrast(palette.muted, palette.selection), cta: contrast('#FFFFFF', palette.primary) };
    for (const ratio of Object.values(ratios)) expect(ratio).toBeGreaterThanOrEqual(4.5);
    const png = await page.screenshot({ path: `${output}/${palette.id}.png`, fullPage: true });
    shots.push({ palette, png, contrast: ratios });
  }
  expect(errors).toEqual([]);
  await writeFile(`${output}/palettes.json`, JSON.stringify(shots.map(({ palette, contrast }) => ({ ...palette, contrast })), null, 2));
  const cards = shots.map(({ palette: p, png }) => `<article><header><div class="id">${p.id[0]}</div><div><h2>${p.title}</h2><p>${p.mood}</p></div></header><div class="swatches">${[p.primary, p.ink, p.sidebar, p.surface, p.paper].map(c => `<span style="background:${c}" title="${c}"></span>`).join('')}<small>${p.primary} · ${p.surface}</small></div><img alt="${p.title} — full desktop UI" src="data:image/png;base64,${png.toString('base64')}"></article>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>FolderSeed — palette studies</title><style>*{box-sizing:border-box}body{margin:0;background:#E8E7E3;color:#292A27;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:32px}h1{font-size:26px;letter-spacing:-.7px;margin:0 0 6px;font-weight:600}.intro{margin:0 0 28px;color:#62625B}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}article{min-width:0;background:#FCFCFA;border:1px solid #D4D4CE;border-radius:12px;overflow:hidden;box-shadow:0 5px 20px #25292308}header{display:flex;align-items:center;gap:12px;padding:20px 20px 10px}.id{font-size:17px;font-weight:600;width:36px;height:36px;display:grid;place-items:center;border:1px solid #D4D4CE;border-radius:50%}h2{font-size:18px;font-weight:600;letter-spacing:-.3px;margin:0}p{font-size:12px;color:#62625B;margin:5px 0 0}.swatches{display:flex;align-items:center;padding:4px 20px 18px;gap:5px}.swatches span{height:15px;width:26px;border:1px solid #00000012;border-radius:3px}small{margin-left:auto;font-size:10px;color:#62625B}img{display:block;width:100%;height:auto;border-top:1px solid #D4D4CE}</style><h1>FolderSeed / Three color directions</h1><p class="intro">Same layout. Same content. Color only. Preview branch — no changes to the main application.</p><div class="grid">${cards}</div></html>`;
  await writeFile(`${output}/comparison.html`, html);
  await page.setViewportSize({ width: 2220, height: 900 });
  await page.setContent(html);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  await page.screenshot({ path: `${output}/comparison-triptych.png`, fullPage: true });
});
