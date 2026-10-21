import { describe, expect, it } from 'vitest';
import {
  addFolder, createDocument, DirectoryError, flatten, formatIndented, formatTree,
  LIMITS, moveFolder, parseIndented, parseJSON, removeFolder, renameFolder,
  serializeJSON, validateDocument, validateName, detectTextFormat, formatASCII,
  formatMarkdown, formatText, parseText, type TextFormat,
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

describe('explicit text formats and conservative syntax detection', () => {
  const formats = ['plain', 'markdown', 'ascii', 'unicode'] as const;
  const fixture = () => parseIndented('Project\n  Assets\n    Originals\n    Selected\n      Favorites\n  Output');

  it.each(formats)('round-trips explicit %s text', format => {
    const doc = fixture();
    const text = formatText(doc, format);
    expect(paths(parseText(text, format))).toEqual(paths(doc));
    expect(paths(parseText(text))).toEqual(paths(doc));
    expect(detectTextFormat(text)).toBe(format);
  });

  it('keeps the legacy entry points and canonical output unchanged', () => {
    const doc = fixture();
    expect(formatText(doc)).toBe(formatIndented(doc));
    expect(formatText(doc, 'unicode')).toBe(formatTree(doc));
    expect(formatText(doc, 'ascii')).toBe(formatASCII(doc));
    expect(formatText(doc, 'markdown')).toBe(formatMarkdown(doc));
    expect(parseText('Root').root.name).toBe('Root');
  });

  it.each(['- Notes', '+ Ideas', '`-- Drafts', '├── Literal', '```', '```text', '# Heading', '1. Topic'])('explicit plain preserves literal name %j', name => {
    const input = `${name}\n  - Child\n    ├── Literal branch\n  + Another`;
    const doc = parseText(input, 'plain');
    expect(doc.root.name).toBe(name);
    expect(formatText(doc, 'plain')).toBe(input);
  });

  it('never strips fences, list markers or inline-code syntax in explicit plain mode', () => {
    expect(parseText('`Root`\n  `Child`', 'plain').root.name).toBe('`Root`');
    expectCode(() => parseText('```text\nRoot\n```', 'plain'), 'MULTIPLE_ROOTS', 2);
    expectCode(() => parseText('* Root\n  * Child', 'plain'), 'UNSAFE_NAME', 1);
    expectCode(() => parseText('Root\n|-- Child', 'plain'), 'MULTIPLE_ROOTS', 2);
  });

  it('treats auto detection as a hint and rejects malformed detected syntax', () => {
    expect(detectTextFormat('')).toBe('plain');
    expect(detectTextFormat('  \n\t')).toBe('plain');
    expect(detectTextFormat('- Notes')).toBe('markdown');
    expect(parseText('- Notes', 'plain').root.name).toBe('- Notes');
    expect(parseText('- Notes').root.name).toBe('Notes');
    expect(detectTextFormat('Root\n    `-- Skipped')).toBe('ascii');
    expectCode(() => parseText('Root\n    `-- Skipped'), 'INDENT_JUMP', 2);
    expectCode(() => parseText('Root\n  └── Malformed'), 'TREE_FORMAT', 2);
    expectCode(() => parseText('Root\n|--Child'), 'TREE_FORMAT', 2);
  });

  it('validates format and indentation arguments instead of silently guessing', () => {
    expectCode(() => parseText('Root', 'yaml' as TextFormat), 'INVALID_FORMAT');
    expectCode(() => formatText(fixture(), 'auto' as 'plain'), 'INVALID_FORMAT');
    expectCode(() => parseText('Root', 'plain', 3 as 2), 'INVALID_INDENT');
    expectCode(() => formatText(fixture(), 'unicode', 3 as 2), 'INVALID_INDENT');
  });
});

describe('Markdown nested lists', () => {
  it.each([2, 4, 'tabs'] as const)('preserves %s indentation and mixed unordered bullet styles', indent => {
    const unit = indent === 'tabs' ? '\t' : ' '.repeat(indent);
    const input = `- Root\n${unit}* Assets\n${unit}${unit}+ Originals\n${unit}- Output`;
    const doc = parseText(input, 'markdown', indent);
    expect(paths(doc)).toEqual(['Root', 'Root/Assets', 'Root/Assets/Originals', 'Root/Output']);
    expect(paths(parseText(input))).toEqual(paths(doc));
    expect(paths(parseText(formatMarkdown(doc, indent), 'markdown', indent))).toEqual(paths(doc));
  });

  it('exports one root and dynamically quoted, literal folder names', () => {
    const doc = parseText('Root\n  [draft](final)\n  a `b`\n  ```\n  + Ideas\n  1. Topic\n  # Heading', 'plain');
    const text = formatMarkdown(doc);
    expect(text).toBe('- `Root`\n  - `[draft](final)`\n  - `` a `b` ``\n  - ```` ``` ````\n  - `+ Ideas`\n  - `1. Topic`\n  - `# Heading`');
    expect(paths(parseText(text, 'markdown'))).toEqual(paths(doc));
  });

  it.each(['`', '``', '```text', '`leading', 'trailing`', '`both`', 'a `` b', 'a `b` c', '[links](literal)', '- item', '+ item', '1. item', 'A & B', 'name_with_underscores', 'a!b'])('round-trips punctuation name %j through a Markdown code span', name => {
    const doc = createDocument(name);
    expect(parseText(formatMarkdown(doc), 'markdown').root.name).toBe(name);
    expect(parseText(formatMarkdown(doc)).root.name).toBe(name);
  });

  it('accepts raw literal punctuation and standard Markdown punctuation escapes', () => {
    const doc = parseText('- Root\n  - \\`literal\n  - \\[brackets\\]\n  - [name](literal)\n  - 1. topic\n  - a \\+ b', 'markdown');
    expect(doc.root.children.map(node => node.name)).toEqual(['`literal', '[brackets]', '[name](literal)', '1. topic', 'a + b']);
    expectCode(() => parseText('- Root\n  - folder\\name', 'markdown'), 'UNSAFE_NAME', 2);
  });

  it('accepts folder markers and code-span padding without interpreting Markdown markup', () => {
    expect(paths(parseText('- Root/\n  - Child/', 'markdown'))).toEqual(['Root', 'Root/Child']);
    expect(parseText('- ` Root `', 'markdown').root.name).toBe('Root');
    expect(parseText('- `A &amp; B`', 'markdown').root.name).toBe('A &amp; B');
  });

  it.each(['-', '+', '*', '- ', '- `', '- `unfinished', '- ``unfinished`', '- `one` and `two`'])('rejects incomplete or ambiguous Markdown item %j', text => {
    expect(() => parseText(text, 'markdown')).toThrow(DirectoryError);
  });

  it('rejects multiple roots, ordered lists, continuations and mixed styles explicitly', () => {
    expectCode(() => parseText('- Root\n- Another', 'markdown'), 'MULTIPLE_ROOTS', 2);
    expectCode(() => parseText('1. Root\n  1. Child', 'markdown'), 'MARKDOWN_SYNTAX', 1);
    expectCode(() => parseText('- Root\n  Child without bullet', 'markdown'), 'MARKDOWN_SYNTAX', 2);
    expectCode(() => parseText('- Root\n  - Child\n    continuation', 'markdown'), 'MARKDOWN_SYNTAX', 3);
    expectCode(() => parseText('- Root\n  - Child\n      - Skipped', 'markdown'), 'INDENT_JUMP', 3);
    expectCode(() => parseText('- Root\n    - Child\n  - Other', 'markdown'), 'INVALID_INDENT', 3);
    expectCode(() => parseText('- Root\n\t- Child\n  - Other', 'markdown'), 'MIXED_INDENT', 3);
    expectCode(() => parseText('- Root\n \t- Child', 'markdown'), 'MIXED_INDENT', 2);
  });

  it('rejects unsafe names and normalized duplicates after decoding', () => {
    expectCode(() => parseText('- Root\n  - `../escape`', 'markdown'), 'UNSAFE_NAME', 2);
    expectCode(() => parseText('- Root\n  - \\.\\.\\/escape', 'markdown'), 'UNSAFE_NAME', 2);
    expectCode(() => parseText('- Root\n  - `NUL`', 'markdown'), 'RESERVED_NAME', 2);
    expectCode(() => parseText('- Root\n  - `[literal]`\n  - \\[literal\\]', 'markdown'), 'DUPLICATE_NAME', 3);
    expectCode(() => parseText('- Root\n  - `café`\n  - cafe\u0301', 'markdown'), 'DUPLICATE_NAME', 3);
    expectCode(() => parseText('- Root\n  - `   `', 'markdown'), 'INVALID_NAME', 2);
  });
});

describe('ASCII and Unicode tree grammars', () => {
  it('exports conventional ASCII tree branches and accepts +-- variants', () => {
    const doc = parseText('Root\n  Assets\n    Originals\n    Selected\n      Favorites\n  Output', 'plain');
    const text = 'Root\n|-- Assets\n|   |-- Originals\n|   `-- Selected\n|       `-- Favorites\n`-- Output';
    expect(formatASCII(doc)).toBe(text);
    expect(paths(parseText(text, 'ascii'))).toEqual(paths(doc));
    expect(paths(parseText(text.replaceAll('|-- ', '+-- ').replaceAll('`-- ', '+-- '), 'ascii'))).toEqual(paths(doc));
  });

  it.each(['ascii', 'unicode'] as const)('preserves literal punctuation in %s names', format => {
    const doc = parseText('- Root\n  +-- Literal\n    └── Name\n  ```\n  [data]', 'plain');
    const text = formatText(doc, format);
    expect(paths(parseText(text, format))).toEqual(paths(doc));
    expect(paths(parseText(text))).toEqual(paths(doc));
  });

  it.each(['Root\n|--', 'Root\n|-- ', 'Root\n|--Child', 'Root\n|-- Child\n|  `-- Bad', 'Root\n|-- Child\n\t`-- Bad', 'Root\n+--- Child'])('rejects partial or malformed ASCII tree %j', text => {
    expect(() => parseText(text, 'ascii')).toThrow(DirectoryError);
  });

  it('rejects skipped tree levels and mixed alphabets instead of flattening them', () => {
    expectCode(() => parseText('Root\n    `-- Child', 'ascii'), 'INDENT_JUMP', 2);
    expectCode(() => parseText('Root\n|-- Child\n|       `-- Skipped', 'ascii'), 'INDENT_JUMP', 3);
    expectCode(() => parseText('Root\n├── Child\n│       └── Skipped', 'unicode'), 'INDENT_JUMP', 3);
    expectCode(() => parseText('Root\n|-- Child\n└── Other', 'ascii'), 'TREE_FORMAT', 3);
    expectCode(() => parseText('Root\n├── Child\n`-- Other', 'unicode'), 'TREE_FORMAT', 3);
    expectCode(() => parseText('Root\n  Child', 'unicode'), 'TREE_FORMAT', 2);
    expectCode(() => parseText('Root\n  Child', 'ascii'), 'TREE_FORMAT', 2);
  });

  it.each(['ascii', 'unicode'] as const)('rejects unsafe and duplicate names in %s trees', format => {
    const branch = format === 'ascii' ? '|-- ' : '├── ';
    expectCode(() => parseText(`Root\n${branch}../escape`, format), 'UNSAFE_NAME', 2);
    expectCode(() => parseText(`Root\n${branch}NUL.txt`, format), 'RESERVED_NAME', 2);
    expectCode(() => parseText(`Root\n${branch}Images\n${branch}images`, format), 'DUPLICATE_NAME', 3);
  });
});

describe('Markdown fenced blocks and source locations', () => {
  it.each(['plain', 'ascii', 'unicode'] as const)('imports existing fenced %s exports through Markdown and Auto modes', format => {
    const doc = parseText('Root\n  Assets\n    Images\n  Output', 'plain');
    const input = `# Directory structure\n\n\`\`\`text\n${formatText(doc, format)}\n\`\`\`\nFooter`;
    expect(detectTextFormat(input)).toBe('markdown');
    expect(paths(parseText(input, 'markdown'))).toEqual(paths(doc));
    expect(paths(parseText(input))).toEqual(paths(doc));
  });

  it('treats punctuation in generic text fences as data, not Markdown list syntax', () => {
    expect(parseText('```text\n- Literal root\n```', 'markdown').root.name).toBe('- Literal root');
    expect(parseText('````text\n```\n````', 'markdown').root.name).toBe('```');
    expect(parseText('~~~text\nRoot\n  Child\n~~~', 'markdown').root.children[0].name).toBe('Child');
    expect(parseText('```plain\nRoot\n  └── Literal\n```', 'markdown').root.children[0].name).toBe('└── Literal');
    expect(parseText('```markdown\n- `Root`\n  - `Child`\n```', 'markdown').root.children[0].name).toBe('Child');
  });

  it('preserves source line numbers through BOM, CRLF, blanks and fences', () => {
    expectCode(() => parseText('\uFEFF# Heading\r\n\r\n```text\r\nRoot\r\n\r\n  ../escape\r\n```', 'markdown'), 'UNSAFE_NAME', 6);
    expectCode(() => parseText('\uFEFF- Root\r\n\r\n  - Child\r\n  - CHILD', 'markdown'), 'DUPLICATE_NAME', 4);
  });

  it('rejects incomplete, repeated, unsupported and explicit-mode-mismatched fences', () => {
    expectCode(() => parseText('```text\nRoot', 'markdown'), 'MARKDOWN_FENCE', 1);
    expectCode(() => parseText('```text\nRoot\n~~~', 'markdown'), 'MARKDOWN_FENCE', 1);
    expectCode(() => parseText('```text\nRoot\n```\n```text\nOther\n```', 'markdown'), 'MARKDOWN_FENCE', 3);
    expectCode(() => parseText('```javascript\nRoot\n```', 'markdown'), 'MARKDOWN_FENCE', 1);
    expectCode(() => parseText('```ascii\nRoot\n└── Child\n```', 'markdown'), 'TREE_FORMAT', 3);
    expectCode(() => parseText('```text\nRoot\n```', 'unicode'), 'TREE_FORMAT', 2);
    expectCode(() => parseText('```text\nRoot\n```', 'ascii'), 'TREE_FORMAT', 2);
  });
});

describe('format safety bounds and generated round-trips', () => {
  const formats = ['plain', 'markdown', 'ascii', 'unicode'] as const;
  it.each(formats)('enforces size, node and depth bounds in %s mode', format => {
    expectCode(() => parseText('x'.repeat(LIMITS.textBytes + 1), format), 'TEXT_TOO_LARGE');
    const name = (depth: number, index: number) => `${format === 'markdown' ? '- ' : ''}level-${index}`;
    const overNodes = Array.from({ length: LIMITS.nodes + 1 }, (_, index) => {
      if (format === 'ascii') return index ? `|-- folder-${index}` : 'Root';
      if (format === 'unicode') return index ? `├── folder-${index}` : 'Root';
      return `${index ? '  ' : ''}${name(index ? 1 : 0, index)}`;
    }).join('\n');
    expectCode(() => parseText(overNodes, format), 'TOO_MANY_FOLDERS', LIMITS.nodes + 1);
    const overDepth = Array.from({ length: LIMITS.depth + 2 }, (_, depth) => {
      if (format === 'ascii') return depth ? `${'    '.repeat(depth - 1)}\`-- level-${depth}` : 'Root';
      if (format === 'unicode') return depth ? `${'    '.repeat(depth - 1)}└── level-${depth}` : 'Root';
      return `${'  '.repeat(depth)}${name(depth, depth)}`;
    }).join('\n');
    expectCode(() => parseText(overDepth, format), 'TOO_DEEP', LIMITS.depth + 2);
    expectCode(() => parseText(' \n\t', format), 'EMPTY_TEXT');
  });

  it('bounds detection input and validates documents before every export', () => {
    expectCode(() => detectTextFormat('x'.repeat(LIMITS.textBytes + 1)), 'TEXT_TOO_LARGE');
    const unsafe = createDocument('Root');
    unsafe.root.name = '../escape';
    for (const format of formats) expectCode(() => formatText(unsafe, format), 'UNSAFE_NAME');
  });

  it('round-trips maximum allowed folder/depth limits through all explicit formats', () => {
    const doc = createDocument('`'.repeat(100));
    let parent = doc.root;
    for (let depth = 1; depth < LIMITS.depth; depth++) {
      const child = { id: `level-${depth}`, name: `Level ${depth}`, children: [] as typeof doc.root.children };
      parent.children.push(child);
      parent = child;
    }
    for (let index = 0; index < LIMITS.nodes - LIMITS.depth; index++) {
      parent.children.push({ id: `leaf-${index}`, name: `${'\u754c'.repeat(80)}-${index}`, children: [] });
    }
    for (const format of formats) {
      const text = formatText(doc, format, 4);
      expect(new TextEncoder().encode(text).byteLength).toBeLessThan(LIMITS.textBytes);
      expect(formatText(parseText(text, format, 4), format, 4)).toBe(text);
    }
  });

  it('round-trips deterministic generated punctuation-rich trees in every explicit format', () => {
    let state = 47312;
    const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const names = ['- literal', '+ literal', '`-- literal', '├── literal', '```', '[links](literal)', 'a `b` c', '# heading', '1. topic', 'Résumé', '📁'];
    for (let sample = 0; sample < 30; sample++) {
      const doc = createDocument(names[sample % names.length]);
      const nodes = [{ node: doc.root, depth: 0 }];
      for (let index = 0; index < 25; index++) {
        let parent = nodes[Math.floor(random() * nodes.length)];
        if (parent.depth >= 6) parent = nodes[0];
        const node = { id: `id-${index}`, name: `${names[index % names.length]}-${index}`, children: [] as typeof doc.root.children };
        parent.node.children.push(node);
        nodes.push({ node, depth: parent.depth + 1 });
      }
      for (const format of formats) {
        for (const indent of [2, 4, 'tabs'] as const) {
          const text = formatText(doc, format, indent);
          expect(formatText(parseText(text, format, indent), format, indent)).toBe(text);
        }
      }
      expect(paths(parseText(formatMarkdown(doc)))).toEqual(paths(doc));
    }
  });
});
