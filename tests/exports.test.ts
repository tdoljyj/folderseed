import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { createDocument, addFolder, flatten, parseIndented, parseJSON, type DirectoryDocument } from '../src/core';
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

  it('TXT can be imported again without losing hierarchy', async () => {
    const document = fixture();
    const output = await createExport(document, 'txt');
    expect(paths(parseIndented(await output.blob.text()))).toEqual(paths(document));
    expect(output.blob.type).toContain('text/plain');
  });

  it('Markdown uses a fenced plain-text tree and can be imported again', async () => {
    const document = fixture();
    const output = await createExport(document, 'md');
    const text = await output.blob.text();
    expect(text.startsWith('```text\n')).toBe(true);
    expect(paths(parseIndented(text))).toEqual(paths(document));
  });

  it('Markdown safely fences folder names containing backtick runs', async () => {
    const document = createDocument('```');
    const output = await createExport(document, 'md');
    const text = await output.blob.text();
    expect(text.startsWith('````text\n')).toBe(true);
    expect(paths(parseIndented(text))).toEqual(paths(document));
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
    for (const format of ['zip', 'txt', 'md', 'json', 'svg', 'png'] as const) {
      await expect(createExport(invalid, format)).rejects.toThrow();
    }
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
