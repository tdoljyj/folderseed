import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test('brand-only four-way typography specimen with verified real fonts', async ({ page }) => {
 const output = resolve('artifacts/brand-type');
 await mkdir(output, { recursive: true });
 await page.goto('/');
 await expect(page.locator('.fs-brand-mark')).toBeVisible();
 const icon = await page.locator('.fs-brand-mark').innerHTML();
 const options = [
  { id: 'arial', family: 'Arial', name: 'Current / Arial', note: 'Baseline — current brand typography' },
  { id: 'inter', family: 'PreviewInter', name: 'A / Inter', note: 'Clean, compact, neutral' },
  { id: 'sourcesans3', family: 'PreviewSourceSans3', name: 'B / Source Sans 3', note: 'Open, humanist, naturally narrower' },
  { id: 'ibmplexsans', family: 'PreviewIBMPlexSans', name: 'C / IBM Plex Sans', note: 'Distinctive structure, precise terminals' },
 ];
 const faces = await Promise.all(options.slice(1).map(async font => {
  const bytes = await readFile(`${output}/fonts/${font.id}.ttf`);
  return `@font-face{font-family:'${font.family}';src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype');font-weight:100 900;font-style:normal;font-display:block;}`;
 }));
 const cards = options.map(font => `<article id="${font.id}" style="--family:'${font.family}'"><header><h2>${font.name}</h2><p>${font.note}</p></header><section><div class="caption">Actual size · 22 px / 500</div><div class="lockup"><span class="mark">${icon}</span><div><div class="brand specimen">FolderSeed</div><div class="tagline">A little structure goes a long way.</div></div></div></section><section><div class="caption">2× type size · 44 px / 500</div><div class="word-large specimen">FolderSeed</div></section><section><div class="caption">Letterform detail · 112 px / 500</div><div class="detail"><span class="letter specimen">F</span><div><div class="word-small specimen">FolderSeed</div><div class="annotation">Natural width<br>No scaling or compression</div></div></div></section><footer>Normal width · 0 tracking<br>Same text, size and requested weight</footer></article>`).join('');
 const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>FolderSeed / Brand typography comparison</title><style>${faces.join('\n')}*{box-sizing:border-box}body{margin:0;padding:40px;background:#F5F5F7;color:#1D1D1F;font:14px Arial,Helvetica,sans-serif}h1{font-size:28px;font-weight:400;margin:0 0 9px;letter-spacing:0}.intro{font-size:14px;color:#626268;line-height:1.6;margin:0 0 30px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}article{background:white;border:1px solid #DEDEE4;border-radius:15px;overflow:hidden;min-width:0}header{padding:24px;border-bottom:1px solid #ECECF0;background:#FAFAFB}h2{font-size:20px;font-weight:400;margin:0 0 8px}p{color:#626268;margin:0;font-size:12px}section{padding:25px 24px;border-bottom:1px solid #ECECF0}.caption{font-size:11px;color:#626268;margin-bottom:24px;letter-spacing:.3px}.specimen{font-family:var(--family),sans-serif;font-weight:500;font-style:normal;font-stretch:normal;font-synthesis:none;font-optical-sizing:none;font-kerning:normal;font-variant:normal;letter-spacing:0;transform:none}.lockup{display:flex;align-items:center;gap:10px;height:58px}.mark{height:42px;width:40px;flex:0 0 40px;display:flex;align-items:center;justify-content:center;background:#0068D9;color:white;border-radius:11px}.mark svg{width:26px;height:26px}.brand{font-size:22px;line-height:28px;white-space:nowrap}.tagline{font:10px/15px Arial,sans-serif;color:#626268;white-space:nowrap;margin-top:3px}.word-large{font-size:44px;line-height:62px;white-space:nowrap}.detail{display:flex;align-items:center;gap:26px;height:142px}.letter{font-size:112px;line-height:130px}.word-small{font-size:26px;line-height:36px}.annotation{font:11px/1.7 Arial,sans-serif;color:#626268;margin-top:10px}footer{padding:20px 24px;font:11px/1.7 Arial,sans-serif;color:#626268}.footnote{font-size:12px;line-height:1.7;color:#626268;margin-top:24px;max-width:1150px}</style><h1>FolderSeed / Find the right F</h1><p class="intro">Brand only. The rest of the interface stays unchanged.<br>Four real fonts, rendered at identical sizes — compare the letter shapes, not a stretched image.</p><div class="grid">${cards}</div><p class="footnote">Inter, Source Sans 3 and IBM Plex Sans are loaded from verified font files, licensed under SIL OFL 1.1. Arial uses the available system face; the exact rendered font is recorded in the evidence file. The 2× sample uses a larger font size, never a transform.</p></html>`;
 await page.setViewportSize({ width: 1900, height: 900 });
 await page.setContent(html);
 for (const font of options.slice(1)) {
  const loaded = await page.evaluate(async family => { await document.fonts.load(`500 22px "${family}"`, 'FolderSeed'); return document.fonts.check(`500 22px "${family}"`, 'FolderSeed'); }, font.family);
  expect(loaded).toBe(true);
 }
 await page.evaluate(() => document.fonts.ready);
 const cdp = await page.context().newCDPSession(page);
 await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
 const { root } = await cdp.send('DOM.getDocument');
 const evidence = [];
 for (const option of options) {
  const selector = `#${option.id} .brand`;
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const rendered = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  if (option.id !== 'arial') expect(rendered.fonts.some(font => font.isCustomFont && font.glyphCount > 0)).toBe(true);
  const computed = await page.locator(selector).evaluate(el => {
   const s = getComputedStyle(el);
   return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, stretch: s.fontStretch, spacing: s.letterSpacing, opticalSizing: s.fontOpticalSizing, transform: s.transform, synthesis: s.fontSynthesis, width: el.getBoundingClientRect().width };
  });
  expect(computed.size).toBe('22px'); expect(computed.weight).toBe('500'); expect(computed.transform).toBe('none');
  evidence.push({ ...option, rendered, computed });
  await page.locator(`#${option.id}`).screenshot({ path: `${output}/${option.id}.png` });
 }
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: `${output}/brand-type-comparison.png`, fullPage: true });
 await writeFile(`${output}/comparison.html`, html);
 await writeFile(`${output}/font-evidence.json`, JSON.stringify(evidence, null, 2));
});
