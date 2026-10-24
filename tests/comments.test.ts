import { describe, expect, it } from 'vitest';
import {
  addFolder, createDocument, DirectoryError, documentContentEqual, flatten, formatASCII, formatFolderLabel, formatIndented,
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

  it.each([0, 4, 99, '2', null])('rejects unsupported wire version %j', version => {
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

function boundFixture(): DirectoryDocument {
  const document = fixture();
  document.root.commentBinding = { source: 'folderseed-template', key: 'creative.root.v1' };
  document.root.children[0].commentBinding = { source: 'folderseed-template', key: 'creative.assets.v1' };
  document.root.children[0].children[0].commentBinding = { source: 'folderseed-template', key: 'future.unknown.v99' };
  return validateDocument(document);
}

describe('explicit template comment provenance', () => {
  it('clones known and unknown bindings without inferring, translating, or mutating fallback text', () => {
    const document = boundFixture();
    const original = JSON.stringify(document);
    const input = { ...document, root: { ...document.root, commentBinding: { ...document.root.commentBinding, extra: 'discard' } } };
    const clean = validateDocument(input);
    expect(clean).toEqual(document);
    expect(clean.root.commentBinding).not.toBe(input.root.commentBinding);
    expect(clean.root.children[0].children[0].commentBinding?.key).toBe('future.unknown.v99');
    expect(clean.root.children[0].children[0].comment).toBe('<HTML> & [brackets] `code`');
    expect(JSON.stringify(document)).toBe(original);
  });

  it.each(['a', 'creative.references.v1', 'Future_2.Item-name', 'A'.repeat(100), 'constructor', '__proto__'.slice(2)])('accepts the bounded ASCII key %j as opaque data', key => {
    const document = fixture();
    document.root.commentBinding = { source: 'folderseed-template', key };
    expect(validateDocument(document).root.commentBinding?.key).toBe(key);
  });

  it.each(['', 'a'.repeat(101), '2first', '-first', '.first', '_first', 'a b', 'a/b', 'a:b', 'a\n', 'a\0', '描述', 'a😀'])('rejects malformed binding key %j', key => {
    const document = fixture();
    expectCode(() => validateDocument({ ...document, root: { ...document.root, commentBinding: { source: 'folderseed-template', key } } }), 'INVALID_COMMENT_BINDING');
  });

  it.each([null, [], 'creative.root.v1', 1, {}, { key: 'creative.root.v1' }, { source: 'user', key: 'creative.root.v1' }, { source: 'folderseed-template', key: 1 }])('rejects malformed source/binding %j', commentBinding => {
    const document = fixture();
    expectCode(() => validateDocument({ ...document, root: { ...document.root, commentBinding } }), 'INVALID_COMMENT_BINDING');
  });

  it('requires a nonempty valid fallback for every binding', () => {
    const document = boundFixture();
    expectCode(() => validateDocument({ ...document, root: { ...document.root, comment: '' } }), 'INVALID_COMMENT_BINDING');
    expectCode(() => validateDocument({ ...document, root: { ...document.root, comment: undefined } }), 'INVALID_COMMENT_BINDING');
    expectCode(() => validateDocument({ ...document, root: { ...document.root, comment: 'bad\nvalue' } }), 'UNSAFE_COMMENT');
  });

  it('preserves bindings during add, rename, move, and deletion of a different folder', () => {
    const document = boundFixture();
    const assets = document.root.children[0];
    const output = document.root.children[1];
    const added = addFolder(document, assets.id, 'New child');
    expect(added.root.children[0].commentBinding).toEqual(assets.commentBinding);
    expect(added.root.children[0].children.at(-1)!.commentBinding).toBeUndefined();
    const renamed = renameFolder(document, assets.id, 'Renamed');
    expect(renamed.root.children[0].commentBinding).toEqual(assets.commentBinding);
    const moved = moveFolder(renamed, assets.id, output.id);
    expect(moved.root.children[0].children[0].commentBinding).toEqual(assets.commentBinding);
    expect(moved.root.children[0].children[0].children[0].commentBinding).toEqual(assets.children[0].commentBinding);
    expect(removeFolder(document, output.id).root.children[0]).toEqual(assets);
  });

  it.each(['Root notes', 'A custom note', ''])('detaches provenance when explicitly saving comment %j, including identical text or clearing', comment => {
    const document = boundFixture();
    const before = serializeJSON(document);
    const updated = setFolderComment(document, document.root.id, comment);
    expect(updated.root.commentBinding).toBeUndefined();
    expect(updated.root.comment).toBe(comment || undefined);
    expect(updated.root.id).toBe(document.root.id);
    expect(updated.root.children).toEqual(document.root.children);
    expect(serializeJSON(document)).toBe(before);
    expect(documentContentEqual(document, updated)).toBe(false);
  });

  it('does not detach bindings for rejected edits, even on deeply frozen input', () => {
    const document = boundFixture();
    const before = serializeJSON(document);
    const freeze = (node: FolderNode): void => {
      node.children.forEach(freeze);
      if (node.commentBinding) Object.freeze(node.commentBinding);
      Object.freeze(node.children); Object.freeze(node);
    };
    freeze(document.root); Object.freeze(document);
    expectCode(() => setFolderComment(document, document.root.id, 'invalid\ncomment'), 'UNSAFE_COMMENT');
    expectCode(() => setFolderComment(document, 'missing', 'note'), 'NOT_FOUND');
    expect(serializeJSON(document)).toBe(before);
    expect(setFolderComment(document, document.root.id, document.root.comment!).root.commentBinding).toBeUndefined();
  });

  it('restores provenance through undo after a same-visible-text save', () => {
    const document = boundFixture();
    const updated = setFolderComment(document, document.root.id, document.root.comment!);
    expect(formatIndented(document)).toBe(formatIndented(updated));
    expect(documentContentEqual(document, updated)).toBe(false);
    const committed = historyReducer({ past: [], present: document, future: [] }, { type: 'commit', document: updated });
    const undone = historyReducer(committed, { type: 'undo' });
    expect(undone.present.root.commentBinding).toEqual(document.root.commentBinding);
    expect(historyReducer(undone, { type: 'redo' }).present.root.commentBinding).toBeUndefined();
  });
});

describe('binding-aware semantic equality', () => {
  it('ignores regenerated IDs while preserving all semantic fields and child order', () => {
    const document = boundFixture();
    const regenerated = validateDocument(document);
    let counter = 0;
    const replaceIds = (node: FolderNode): void => { node.id = `regenerated-${counter++}`; node.children.forEach(replaceIds); };
    replaceIds(regenerated.root);
    expect(documentContentEqual(document, regenerated)).toBe(true);
    expect(documentContentEqual(document, validateDocument({ version: 3, root: document.root }))).toBe(true);
  });

  it('detects changed names, literal fallback text, binding keys, or order', () => {
    const document = boundFixture();
    const renamed = renameFolder(document, document.root.id, 'Different');
    expect(documentContentEqual(document, renamed)).toBe(false);
    const fallback = validateDocument(document);
    fallback.root.comment = 'Different fallback';
    expect(documentContentEqual(document, fallback)).toBe(false);
    const binding = validateDocument(document);
    binding.root.commentBinding!.key = 'creative.other.v1';
    expect(documentContentEqual(document, binding)).toBe(false);
    const reordered = validateDocument(document);
    reordered.root.children.reverse();
    expect(documentContentEqual(document, reordered)).toBe(false);
  });

  it('normalizes omitted/empty comments but never normalizes user comment spelling', () => {
    const document = createDocument('Root');
    expect(documentContentEqual(document, { ...document, root: { ...document.root, comment: '' } })).toBe(true);
    const decomposed = setFolderComment(document, document.root.id, 'Cafe\u0301');
    const composed = setFolderComment(document, document.root.id, 'Café');
    expect(documentContentEqual(decomposed, composed)).toBe(false);
  });

  it('validates both inputs rather than treating malformed or duplicate-ID documents as equal', () => {
    const document = boundFixture();
    const invalid = validateDocument(document);
    invalid.root.children[0].id = invalid.root.id;
    expectCode(() => documentContentEqual(document, invalid), 'DUPLICATE_ID');
    expectCode(() => documentContentEqual(invalid, document), 'DUPLICATE_ID');
  });
});

describe('binding wire versions and literal text boundaries', () => {
  it('emits v3 for root or descendant bindings and roundtrips all provenance', () => {
    const document = boundFixture();
    const json = serializeJSON(document);
    expect(JSON.parse(json).version).toBe(3);
    expect(parseJSON(json)).toEqual(document);
    const childOnly = setFolderComment(document, document.root.id, document.root.comment!);
    expect(JSON.parse(serializeJSON(childOnly)).version).toBe(3);
    const storedDraft = JSON.stringify({ document: JSON.parse(json), pending: false });
    expect(validateDocument(JSON.parse(storedDraft).document)).toEqual(document);
  });

  it('selects v2 after the last binding is removed, then v1 after the final comment is cleared', () => {
    const document = createDocument('Root');
    document.root.comment = 'Default text';
    document.root.commentBinding = { source: 'folderseed-template', key: 'empty.root.v1' };
    expect(JSON.parse(serializeJSON(document)).version).toBe(3);
    const detached = setFolderComment(document, document.root.id, document.root.comment);
    expect(JSON.parse(serializeJSON(detached)).version).toBe(2);
    expect(JSON.parse(serializeJSON(setFolderComment(detached, detached.root.id, ''))).version).toBe(1);
  });

  it.each([1, 2, 3])('never infers bindings for ordinary comments in version %s JSON', version => {
    const document = createDocument('My project');
    document.root.comment = 'The starting point for your folder structure.';
    const imported = parseJSON(JSON.stringify({ version, root: document.root }));
    expect(imported.root.comment).toBe(document.root.comment);
    expect(imported.root.commentBinding).toBeUndefined();
    expect(imported.version).toBe(1);
  });

  it.each(['plain', 'ascii', 'unicode', 'markdown'] as const)('exports %s as a literal snapshot with no hidden binding or inference on reimport', format => {
    const document = boundFixture();
    const text = formatText(document, format);
    expect(text).not.toContain('folderseed-template');
    expect(text).not.toContain('creative.root.v1');
    const imported = parseText(text, format);
    expect(shape(imported)).toEqual(shape(document));
    expect(flatten(imported).every(({ node }) => node.commentBinding === undefined)).toBe(true);
    expect(documentContentEqual(document, imported)).toBe(false);
    expect(flatten(imported).map(item => item.path)).toEqual(flatten(document).map(item => item.path));
  });

  it('retains maximum-length keys in a maximum-size deeply nested JSON project under the 1 MB import cap', () => {
    const document = createDocument('Root');
    let parent = document.root;
    const make = (index: number): FolderNode => ({
      id: `id-${index}-${'x'.repeat(90)}`, name: `${'界'.repeat(80)}-${index}`, comment: '"'.repeat(500),
      commentBinding: { source: 'folderseed-template', key: `k${index}`.padEnd(LIMITS.commentBindingKeyLength, 'x') }, children: [],
    });
    for (let index = 1; index < LIMITS.depth; index++) { const child = make(index); parent.children.push(child); parent = child; }
    for (let index = LIMITS.depth; index < LIMITS.nodes; index++) parent.children.push(make(index));
    const json = serializeJSON(document);
    expect(JSON.parse(json).version).toBe(3);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(LIMITS.textBytes);
    expect(json.includes('\n')).toBe(false);
    expect(parseJSON(json)).toEqual(document);
  }, 20_000);
});
