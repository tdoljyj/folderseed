import { describe, expect, it } from 'vitest';
import {
  addFolder, createDocument, DirectoryError, flatten, formatIndented, formatTree,
  LIMITS, moveFolder, parseIndented, parseJSON, removeFolder, renameFolder,
  serializeJSON, validateDocument, validateName,
} from '../src/core';

const paths = (doc: ReturnType<typeof createDocument>) => flatten(doc).map(item => item.path);
function expectCode(run: () => unknown, code: string, line?: number) {
  try { run(); throw new Error('Expected DirectoryError'); } catch (error) {
    expect(error).toBeInstanceOf(DirectoryError);
    expect((error as DirectoryError).code).toBe(code);
    if (line !== undefined) expect((error as DirectoryError).line).toBe(line);
  }
}

describe('plain text parsing and indentation regressions', () => {
  it.each([2, 4, 'tabs'] as const)('preserves hierarchy with %s indentation', indent => {
    const unit = indent === 'tabs' ? '\t' : ' '.repeat(indent);
    const text = `Project\n${unit}Assets\n${unit}${unit}Originals\n${unit}Output`;
    const doc = parseIndented(text);
    expect(paths(doc)).toEqual(['Project', 'Project/Assets', 'Project/Assets/Originals', 'Project/Output']);
    expect(formatIndented(doc, indent)).toBe(text);
    expect(paths(parseIndented(formatIndented(doc, indent), indent))).toEqual(paths(doc));
  });
  it('supports BOM, CRLF and empty lines without changing error line numbers', () => {
    const doc = parseIndented('\uFEFFroot\r\n\r\n    child\r\n');
    expect(paths(doc)).toEqual(['root', 'root/child']);
    expectCode(() => parseIndented('root\n\n  child\n  CHILD'), 'DUPLICATE_NAME', 4);
  });
  it('accepts an optional trailing folder marker but not paths', () => {
    expect(paths(parseIndented('root/\n  child/'))).toEqual(['root', 'root/child']);
    expectCode(() => parseIndented('root\n  ../evil'), 'UNSAFE_NAME', 2);
    expectCode(() => parseIndented('root\n  bad//'), 'UNSAFE_NAME', 2);
  });
  it('never silently flattens invalid whitespace', () => {
    expectCode(() => parseIndented('root\n    child\n  sibling'), 'INVALID_INDENT', 3);
    expectCode(() => parseIndented('root\n\tchild\n  sibling'), 'MIXED_INDENT', 3);
    expectCode(() => parseIndented('root\n \tchild'), 'MIXED_INDENT', 2);
    expectCode(() => parseIndented('root\n   child'), 'INVALID_INDENT', 2);
    expectCode(() => parseIndented('root\n        child'), 'INVALID_INDENT', 2);
    expectCode(() => parseIndented('root\n\t\tchild'), 'INDENT_JUMP', 2);
    expectCode(() => parseIndented('root\n  child\n      jumped'), 'INDENT_JUMP', 3);
    expectCode(() => parseIndented('root\n    child', 2), 'INDENT_JUMP', 2);
    expectCode(() => parseIndented('root\n  child', 4), 'INVALID_INDENT', 2);
    expectCode(() => parseIndented(' root'), 'INVALID_INDENT', 1);
    expectCode(() => parseIndented('root\nother'), 'MULTIPLE_ROOTS', 2);
    expectCode(() => parseIndented(' \n\t'), 'EMPTY_TEXT');
  });
  it('retains directory names that begin with box-drawing characters in indented mode', () => {
    const doc = parseIndented('root\n  ├── notes');
    expect(doc.root.children[0].name).toBe('├── notes');
  });
});

describe('tree and Markdown round-trips', () => {
  const input = 'Project\n  Assets\n    Originals\n    Selected\n      Favorites\n  Output';
  it('exports a conventional Unicode tree and parses it losslessly', () => {
    const doc = parseIndented(input);
    expect(formatTree(doc)).toBe('Project\n├── Assets\n│   ├── Originals\n│   └── Selected\n│       └── Favorites\n└── Output');
    expect(paths(parseIndented(formatTree(doc)))).toEqual(paths(doc));
  });
  it('parses a single fenced Markdown block, preserving original source line numbers', () => {
    const doc = parseIndented(input);
    expect(paths(parseIndented(`# Directory\n\n\`\`\`text\n${formatTree(doc)}\n\`\`\`\n`))).toEqual(paths(doc));
    expectCode(() => parseIndented('# Heading\n```text\nroot\n  ../bad\n```'), 'UNSAFE_NAME', 4);
    expectCode(() => parseIndented('```text\nroot'), 'MARKDOWN_FENCE', 1);
    expectCode(() => parseIndented('```text\nroot\n~~~'), 'MARKDOWN_FENCE', 3);
  });
  it('rejects malformed tree indentation instead of changing its meaning', () => {
    expectCode(() => parseIndented('root\n├── child\n│  └── bad'), 'TREE_FORMAT', 3);
    expectCode(() => parseIndented('root\n├── child\n│       └── skipped'), 'INDENT_JUMP', 3);
  });
  it('preserves safe fence-like folder names with suitably long Markdown fences', () => {
    const doc = parseIndented('```\n  ~~~\n    ```text');
    expect(paths(doc)).toEqual(['```', '```/~~~', '```/~~~/```text']);
    expect(paths(parseIndented(formatTree(doc)))).toEqual(paths(doc));
    expect(paths(parseIndented(`\`\`\`\`text\n${formatTree(doc)}\n\`\`\`\``))).toEqual(paths(doc));
    expect(parseIndented('```').root.name).toBe('```');
  });
});

describe('portable safe names and document boundaries', () => {
  it.each(['', '.', '..', '../bad', 'a/b', 'a\\b', 'C:drive', 'hello?', 'bad*', 'a|b', '<x>', '"quoted"', ' leading', 'trailing ', 'trailing.', 'a\nb', 'a\u0000b', 'CON', 'con.txt', 'NUL', 'LPT1', 'COM3.log', 'COM¹', 'a\u202eb', 'a\ud800', 'a\uffff', 'a\ufdd0'])('rejects unsafe name %j', name => {
    expect(() => validateName(name)).toThrow(DirectoryError);
  });
  it.each(['My project', '.config', 'photos 2026', 'not-a-file.txt', 'Résumé', '📁 Work', 'COMPUTER'])('accepts safe folder name %j', name => {
    expect(validateName(name)).toBe(name);
  });
  it('rejects sibling duplicates case-insensitively and after NFC normalization', () => {
    expectCode(() => parseIndented('root\n  Photos\n  photos'), 'DUPLICATE_NAME', 3);
    expectCode(() => parseIndented('root\n  café\n  cafe\u0301'), 'DUPLICATE_NAME', 3);
  });
  it('allows repeated names in different parents', () => {
    expect(paths(parseIndented('root\n  a\n    images\n  b\n    images'))).toHaveLength(5);
  });
  it('enforces folder, depth, input and name limits', () => {
    expectCode(() => parseIndented(`root\n${Array.from({ length: LIMITS.nodes }, (_, i) => `  child-${i}`).join('\n')}`), 'TOO_MANY_FOLDERS');
    expectCode(() => parseIndented(Array.from({ length: LIMITS.depth + 2 }, (_, i) => `${'  '.repeat(i)}level-${i}`).join('\n')), 'TOO_DEEP');
    expectCode(() => parseIndented('x'.repeat(LIMITS.textBytes + 1)), 'TEXT_TOO_LARGE');
    expectCode(() => createDocument('x'.repeat(LIMITS.nameLength + 1)), 'NAME_TOO_LONG');
    expectCode(() => createDocument('📁'.repeat(64)), 'NAME_TOO_LONG');
    expect(validateName('📁'.repeat(63))).toHaveLength(126);
  });
  it('validates strict version and shape, IDs, cycles and duplicate IDs', () => {
    expectCode(() => validateDocument({ version: 2, root: {} }), 'UNSUPPORTED_VERSION');
    expectCode(() => validateDocument([]), 'INVALID_DOCUMENT');
    expectCode(() => validateDocument({ version: 1, root: null }), 'INVALID_NODE');
    expectCode(() => validateDocument({ version: 1, root: { id: 'x/y', name: 'root', children: [] } }), 'INVALID_ID');
    expectCode(() => validateDocument({ version: 1, root: { id: 'a', name: 'root', children: {} } }), 'INVALID_CHILDREN');
    const doc = createDocument('root');
    doc.root.children.push({ id: doc.root.id, name: 'child', children: [] });
    expectCode(() => validateDocument(doc), 'DUPLICATE_ID');
    doc.root.children = [doc.root];
    expectCode(() => validateDocument(doc), 'CYCLE');
  });
  it('returns a clean clone and strips unknown properties', () => {
    const original = createDocument('root');
    const clean = validateDocument({ ...original, extra: 'ignored' });
    expect(clean).toEqual(original);
    expect(clean).not.toBe(original);
    expect(clean.root).not.toBe(original.root);
    expect('extra' in clean).toBe(false);
  });
});

describe('immutable folder operations', () => {
  it('adds, renames and removes while preserving the input', () => {
    const initial = createDocument('root');
    const added = addFolder(initial, initial.root.id, 'child');
    expect(initial.root.children).toHaveLength(0);
    const child = added.root.children[0];
    const renamed = renameFolder(added, child.id, 'renamed');
    expect(child.name).toBe('child');
    expect(paths(renamed)).toEqual(['root', 'root/renamed']);
    expect(removeFolder(renamed, child.id)).toEqual(initial);
    expectCode(() => removeFolder(initial, initial.root.id), 'ROOT_OPERATION');
    expectCode(() => addFolder(initial, 'missing', 'child'), 'NOT_FOUND');
  });
  it('rejects duplicate additions and renames atomically', () => {
    const doc = parseIndented('root\n  a\n  b');
    const before = serializeJSON(doc);
    expectCode(() => addFolder(doc, doc.root.id, 'A'), 'DUPLICATE_NAME');
    expectCode(() => renameFolder(doc, doc.root.children[1].id, 'A'), 'DUPLICATE_NAME');
    expect(serializeJSON(doc)).toBe(before);
  });
  it('moves across parents and reorders siblings by their final index', () => {
    const doc = parseIndented('root\n  a\n    nested\n  b\n  c');
    const [a, b, c] = doc.root.children;
    const moved = moveFolder(doc, a.children[0].id, b.id);
    expect(paths(moved)).toEqual(['root', 'root/a', 'root/b', 'root/b/nested', 'root/c']);
    const reordered = moveFolder(doc, a.id, doc.root.id, 2);
    expect(reordered.root.children.map(node => node.id)).toEqual([b.id, c.id, a.id]);
    expect(paths(doc)).toEqual(['root', 'root/a', 'root/a/nested', 'root/b', 'root/c']);
  });
  it('rejects cycles, root moves, invalid indexes and sibling collisions atomically', () => {
    const doc = parseIndented('root\n  a\n    nested\n  b\n    nested');
    const [a, b] = doc.root.children;
    const before = serializeJSON(doc);
    expectCode(() => moveFolder(doc, a.id, a.id), 'CYCLE');
    expectCode(() => moveFolder(doc, a.id, a.children[0].id), 'CYCLE');
    expectCode(() => moveFolder(doc, doc.root.id, a.id), 'ROOT_OPERATION');
    expectCode(() => moveFolder(doc, a.id, b.id, -1), 'INDEX_RANGE');
    expectCode(() => moveFolder(doc, a.id, b.id, 1.5), 'INDEX_RANGE');
    expectCode(() => moveFolder(doc, a.id, b.id, 2), 'INDEX_RANGE');
    expectCode(() => moveFolder(doc, a.children[0].id, b.id), 'DUPLICATE_NAME');
    expect(serializeJSON(doc)).toBe(before);
  });
  it('enforces maximum depth when moving a subtree', () => {
    const doc = parseIndented(`root\n  branch\n    leaf\n${Array.from({ length: LIMITS.depth }, (_, i) => `${'  '.repeat(i + 1)}level-${i}`).join('\n')}`);
    const last = flatten(doc).at(-1)!;
    expectCode(() => moveFolder(doc, doc.root.children[0].id, last.node.id), 'TOO_DEEP');
  });
});

describe('versioned JSON', () => {
  it('round-trips a maximum-size, maximum-depth project within the 1 MB input budget', () => {
    const longName = '\u754c'.repeat(80);
    const doc = createDocument(longName);
    let parent = doc.root;
    for (let depth = 1; depth < LIMITS.depth; depth++) {
      const child = { id: `level-${depth}-${'x'.repeat(80)}`, name: `${longName}-${depth}`, children: [] as typeof doc.root.children };
      parent.children.push(child);
      parent = child;
    }
    for (let index = 0; index < LIMITS.nodes - LIMITS.depth; index++) {
      parent.children.push({ id: `leaf-${index}-${'x'.repeat(80)}`, name: `${longName}-${index}`, children: [] });
    }
    expect(flatten(doc)).toHaveLength(LIMITS.nodes);
    const json = serializeJSON(doc);
    expect(new TextEncoder().encode(json).byteLength).toBeGreaterThan(200_000);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThan(LIMITS.textBytes);
    expect(parseJSON(json)).toEqual(doc);
    const text = formatIndented(doc, 4);
    expect(formatIndented(parseIndented(text), 4)).toBe(text);
    const tree = formatTree(doc);
    expect(formatTree(parseIndented(tree))).toBe(tree);
  });
  it('round-trips names, IDs, ordering and hierarchy exactly', () => {
    const doc = parseIndented('root\n  a\n    nested\n  b');
    expect(parseJSON(serializeJSON(doc))).toEqual(doc);
  });
  it('rejects invalid JSON and unsafe imported names', () => {
    expectCode(() => parseJSON('{bad'), 'INVALID_JSON');
    const doc = createDocument('root');
    doc.root.name = '../../escape';
    expectCode(() => parseJSON(JSON.stringify(doc)), 'UNSAFE_NAME');
  });
  it('round-trips deterministic generated trees without losing nesting or ordering', () => {
    let state = 20261021;
    const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let sample = 0; sample < 40; sample++) {
      const root = { id: 'root', name: ['root', '```', '~~~', '📁 Project', '├── Docs'][sample % 5], children: [] as ReturnType<typeof createDocument>['root'][] };
      const nodes = [{ node: root, depth: 0 }];
      for (let i = 0; i < 40; i++) {
        let parent = nodes[Math.floor(random() * nodes.length)];
        if (parent.depth >= 8) parent = nodes[0];
        const node = { id: `id-${i}`, name: `${['Résumé', '📁', '├──', '```', 'normal'][i % 5]}-${i}`, children: [] as ReturnType<typeof createDocument>['root'][] };
        parent.node.children.push(node);
        nodes.push({ node, depth: parent.depth + 1 });
      }
      const doc = { version: 1 as const, root };
      for (const indent of [2, 4, 'tabs'] as const) expect(formatIndented(parseIndented(formatIndented(doc, indent)))).toBe(formatIndented(doc));
      expect(formatTree(parseIndented(formatTree(doc)))).toBe(formatTree(doc));
      expect(parseJSON(serializeJSON(doc))).toEqual(doc);
    }
  });
});
