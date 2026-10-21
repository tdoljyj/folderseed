import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const revision = '47d54ca1ebb14fd864695f1d39dc734f39017c33';
const fonts = [
 { id: 'inter', path: 'inter/Inter[opsz,wght].ttf', sha256: '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031' },
 { id: 'sourcesans3', path: 'sourcesans3/SourceSans3[wght].ttf', sha256: '042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9' },
 { id: 'ibmplexsans', path: 'ibmplexsans/IBMPlexSans[wdth,wght].ttf', sha256: '3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3' },
];
await mkdir('artifacts/brand-type/fonts', { recursive: true });
for (const font of fonts) {
 const url = `https://raw.githubusercontent.com/google/fonts/${revision}/ofl/${encodeURI(font.path)}`;
 const response = await fetch(url);
 if (!response.ok) throw new Error(`Font download failed: ${response.status} ${font.id}`);
 const data = Buffer.from(await response.arrayBuffer());
 if (createHash('sha256').update(data).digest('hex') !== font.sha256) throw new Error(`Font integrity mismatch: ${font.id}`);
 await writeFile(`artifacts/brand-type/fonts/${font.id}.ttf`, data);
 console.log(`Verified ${font.id}, SIL Open Font License 1.1, ${data.length} bytes`);
}
await writeFile('artifacts/brand-type/font-sources.json', JSON.stringify({ repository: 'https://github.com/google/fonts', revision, license: 'SIL Open Font License 1.1', fonts }, null, 2));
