import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { createDocument, addFolder, flatten, parseIndented, parseText, parseJSON, type DirectoryDocument } from '../src/core';
import { createExport, renderSVG } from '../src/exports';

function fixture(): DirectoryDocument {
  let document = createDocument('My project');
  document = addFolder(document, document.root.id, 'Photos');
  document = addFolder(document, document.root.id, 'Empty folder');
  const images = document.root.children[0];
  return addFolder(document, images.id, '\u65c5\u884c');
}

const paths = (document: DirectoryDocument) => flatten(document).map((row) => row.path);

describe('directory exports', () => {
  it('ZIP preserves actual empty directories, root, Unicode and hierarchy with no files', async () => {
    const output = await createExport(fixture(), 'zip');
    expect(output.filename).toBe('My project.zip');
    expect(output.blob.type).toBe('application/zip');
    const bytes = new Uint8Array(await output.blob.arrayBuffer());
    const files = unzipSync(bytes);
    const view = new DataView(bytes.buffer);
    let directoryHeaders = 0;
    for (let offset = 0; offset <= bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      expect(view.getUint16(offset + 4, true) >>> 8).toBe(3);
      const attributes = view.getUint32(offset + 38, true);
      expect(attributes & 0x10).toBe(0x10);
      expect((attributes >>> 16) & 0xF000).toBe(0x4000);
      directoryHeaders++;
    }
    expect(directoryHeaders).toBe(4);
    expect(Object.keys(files)).toEqual(['My project/', 'My project/Photos/', 'My project/Photos/\u65c5\u884c/', 'My project/Empty folder/']);
    for (const [name, bytes] of Object.entries(files)) {
      expect(name.endsWith('/')).toBe(true);
      expect(bytes.byteLength).toBe(0);
    }
  });

  it('download names preserve extensions within the 255-byte filename limit', async () => {
    const document = createDocument('\u540d'.repeat(85));
    const output = await createExport(document, 'json');
    expect(new TextEncoder().encode(output.filename).byteLength).toBeLessThanOrEqual(255);
    expect(output.filename.endsWith('.json')).toBe(true);
    expect(parseJSON(await output.blob.text()).root.name).toBe(document.root.name);
  });

  it.each([
    ['Project', 'Project.txt'],
    ['Project.ascii', 'Project.ascii.plain.txt'],
    ['Project.ASCII', 'Project.ASCII.plain.txt'],
    ['Project.tree', 'Project.tree.plain.txt'],
    ['Project.TrEe', 'Project.TrEe.plain.txt'],
    ['Project.plain', 'Project.plain.txt'],
    ['Project.PLAIN', 'Project.PLAIN.txt'],
  ])('plain TXT disambiguates reserved format suffixes for %s', async (name, filename) => {
    const document = createDocument(name);
    const output = await createExport(document, 'txt');
    expect(output.filename).toBe(filename);
    expect(paths(parseText(await output.blob.text(), 'plain'))).toEqual(paths(document));
  });

  it.each([
    '\u540d'.repeat(81) + 'aa.asciiZ',
    '\u540d'.repeat(81) + 'aa.ASCIIZ',
    '\u540d'.repeat(82) + '.treeZ',
    '\u540d'.repeat(82) + '.TrEeZ',
  ])('plain TXT rechecks format collisions after UTF-8 truncation', async (name) => {
    const document = createDocument(name);
    const output = await createExport(document, 'txt');
    expect(output.filename.endsWith('.plain.txt')).toBe(true);
    expect(new TextEncoder().encode(output.filename).byteLength).toBeLessThanOrEqual(255);
    expect(paths(parseText(await output.blob.text(), 'plain'))).toEqual(paths(document));
  });

  it.each(['.ascii', '.tree', '.plain'])('long Unicode TXT names retain data with a %s root suffix', async (suffix) => {
    const document = createDocument('\u540d'.repeat(83) + suffix);
    const output = await createExport(document, 'txt');
    expect(new TextEncoder().encode(output.filename).byteLength).toBeLessThanOrEqual(255);
    expect(output.filename).not.toMatch(/\.(?:ascii|tree)\.txt$/i);
    expect(paths(parseText(await output.blob.text(), 'plain'))).toEqual(paths(document));
  });

  it('TXT can be imported again without losing hierarchy', async () => {
    const document = fixture();
    const output = await createExport(document, 'txt');
    expect(paths(parseIndented(await output.blob.text()))).toEqual(paths(document));
    expect(output.blob.type).toContain('text/plain');
  });

  it.each([['txt', 'Root\n    Child\n        Grandchild\n'], ['md', '- `Root`\n    - `Child`\n        - `Grandchild`\n']] as const)('%s output uses four spaces per level', async (format, expected) => {
    const output = await createExport(parseIndented('Root\n  Child\n    Grandchild'), format);
    expect(await output.blob.text()).toBe(expected);
  });

  it('Markdown tree keeps the fenced Unicode tree as a separate export choice', async () => {
    const document = fixture();
    const output = await createExport(document, 'md-tree');
    const text = await output.blob.text();
    expect(text.startsWith('```text\n')).toBe(true);
    expect(paths(parseIndented(text))).toEqual(paths(document));
  });

  it('Markdown tree safely fences folder names containing backtick runs', async () => {
    const document = createDocument('```');
    const output = await createExport(document, 'md-tree');
    const text = await output.blob.text();
    expect(text.startsWith('````text\n')).toBe(true);
    expect(paths(parseIndented(text))).toEqual(paths(document));
  });


  it.each([
    { format: 'txt', syntax: 'plain', suffix: '.txt', mime: 'text/plain' },
    { format: 'md', syntax: 'markdown', suffix: '.md', mime: 'text/markdown' },
    { format: 'md-tree', syntax: 'markdown', suffix: '.tree.md', mime: 'text/markdown' },
    { format: 'ascii', syntax: 'ascii', suffix: '.ascii.txt', mime: 'text/plain' },
    { format: 'unicode', syntax: 'unicode', suffix: '.tree.txt', mime: 'text/plain' },
  ] as const)('$format roundtrips with explicit and automatic parsing', async ({ format, syntax, suffix, mime }) => {
    const document = fixture();
    const output = await createExport(document, format);
    const text = await output.blob.text();
    expect(output.filename).toBe(`My project${suffix}`);
    expect(output.blob.type).toBe(`${mime};charset=utf-8`);
    expect(paths(parseText(text, syntax))).toEqual(paths(document));
    expect(paths(parseText(text, 'auto'))).toEqual(paths(document));
  });

  it('Markdown exports a nested list rather than a fenced diagram', async () => {
    const output = await createExport(fixture(), 'md');
    const text = await output.blob.text();
    expect(text).toMatch(/^- /);
    expect(text).toMatch(/\n    - /);
    expect(text).not.toMatch(/^```/);
  });

  it('ASCII and Unicode exports use distinct connector characters', async () => {
    const ascii = await (await createExport(fixture(), 'ascii')).blob.text();
    const unicode = await (await createExport(fixture(), 'unicode')).blob.text();
    expect(ascii).not.toMatch(/[\u2500-\u257f]/u);
    expect(ascii).toContain('Photos');
    expect(unicode).toMatch(/[\u251c\u2514]/u);
  });

  it.each([
    { format: 'ascii', suffix: '.ascii.txt', syntax: 'ascii' },
    { format: 'unicode', suffix: '.tree.txt', syntax: 'unicode' },
    { format: 'md-tree', suffix: '.tree.md', syntax: 'markdown' },
    { format: 'md', suffix: '.md', syntax: 'markdown' },
  ] as const)('$format preserves its full extension within the UTF-8 filename cap', async ({ format, suffix, syntax }) => {
    const document = createDocument('\u540d'.repeat(85));
    const output = await createExport(document, format);
    expect(new TextEncoder().encode(output.filename).byteLength).toBeLessThanOrEqual(255);
    expect(output.filename.endsWith(suffix)).toBe(true);
    expect(paths(parseText(await output.blob.text(), syntax))).toEqual(paths(document));
    expect(document.root.name).toHaveLength(85);
  });

  it.each(['txt', 'md', 'md-tree', 'ascii', 'unicode'] as const)('%s preserves names with Markdown punctuation and backticks', async (format) => {
    let document = createDocument('Project [draft]');
    document = addFolder(document, document.root.id, '_notes_ & `ideas`');
    document = addFolder(document, document.root.id, '~~~');
    const output = await createExport(document, format);
    expect(paths(parseText(await output.blob.text(), 'auto'))).toEqual(paths(document));
  });

  it('unknown export formats fail explicitly', async () => {
    await expect(createExport(fixture(), 'unsupported' as never)).rejects.toThrow('Unsupported export format');
  });

  it('versioned JSON keeps node IDs and structure exactly', async () => {
    const document = fixture();
    const output = await createExport(document, 'json');
    expect(parseJSON(await output.blob.text())).toEqual(document);
  });

  it('SVG escapes user-controlled names and avoids external resources or foreignObject', () => {
    const document = createDocument('Research & development');
    const { svg, width, height } = renderSVG(document);
    expect(svg).toContain('Research &amp; development');
    expect(svg).not.toContain('Research & development');
    expect(svg).not.toContain('<foreignObject');
    expect(svg).not.toContain('<script');
    expect(svg).not.toMatch(/(?:href|src)=/);
    expect(width).toBeGreaterThanOrEqual(480);
    expect(height).toBeGreaterThan(150);
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
  });

  it('SVG dimensions grow to fit wide names and tall trees', () => {
    const normal = renderSVG(createDocument('Project'));
    const wide = renderSVG(createDocument('\u540d'.repeat(80)));
    expect(wide.width).toBeGreaterThan(normal.width);
    expect(renderSVG(fixture()).height).toBeGreaterThan(normal.height);
  });

  it('all export formats validate unsafe documents before producing output', async () => {
    const invalid = { version: 1, root: { id: 'unsafe', name: '../outside', children: [] } } as DirectoryDocument;
    for (const format of ['zip', 'txt', 'md', 'md-tree', 'ascii', 'unicode', 'json', 'svg', 'png'] as const) {
      await expect(createExport(invalid, format)).rejects.toThrow();
    }
  });


  it.each(['md', 'md-tree', 'ascii', 'unicode'] as const)('%s rejects models exceeding the folder limit', async (format) => {
    const oversized = createDocument('Too many folders');
    oversized.root.children = Array.from({ length: 500 }, (_, index) => ({
      id: `folder-${index}`, name: `Folder ${index}`, children: [],
    }));
    await expect(createExport(oversized, format)).rejects.toThrow();
  });

  it('PNG refuses oversized canvases before allocating an image', async () => {
    const large = createDocument('Large tree');
    large.root.children = Array.from({ length: 260 }, (_, index) => ({ id: `folder-${index}`, name: `Folder ${index}`, children: [] }));
    await expect(createExport(large, 'png')).rejects.toThrow('too large for PNG');
  });

  it('PNG gives a useful error outside browser contexts', async () => {
    await expect(createExport(fixture(), 'png')).rejects.toThrow('requires a browser');
  });
});
