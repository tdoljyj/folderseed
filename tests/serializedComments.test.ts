import { describe, expect, it } from 'vitest';
import {
  createDocument, flatten, formatASCII, formatFolderLabel, formatIndented, formatMarkdown,
  formatText, formatTree, LIMITS, parseIndented, parseText, validateDocument,
  type DirectoryDocument, type FolderNode,
} from '../src/core';
import { reconcileTextSnapshot } from '../src/ui/commentPresentation';
import { createTranslator } from '../src/ui/i18n';
import { resolveTemplateComments } from '../src/ui/templateComments';
import { makeTemplate } from '../src/ui/templates';

const formats = ['plain', 'ascii', 'unicode', 'markdown'] as const;
const content = (document: DirectoryDocument) => flatten(document).map(({ node, path, depth }) => ({
  name: node.name, comment: node.comment, path, depth,
}));
const asciiColumns = (text: string) => text.split('\n').filter(line => line.includes(' // '))
  .map(line => line.replace(/\t/g, '    ').indexOf(' // '));

function fixture() {
  return parseText('Root // root note\n    Short // short note\n        Nested // nested note\n    A longer sibling // sibling note\n    Without a comment', 'plain');
}

describe('generated comment columns', () => {
  it.each(formats)('aligns %s separators across different name lengths and depths', format => {
    const document = fixture();
    const text = formatText(document, format, 4);
    expect(new Set(asciiColumns(text)).size).toBe(1);
    expect(content(parseText(text, format))).toEqual(content(document));
    expect(content(parseText(text))).toEqual(content(document));
    expect(formatText(parseText(text, format), format, 4)).toBe(text);
  });

  it('shares alignment between public helpers without changing raw labels', () => {
    const document = fixture();
    expect(formatText(document, 'plain')).toBe(formatIndented(document));
    expect(formatText(document, 'ascii')).toBe(formatASCII(document));
    expect(formatText(document, 'unicode')).toBe(formatTree(document));
    expect(formatText(document, 'markdown')).toBe(formatMarkdown(document));
    expect(formatFolderLabel(document.root)).toBe('Root // root note');
    expect(formatIndented(document, 4)).toBe([
      'Root                 // root note',
      '    Short            // short note',
      '        Nested       // nested note',
      '    A longer sibling // sibling note',
      '    Without a comment',
    ].join('\n'));
  });

  it.each([2, 4, 'tabs'] as const)('aligns %s-space/tab output and preserves legacy parsing', indent => {
    const document = fixture();
    for (const format of ['plain', 'markdown'] as const) {
      const output = formatText(document, format, indent);
      expect(new Set(asciiColumns(output)).size).toBe(1);
      expect(content(parseText(output, format, indent))).toEqual(content(document));
    }
    expect(content(parseIndented(formatIndented(document, indent), indent))).toEqual(content(document));
    expect(content(parseIndented(formatTree(document)))).toEqual(content(document));
  });

  it('does not add padding or separators to uncommented rows or widen for their names', () => {
    const document = parseText('Root // note\n    Short // another\n    ' + 'x'.repeat(100), 'plain');
    expect(formatIndented(document, 4).split('\n')).toEqual([
      'Root      // note', '    Short // another', '    ' + 'x'.repeat(100),
    ]);
    delete document.root.comment;
    delete document.root.children[0].comment;
    expect(formatIndented(document, 4)).toBe('Root\n    Short\n    ' + 'x'.repeat(100));
  });

  it.each([
    ['日本語', 6], ['ＡＢ', 4], ['𠀀', 2], ['ｶﾅ', 2], ['가', 2],
    ['Cafe\u0301', 4], ['x\u0301\u0327', 1], ['\u0301', 0],
    ['📁', 2], ['👩🏽‍💻', 2], ['👨‍👩‍👧‍👦', 2], ['🇨🇳', 2],
    ['👍🏽', 2], ['1️⃣', 2], ['☀️', 2], ['☀︎', 1], ['A\u200DB', 2],
  ] as const)('uses display cells for %j rather than string length', (name, width) => {
    const document = createDocument('R'.repeat(30));
    document.root.comment = 'root';
    document.root.children.push({ id: 'child', name, comment: 'child', children: [] });
    const normalizedName = validateDocument(document).root.children[0].name;
    for (const format of ['plain', 'ascii', 'unicode'] as const) {
      const line = formatText(document, format, 4).split('\n')[1];
      const prefix = format === 'plain' ? '    ' : format === 'ascii' ? '`-- ' : '└── ';
      expect(line).toBe(prefix + normalizedName + ' '.repeat(31 - 4 - width) + '// child');
    }
    const markdownLine = formatMarkdown(document, 4).split('\n')[1];
    expect(markdownLine).toBe('    - `' + normalizedName + ' '.repeat(31 - 4 - width) + '// child`');
  });

  it('includes varying Markdown code delimiters and required padding in the column', () => {
    const document = createDocument('`Root`');
    document.root.comment = '  keep // whitespace  ';
    document.root.children.push(
      { id: 'one', name: 'Short', comment: '```longest`````', children: [] },
      { id: 'two', name: '```Folder', comment: '`', children: [] },
      { id: 'three', name: 'Normal', comment: '  Cafe\u0301 // literal  ', children: [] },
    );
    const output = formatMarkdown(document, 4);
    expect(new Set(asciiColumns(output)).size).toBe(1);
    expect(content(parseText(output, 'markdown'))).toEqual(content(document));
    expect(formatMarkdown(parseText(output, 'markdown'), 4)).toBe(output);
  });

  it.each(formats)('preserves bound localized template identity through %s generation', format => {
    const canonical = makeTemplate(0);
    const original = JSON.stringify(canonical);
    const projection = resolveTemplateComments(canonical, createTranslator('zh-CN'));
    const parsed = parseText(formatText(projection, format, 4), format);
    expect(reconcileTextSnapshot(canonical, parsed, projection)).toBe(canonical);
    expect(JSON.stringify(canonical)).toBe(original);
  });
});

describe('alignment parsing boundaries', () => {
  it.each(formats)('removes only name-side ASCII padding in %s', format => {
    const label = 'Root/       //   leading // literal  ';
    const text = format === 'markdown' ? '- `' + label + '`' : label;
    const document = parseText(text, format);
    expect(document.root.name).toBe('Root');
    expect(document.root.comment).toBe('  leading // literal  ');
    expect(parseText(formatText(document, format), format).root.comment).toBe(document.root.comment);
  });

  it('keeps internal name spaces and empty-comment removal without relaxing whitespace validation', () => {
    expect(parseText('A  B        // ', 'plain').root).toMatchObject({ name: 'A  B' });
    expect(parseText('A  B        // ', 'plain').root.comment).toBeUndefined();
    for (const invalid of ['Root   ', 'Root\t // note', 'Root\u00a0 // note', 'Root / // note']) {
      expect(() => parseText(invalid, 'plain')).toThrow();
    }
  });

  it.each(['plain', 'markdown'] as const)('keeps original names/comments at maximum size in %s', format => {
    const document = createDocument('界'.repeat(80));
    document.root.comment = '`'.repeat(LIMITS.commentLength);
    let parent = document.root;
    const node = (index: number): FolderNode => ({
      id: `node-${index}`, name: `${'界'.repeat(80)}-${index}`,
      comment: '`'.repeat(LIMITS.commentLength), children: [],
    });
    for (let index = 1; index < LIMITS.depth; index++) {
      const child = node(index); parent.children.push(child); parent = child;
    }
    for (let index = LIMITS.depth; index < LIMITS.nodes; index++) parent.children.push(node(index));
    const output = formatText(document, format, 4);
    expect(new TextEncoder().encode(output).byteLength).toBeLessThanOrEqual(LIMITS.textBytes);
    expect(content(parseText(output, format))).toEqual(content(document));
    // A single long Markdown delimiter must not make every shorter label overflow the input cap.
    const replaceComments = (node: FolderNode) => {
      node.children.forEach(child => { child.comment = 'note'; replaceComments(child); });
    };
    replaceComments(document.root);
    const mixed = formatText(document, format, 4);
    expect(new TextEncoder().encode(mixed).byteLength).toBeLessThanOrEqual(LIMITS.textBytes);
    expect(content(parseText(mixed, format))).toEqual(content(document));
  });
});
