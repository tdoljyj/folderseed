import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { createDocument, flatten, formatText, formatTree, getTextLayout, parseJSON, parseText, serializeJSON, type DirectoryDocument } from '../src/core';
import { createExport, renderSVG } from '../src/exports';

function fixture(): DirectoryDocument {
  return {
    version: 1,
    root: {
      id: 'root', name: 'My project', comment: 'Root explanation',
      commentBinding: { source: 'folderseed-template', key: 'alignment.root' },
      children: [
        { id: 'short', name: 'A', comment: '  Longer comment // <script>alert("x")</script> & \'quoted\'  ', children: [] },
        { id: 'wide', name: 'WWWmmm research & development', children: [
          { id: 'deep', name: '资料 🧑🏽‍💻 e\u0301', comment: '文件夹 👩‍👩‍👧‍👦 a\u0301\u0323 — complete text', children: [] },
        ] },
        { id: 'end', name: 'Z', comment: 'Last note', children: [] },
      ],
    },
  };
}

function xmlText(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  })[entity]!);
}

function svgRows(svg: string) {
  const texts = [...svg.matchAll(/<text x="(\d+)" y="(\d+)"([^>]*)>(.*?)<\/text>/g)];
  return {
    names: texts.filter(match => match[3].includes('fill="#1d1d1f"')).map(match => ({
      x: Number(match[1]), y: Number(match[2]), text: xmlText(match[4]),
    })),
    comments: texts.filter(match => match[4].startsWith('<tspan fill="#626268"')).map(match => ({
      x: Number(match[1]), y: Number(match[2]), text: xmlText(match[4].replace(/^<tspan[^>]*>|<\/tspan>$/g, '')),
    })),
  };
}

function browserCanvas() {
  const scale = vi.fn(), drawImage = vi.fn();
  const canvas = {
    width: 0, height: 0,
    getContext: vi.fn(() => ({ scale, drawImage })),
    toBlob: vi.fn((callback: (blob: Blob) => void, type: string) => callback(new Blob(['rasterized'], { type }))),
  };
  const allocate = vi.fn(() => canvas);
  const source = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg-test');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { createElement: allocate });
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  return { canvas, scale, drawImage, allocate, source, revoke };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('aligned image export columns', () => {
  it.each(['txt', 'md', 'ascii', 'unicode', 'md-tree'] as const)('%s keeps the caller’s shared generated-text column without rewriting literal metadata', async format => {
    const input = fixture();
    const before = serializeJSON(input);
    const options = { minimumCommentColumn: 96 };
    const text = await (await createExport(input, format, options)).blob.text();
    const syntax = format === 'txt' ? 'plain' : format === 'md' ? 'markdown' : format === 'md-tree' ? 'unicode' : format;
    const expected = format === 'md-tree' ? `\`\`\`text\n${formatTree(input, options)}\n\`\`\`\n` : `${formatText(input, syntax, 4, options)}\n`;
    expect(text).toBe(expected);
    expect(getTextLayout(input, 4, options.minimumCommentColumn).commentColumn).toBe(96);
    const parsed = parseText(text, format === 'md-tree' ? 'markdown' : syntax);
    expect(flatten(parsed).map(({ node, path }) => ({ path, comment: node.comment })))
      .toEqual(flatten(input).map(({ node, path }) => ({ path, comment: node.comment })));
    expect(serializeJSON(input)).toBe(before);
  });

  it('text layout options leave JSON bindings, ZIP entries and vector geometry unchanged', async () => {
    const input = fixture();
    for (const format of ['json', 'svg'] as const) {
      const plain = await createExport(input, format);
      const aligned = await createExport(input, format, { minimumCommentColumn: 96 });
      expect(new Uint8Array(await aligned.blob.arrayBuffer())).toEqual(new Uint8Array(await plain.blob.arrayBuffer()));
      expect(aligned.filename).toBe(plain.filename);
    }
    const zip = await createExport(input, 'zip');
    const alignedZIP = await createExport(input, 'zip', { minimumCommentColumn: 96 });
    expect(unzipSync(new Uint8Array(await alignedZIP.blob.arrayBuffer()))).toEqual(unzipSync(new Uint8Array(await zip.blob.arrayBuffer())));
  });

  it('uses one explicit comment X across root, siblings and descendants without changing row anchors or text', () => {
    const input = fixture();
    const before = serializeJSON(input);
    const { svg, width, height } = renderSVG(input);
    const { names, comments } = svgRows(svg);
    const rows = flatten(parseJSON(before));
    expect(names.map(row => row.text)).toEqual(rows.map(({ node }) => node.name));
    expect(names.map(row => row.x)).toEqual(rows.map(({ depth }) => 66 + depth * 28));
    expect(names.map(row => row.y)).toEqual(rows.map((_, index) => 117 + index * 32));
    expect(new Set(comments.map(row => row.x)).size).toBe(1);
    expect(comments.map(row => row.text)).toEqual(rows.filter(({ node }) => node.comment).map(({ node }) => ` // ${node.comment}`));
    expect(comments.map(row => row.y)).toEqual(rows.flatMap(({ node }, index) => node.comment ? [117 + index * 32] : []));
    expect(comments[0].x).toBeGreaterThan(names[2].x + names[2].text.length * 11 + 28);
    expect(width).toBeGreaterThan(comments[0].x + comments[1].text.length * 11);
    expect(height).toBe(112 + rows.length * 32 + 40);
    expect(serializeJSON(input)).toBe(before);
  });

  it('sizes the common column from uncommented long names and the canvas from a different row’s longest comment', () => {
    const input = createDocument('Root');
    input.root.comment = 'W'.repeat(200);
    input.root.children = [{ id: 'wide', name: 'm'.repeat(100), children: [] }];
    const initial = renderSVG(input);
    const comment = svgRows(initial.svg).comments[0];
    expect(comment.x).toBeGreaterThanOrEqual(94 + 100 * 17 + 28);
    expect(initial.width).toBeGreaterThanOrEqual(comment.x + 200 * 17 + 40);
    input.root.children[0].name = 'Short';
    const shortened = renderSVG(input);
    expect(svgRows(shortened.svg).comments[0].x).toBeLessThan(comment.x);
    expect(shortened.width).toBeLessThan(initial.width);
  });

  it.each(['名'.repeat(80), '🧑🏽‍💻'.repeat(15), 'a\u0301\u0323'.repeat(20), 'm'.repeat(100)])(
    'conservatively reserves mixed-width and combining root text: %s', name => {
      const input = createDocument(name);
      input.root.comment = 'End of root';
      input.root.children = [{ id: 'child', name: 'Child', comment: 'End of child', children: [] }];
      const { svg, width } = renderSVG(input);
      const { names, comments } = svgRows(svg);
      expect(new Set(comments.map(row => row.x)).size).toBe(1);
      expect(comments[0].x).toBeGreaterThanOrEqual(names[0].x + [...input.root.name].length * 16 + 28);
      expect(width).toBeGreaterThan(comments[0].x + ' // End of child'.length * 11);
      expect(names[0].text).toBe(input.root.name);
    },
  );

  it('keeps full literal XML-safe content and includes no HTML, scripts, external fonts or remote references', () => {
    const { svg } = renderSVG(fixture());
    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &apos;quoted&apos;');
    expect(svg).not.toMatch(/<(?:script|foreignObject|style|image)\b|(?:href|src|onload)=|@font-face/i);
    expect(svg).not.toContain('…');
    expect(svgRows(svg).comments[1].text.endsWith("'quoted'  ")).toBe(true);
    expect(svg).toContain('xml:space="preserve"');
  });

  it('leaves uncommented images comment-free, without reserving an unused column', () => {
    const input = createDocument('Root');
    const { svg, width } = renderSVG(input);
    expect(svgRows(svg).comments).toEqual([]);
    expect(width).toBe(480);
  });

  it('uses the aligned SVG for PNG and always stays within both canvas limits after rounding', async () => {
    const input = createDocument('Wide tree');
    input.root.comment = 'W'.repeat(200);
    input.root.children = Array.from({ length: 205 }, (_, index) => ({ id: `n${index}`, name: `Folder ${index}`, children: [] }));
    const rendered = renderSVG(input);
    const scaleBeforeRounding = Math.sqrt(32_000_000 / (rendered.width * rendered.height));
    expect(scaleBeforeRounding).toBeGreaterThanOrEqual(1);
    expect(Math.ceil(rendered.width * scaleBeforeRounding) * Math.ceil(rendered.height * scaleBeforeRounding)).toBeGreaterThan(32_000_000);
    const browser = browserCanvas();
    const result = await createExport(input, 'png');
    expect(result.blob.type).toBe('image/png');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(browser.canvas.width).toBeGreaterThanOrEqual(rendered.width);
    expect(browser.canvas.height).toBeGreaterThanOrEqual(rendered.height);
    expect(browser.canvas.width).toBeLessThanOrEqual(8192);
    expect(browser.canvas.height).toBeLessThanOrEqual(8192);
    expect(browser.canvas.width * browser.canvas.height).toBeLessThanOrEqual(32_000_000);
    const source = browser.source.mock.calls[0][0] as Blob;
    expect(await source.text()).toBe(rendered.svg);
    expect(browser.scale).toHaveBeenCalledWith(browser.canvas.width / rendered.width, browser.canvas.height / rendered.height);
    expect(browser.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, rendered.width, rendered.height);
    expect(browser.revoke).toHaveBeenCalledWith('blob:svg-test');
  });

  it.each(['width', 'height', 'area'] as const)('rejects oversized PNG %s before image/canvas allocation while SVG keeps all text', async dimension => {
    const input = createDocument('Root');
    input.root.comment = 'W'.repeat(dimension === 'width' ? 500 : dimension === 'area' ? 300 : 1);
    if (dimension !== 'width') input.root.children = Array.from({ length: dimension === 'height' ? 260 : 210 }, (_, index) => ({ id: `n${index}`, name: `Folder ${index}`, children: [] }));
    const { svg, width, height } = renderSVG(input);
    if (dimension === 'width') expect(width).toBeGreaterThan(8192);
    if (dimension === 'height') expect(height).toBeGreaterThan(8192);
    if (dimension === 'area') {
      expect(width).toBeLessThan(8192);
      expect(height).toBeLessThan(8192);
      expect(width * height).toBeGreaterThan(32_000_000);
    }
    const browser = browserCanvas();
    await expect(createExport(input, 'png')).rejects.toThrow('too large for PNG');
    expect(browser.source).not.toHaveBeenCalled();
    expect(browser.allocate).not.toHaveBeenCalled();
    expect(svgRows(svg).comments[0].text).toBe(` // ${input.root.comment}`);
  });

  it('leaves ZIP names/directories and JSON IDs/comments/template bindings lossless', async () => {
    const input = parseJSON(serializeJSON(fixture()));
    const json = await (await createExport(input, 'json')).blob.text();
    expect(JSON.parse(json).version).toBe(3);
    expect(parseJSON(json)).toEqual(input);
    const entries = unzipSync(new Uint8Array(await (await createExport(input, 'zip')).blob.arrayBuffer()));
    expect(Object.keys(entries)).toEqual(flatten(input).map(({ path }) => `${path}/`));
    expect(Object.values(entries).every(bytes => bytes.length === 0)).toBe(true);
    expect(Object.keys(entries).every(path => !path.includes(' // '))).toBe(true);
  });
});
