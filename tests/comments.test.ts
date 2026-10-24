import { describe, expect, it } from 'vitest';
import {
  addFolder, createDocument, DirectoryError, flatten, formatASCII, formatFolderLabel, formatIndented,
  formatMarkdown, formatText, formatTree, LIMITS, moveFolder, parseIndented, parseJSON, parseText,
  removeFolder, renameFolder, serializeJSON, setFolderComment, validateComment, validateDocument,
  type DirectoryDocument, type FolderNode,
} from '../src/core';
import { historyReducer } from '../src/ui/history';

function expectCode(run: () => unknown, code: string, line?: number): void {
  let error: unknown;
  try { run(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(DirectoryError);
  expect((error as DirectoryError).code).toBe(code);
  if (line !== undefined) expect((error as DirectoryError).line).toBe(line);
}
function shape(document: DirectoryDocument): unknown {
  return flatten(document).map(({ node, depth, path }) => ({ name: node.name, comment: node.comment, depth, path }));
}
function fixture(): DirectoryDocument {
  return parseText('Project // Root notes\n  Assets // Originals // keep source files\n    Photos // <HTML> & [brackets] `code`\n  Output //  Preserve surrounding spaces  ', 'plain');
}

describe('comment validation and model', () => {
  it.each(['', 'A note', ' // ', '  preserve spaces  ', 'Cafe\u0301', '中文 العربية हिन्दी', '<script>alert(1)</script>', '"quotes" & `ticks`', 'https://example.test/a/b'])('preserves literal comment %j without normalization', comment => {
    expect(validateComment(comment)).toBe(comment);
  });

  it.each([null, undefined, 2, true, {}, []])('rejects non-string comment %j', comment => {
    expectCode(() => validateComment(comment), 'INVALID_COMMENT');
  });

  it.each(['\n', '\r', '\t', '\0', '\x1f', '\x7f', '\x85', '\u2028', '\u2029', '\u202e', '\u2067', '\ud800', '\udfff', '\ufdd0', '\uffff', '\u{1fffe}'])('rejects unsafe comment codepoint %j', character => {
    expectCode(() => validateComment(`before${character}after`), 'UNSAFE_COMMENT');
  });

  it('counts Unicode codepoints rather than UTF-16 units for the 500-character cap', () => {
    expect(validateComment('😀'.repeat(500))).toBe('😀'.repeat(500));
    expectCode(() => validateComment('😀'.repeat(501)), 'COMMENT_TOO_LONG');
    expectCode(() => validateComment('a'.repeat(501)), 'COMMENT_TOO_LONG');
  });

  it('validates and clones comments while stripping unrelated unknown fields', () => {
    const document = fixture();
    const input = { ...document, unknown: true, root: { ...document.root, ignored: 'metadata' } };
    const clean = validateDocument(input);
    expect(clean).toEqual(document);
    expect(clean.root).not.toBe(input.root);
    expect(clean.root.children[0].comment).toBe('Originals // keep source files');
    expect('ignored' in clean.root).toBe(false);
    const empty = validateDocument({ ...document, root: { ...document.root, comment: '' } });
    expect(Object.hasOwn(empty.root, 'comment')).toBe(false);
    expectCode(() => validateDocument({ ...document, root: { ...document.root, comment: null } }), 'INVALID_COMMENT');
  });

  it('bounds total comment bytes while accepting the exact aggregate limit', () => {
    const document = createDocument('Root');
    let remaining = LIMITS.commentBytes;
    for (let index = 0; remaining; index++) {
      const bytes = Math.min(2_000, remaining);
      const comment = '😀'.repeat(Math.floor(bytes / 4)) + 'x'.repeat(bytes % 4);
      document.root.children.push({ id: `child-${index}`, name: `Child-${index}`, comment, children: [] });
      remaining -= bytes;
    }
    expect(validateDocument(document)).toEqual(document);
    document.root.comment = 'x';
    expectCode(() => validateDocument(document), 'COMMENTS_TOO_LARGE');
  });

  it('keeps comments out of names, paths, sibling uniqueness, and folder counts', () => {
    const document = fixture();
    expect(flatten(document).map(item => item.path)).toEqual(['Project', 'Project/Assets', 'Project/Assets/Photos', 'Project/Output']);
    expectCode(() => parseText('Root\n  Same // one\n  same // another', 'plain'), 'DUPLICATE_NAME', 3);
    expectCode(() => createDocument('Root // not a name'), 'UNSAFE_NAME');
  });
});

describe('immutable comment edits and existing folder operations', () => {
  it('sets, changes, and removes root and child comments without touching names or IDs', () => {
    const document = fixture();
    const before = serializeJSON(document);
    const child = document.root.children[0];
    const changed = setFolderComment(document, child.id, 'Updated');
    expect(changed.root.children[0].comment).toBe('Updated');
    expect(changed.root.children[0].id).toBe(child.id);
    expect(changed.root.children[0].children).toEqual(child.children);
    expect(serializeJSON(document)).toBe(before);
    const removed = setFolderComment(changed, child.id, '');
    expect(Object.hasOwn(removed.root.children[0], 'comment')).toBe(false);
    expect(setFolderComment(removed, removed.root.id, 'New root note').root.comment).toBe('New root note');
  });

  it('rejects invalid comments and missing IDs atomically, including frozen input', () => {
    const document = fixture();
    const before = serializeJSON(document);
    const freeze = (node: FolderNode): void => {
      node.children.forEach(freeze); Object.freeze(node.children); Object.freeze(node);
    };
    freeze(document.root); Object.freeze(document);
    expectCode(() => setFolderComment(document, 'missing', 'Note'), 'NOT_FOUND');
    expectCode(() => setFolderComment(document, document.root.id, 'Two\nlines'), 'UNSAFE_COMMENT');
    expect(setFolderComment(document, document.root.id, 'Frozen safely').root.comment).toBe('Frozen safely');
    expect(serializeJSON(document)).toBe(before);
  });

  it('preserves comments when adding, renaming, moving, and removing other folders', () => {
    const document = fixture();
    const assets = document.root.children[0];
    const output = document.root.children[1];
    const added = addFolder(document, assets.id, 'Extra');
    expect(added.root.children[0].comment).toBe(assets.comment);
    expect(added.root.children[0].children.at(-1)!.comment).toBeUndefined();
    const renamed = renameFolder(document, assets.id, 'Sources');
    expect(renamed.root.children[0].comment).toBe(assets.comment);
    const moved = moveFolder(renamed, assets.id, output.id);
    expect(moved.root.children[0].children[0].comment).toBe(assets.comment);
    expect(moved.root.children[0].children[0].children[0].comment).toBe(assets.children[0].comment);
    const removed = removeFolder(document, output.id);
    expect(removed.root.children[0]).toEqual(assets);
  });

  it('makes a comment-only edit one undoable document change', () => {
    const document = fixture();
    const next = setFolderComment(document, document.root.id, 'Changed only the note');
    expect(formatIndented(next)).not.toBe(formatIndented(document));
    const committed = historyReducer({ past: [], present: document, future: [] }, { type: 'commit', document: next });
    const undone = historyReducer(committed, { type: 'undo' });
    expect(undone.present).toBe(document);
    expect(historyReducer(undone, { type: 'redo' }).present).toBe(next);
  });
});

describe('annotated text roundtrips', () => {
  it('splits the first exact delimiter and preserves the complete literal remainder', () => {
    const document = parseText('Root // first // second // third  \n  Child/ // https://example.test/a//b', 'plain');
    expect(document.root.comment).toBe('first // second // third  ');
    expect(document.root.children[0].name).toBe('Child');
    expect(document.root.children[0].comment).toBe('https://example.test/a//b');
    expect(formatFolderLabel(document.root)).toBe('Root // first // second // third  ');
    expect(parseText('Root // ', 'plain').root.comment).toBeUndefined();
    for (const name of ['Root//comment', 'Root //comment', 'Root// comment', 'Root //']) {
      expectCode(() => parseText(name, 'plain'), 'UNSAFE_NAME');
    }
  });

  it.each(['plain', 'ascii', 'unicode', 'markdown'] as const)('roundtrips all comments through explicit and automatic %s text', format => {
    const document = fixture();
    const output = formatText(document, format, 4);
    expect(shape(parseText(output, format))).toEqual(shape(document));
    expect(shape(parseText(output, 'auto'))).toEqual(shape(document));
  });

  it.each([2, 4, 'tabs'] as const)('preserves comments with %s indentation and both legacy/plain parsers', indent => {
    const document = fixture();
    const output = formatIndented(document, indent);
    expect(shape(parseText(output, 'plain', indent))).toEqual(shape(document));
    expect(shape(parseIndented(output, indent))).toEqual(shape(document));
    expect(shape(parseIndented(formatTree(document)))).toEqual(shape(document));
  });

  it.each(['text', 'plain', 'ascii', 'unicode', 'markdown'] as const)('roundtrips fenced %s payloads', language => {
    const document = fixture();
    const format = language === 'text' ? 'unicode' : language;
    const body = formatText(document, format);
    const output = `# Notes\n\n\`\`\`\`\`\`${language}\n${body}\n\`\`\`\`\`\`\n`;
    expect(shape(parseText(output, 'markdown'))).toEqual(shape(document));
  });

  it.each(['`', '```', ' // ', '`a` and ``b``', '[link](https://example.test) <img> & *bold*', '  padded  ', 'Cafe\u0301'])('quotes a whole Markdown label containing comment %j', comment => {
    const root = createDocument('`Root`');
    const document = setFolderComment(root, root.root.id, comment);
    const output = formatMarkdown(document);
    expect(shape(parseText(output, 'markdown'))).toEqual(shape(document));
    expect(shape(parseText(output, 'auto'))).toEqual(shape(document));
  });

  it('keeps comments attached to renamed and moved lines rather than regenerating commentless models', () => {
    const document = fixture();
    const edited = 'Project // Root notes\n  Output //  Preserve surrounding spaces  \n    Renamed assets // Originals // keep source files\n      Photos // <HTML> & [brackets] `code`';
    const parsed = parseText(edited, 'plain');
    expect(parsed.root.children[0].children[0].comment).toBe(document.root.children[0].comment);
    expect(parsed.root.children[0].children[0].children[0].comment).toBe(document.root.children[0].children[0].comment);
    expect(flatten(parsed).at(-1)!.path).toBe('Project/Output/Renamed assets/Photos');
  });

  it('retains line numbers for comment errors and does not loosen folder-name checks', () => {
    expectCode(() => parseText('Root\n  Child // invalid\tcomment', 'plain'), 'UNSAFE_COMMENT', 2);
    expectCode(() => parseIndented('Root\n    Child // invalid\u202ecomment'), 'UNSAFE_COMMENT', 2);
    expectCode(() => parseText('- `Root`\n  - `Child // '+ 'x'.repeat(501) +'`', 'markdown'), 'COMMENT_TOO_LONG', 2);
    expectCode(() => parseText('Root\n  ../escape // harmless note', 'plain'), 'UNSAFE_NAME', 2);
    expectCode(() => parseText('Root\n  CON // harmless note', 'plain'), 'RESERVED_NAME', 2);
  });

  it('allows explicit removal of a comment suffix without changing the folder name', () => {
    const document = fixture();
    const edited = formatIndented(document).replace(' // Root notes', '');
    const parsed = parseText(edited, 'plain');
    expect(parsed.root.name).toBe(document.root.name);
    expect(parsed.root.comment).toBeUndefined();
    expect(parsed.root.children[0].comment).toBe(document.root.children[0].comment);
  });
});

describe('comment-aware JSON versions and size budgets', () => {
  it('emits v2 only for comments and reads both wire versions as internal v1', () => {
    const old = createDocument('Legacy');
    expect(JSON.parse(serializeJSON(old)).version).toBe(1);
    expect(parseJSON(serializeJSON(old))).toEqual(old);
    const annotated = fixture();
    expect(JSON.parse(serializeJSON(annotated)).version).toBe(2);
    expect(parseJSON(serializeJSON(annotated))).toEqual(annotated);
    expect(validateDocument({ version: 2, root: old.root })).toEqual(old);
    expect(validateDocument({ version: 1, root: annotated.root })).toEqual(annotated);
    const withNote = setFolderComment(old, old.root.id, 'A note');
    const removed = setFolderComment(withNote, old.root.id, '');
    expect(JSON.parse(serializeJSON(removed)).version).toBe(1);
  });

  it.each([0, 3, 99, '2', null])('rejects unsupported wire version %j', version => {
    expectCode(() => validateDocument({ version, root: createDocument().root }), 'UNSUPPORTED_VERSION');
  });

  it('roundtrips a deeply indented maximum-node project with maximum ASCII comments', () => {
    const document = createDocument('Root');
    let parent = document.root;
    const node = (index: number): FolderNode => ({ id: `id-${index}-${'x'.repeat(90)}`, name: `${'界'.repeat(80)}-${index}`, comment: '"'.repeat(500), children: [] });
    for (let index = 1; index < LIMITS.depth; index++) { const child = node(index); parent.children.push(child); parent = child; }
    for (let index = LIMITS.depth; index < LIMITS.nodes; index++) parent.children.push(node(index));
    expect(new TextEncoder().encode(JSON.stringify({ version: 2, root: document.root }, null, 2)).byteLength).toBeGreaterThan(LIMITS.textBytes);
    const json = serializeJSON(document);
    expect(json.includes('\n')).toBe(false);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(LIMITS.textBytes);
    expect(parseJSON(json)).toEqual(document);
    for (const format of ['plain', 'ascii', 'unicode', 'markdown'] as const) {
      const output = formatText(document, format, 4);
      expect(new TextEncoder().encode(output).byteLength).toBeLessThanOrEqual(LIMITS.textBytes);
      expect(shape(parseText(output, format))).toEqual(shape(document));
    }
  }, 20_000);

  it('roundtrips deterministic punctuation-heavy comments across generated trees', () => {
    const comments = ['ordinary', ' // delimiter // inside', '`', '``` longer `` runs', '<script>&"', '  whitespace  ', 'Cafe\u0301', '日本語 العربية 📁'];
    for (let sample = 0; sample < comments.length; sample++) {
      const document = createDocument(`Project-${sample}`);
      document.root.comment = comments[sample];
      for (let index = 0; index < 16; index++) {
        document.root.children.push({ id: `node-${index}`, name: `${index % 2 ? '```' : '[Folder]'}-${index}`, comment: comments[(sample + index) % comments.length], children: [] });
      }
      for (const format of ['plain', 'ascii', 'unicode', 'markdown'] as const) {
        expect(shape(parseText(formatText(document, format), format))).toEqual(shape(document));
      }
      expect(parseJSON(serializeJSON(document))).toEqual(document);
    }
  });
});
