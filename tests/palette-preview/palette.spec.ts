import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const rgb = hex.replace('#', '').match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const [x, y] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (x + .05) / (y + .05);
}


test('attached bright-blue baseline and one Apple-inspired study', async ({ page }) => {
  const output = resolve('artifacts/apple-preview');
  await mkdir(output, { recursive: true });
  const baseline = await readFile(resolve('tests/palette-preview/baseline-polished.css'), 'utf8');
  const prior = await readFile(resolve('tests/palette-preview/apple-before-type.css'), 'utf8');
  const candidate = await readFile(resolve('tests/palette-preview/apple-inspired.css'), 'utf8');
  // Unify ALL old hard-coded slate text colors before applying the refined geometry.
  const neutralBaseline = baseline.replaceAll('#596579', '#626268').replaceAll('#222b3b', '#1D1D1F').replaceAll('#3f4a5b', '#37373D').replaceAll('#2563eb', '#0068D9').replaceAll('#1d4ed8', '#0055B3');
  const fontEvidence: unknown[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  async function typographyEvidence(label: string) {
    const { root } = await cdp.send('DOM.getDocument');
    const records = [];
    for (const selector of ['.fs-heading h1', '.fs-brand > span:last-child', '.fs-brand-subtitle', '.fs-template strong']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const rendered = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      const computed = await page.locator(selector).first().evaluate(el => {
        const style = getComputedStyle(el);
        return { family: style.fontFamily, weight: style.fontWeight, letterSpacing: style.letterSpacing, stretch: style.fontStretch, synthesis: style.fontSynthesis, transform: style.transform, size: style.fontSize };
      });
      expect(computed.transform).toBe('none');
      records.push({ selector, computed, rendered });
    }
    fontEvidence.push({ label, records });
  }
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const shots: { title: string; png: Buffer }[] = [];
  for (const [name, css] of [['baseline', baseline], ['apple-inspired', neutralBaseline + '\n' + candidate]] as const) {
    for (const [device, width, height] of [['desktop', 1440, 1080], ['mobile', 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('A little structure.');
      if (name === 'apple-inspired') {
        await page.addStyleTag({ content: neutralBaseline + '\n' + prior });
        await page.evaluate(() => document.fonts.ready);
        await typographyEvidence(`before-${device}`);
      }
      await page.addStyleTag({ content: css });
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await expect(page.getByRole('button', { name: 'Download ZIP', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const png = await page.screenshot({ path: `${output}/${name}-${device}.png`, fullPage: true });
      if (device === 'desktop') shots.push({ title: name === 'baseline' ? '01 / Your selected version' : '02 / Apple-inspired study', png });
      if (name === 'apple-inspired') {
        await typographyEvidence(`after-${device}`);
        const brand = await page.locator('.fs-brand').evaluate(el => {
          const mark = el.querySelector('.fs-brand-mark')!.getBoundingClientRect();
          const text = el.querySelector(':scope > span:last-child')!.getBoundingClientRect();
          const tagline = el.querySelector('.fs-brand-subtitle')!;
          const rect = tagline.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(tagline);
          const actualText = range.getBoundingClientRect();
          return { centerOffset: Math.abs((mark.top + mark.height / 2) - (text.top + text.height / 2)), taglineHeight: rect.height, lineHeight: parseFloat(getComputedStyle(tagline).lineHeight), fits: actualText.right <= el.getBoundingClientRect().right + 1, markWidth: mark.width };
        });
        expect(brand.centerOffset).toBeLessThanOrEqual(1);
        expect(brand.taglineHeight).toBe(brand.lineHeight);
        expect(brand.fits).toBe(true);
        expect(brand.markWidth).toBe(device === 'desktop' ? 40 : 38);
        await page.locator('.fs-brand').screenshot({ path: `${output}/brand-${device}.png` });
        const cta = await page.locator('.fs-download').evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
        expect(cta).toEqual({ color: 'rgb(255, 255, 255)', background: 'rgb(0, 104, 217)' });
        await page.getByRole('button', { name: /^Add folder/ }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
    }
  }
  expect(errors).toEqual([]);
  const ratios = { body: contrast('#1D1D1F', '#FFFFFF'), secondaryOnSidebar: contrast('#626268', '#EEEEF0'), whiteCTA: contrast('#FFFFFF', '#0068D9') };
  for (const value of Object.values(ratios)) expect(value).toBeGreaterThanOrEqual(4.5);
  await writeFile(`${output}/typography-evidence.json`, JSON.stringify(fontEvidence, null, 2));
  await writeFile(`${output}/contrast.json`, JSON.stringify(ratios, null, 2));
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>FolderSeed / Selected version and Apple-inspired study</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#EDEDEF;color:#1D1D1F;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}h1{font-size:26px;letter-spacing:-.8px;font-weight:600;margin:0 0 6px}.intro{color:#626268;margin:0 0 25px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}article{background:white;border:1px solid #DCDCE1;border-radius:14px;overflow:hidden}header{padding:20px 22px}h2{font-size:18px;font-weight:600;letter-spacing:-.3px;margin:0}header p{font-size:12px;color:#626268;margin:5px 0 0}img{display:block;width:100%;height:auto;border-top:1px solid #E2E2E6}</style><h1>FolderSeed / A quieter, more native feel</h1><p class="intro">Your selected bright-blue version, compared with one Apple-inspired direction. Preview only.</p><div class="grid">${shots.map((shot, i) => `<article><header><h2>${shot.title}</h2><p>${i === 0 ? 'Bright-blue polished baseline — matched to your reference' : 'Neutral surfaces · refined spacing · native-style controls'}</p></header><img alt="${shot.title}" src="data:image/png;base64,${shot.png.toString('base64')}"></article>`).join('')}</div></html>`;
  await writeFile(`${output}/comparison.html`, html);
  await page.setViewportSize({ width: 2100, height: 1000 });
  await page.setContent(html);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  await page.screenshot({ path: `${output}/before-after.png`, fullPage: true });
});
