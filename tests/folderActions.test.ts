import { describe, expect, it } from 'vitest';
import { DirectoryError, flatten, LIMITS, parseText, serializeJSON, type DirectoryDocument } from '../src/core';
import { addSiblingFolder, indentFolder, outdentFolder } from '../src/ui/folderActions';
import { historyReducer, type HistoryState } from '../src/ui/history';

function fixture(): DirectoryDocument {
  return parseText('Root\n  Before\n  Parent\n    A\n      A1\n    B\n      B1\n      B2\n    C\n  After', 'plain');
}
function row(document: DirectoryDocument, name: string) {
  return flatten(document).find(item => item.node.name === name)!;
}
function children(document: DirectoryDocument, name = 'Root'): string[] {
  return row(document, name).node.children.map(node => node.name);
}
function expectCode(run: () => unknown, code: string): void {
  let error: unknown;
  try { run(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(DirectoryError);
  expect((error as DirectoryError).code).toBe(code);
}

describe('outdent folder', () => {
  it.each(['A', 'B', 'C'])('places %s immediately after its parent, preserving other sibling order', name => {
    const document = fixture();
    const original = row(document, name).node;
    const before = serializeJSON(document);
    const moved = outdentFolder(document, original.id);
    expect(children(moved)).toEqual(['Before', 'Parent', name, 'After']);
    expect(children(moved, 'Parent')).toEqual(['A', 'B', 'C'].filter(value => value !== name));
    expect(row(moved, name).node).toEqual(original);
    expect(row(moved, name).depth).toBe(1);
    expect(serializeJSON(document)).toBe(before);
  });

  it('outdents only one level, not all the way to the root', () => {
    const document = fixture();
    const moved = outdentFolder(document, row(document, 'B1').node.id);
    expect(children(moved, 'Parent')).toEqual(['A', 'B', 'B1', 'C']);
    expect(children(moved, 'B')).toEqual(['B2']);
    expect(children(moved)).toEqual(['Before', 'Parent', 'After']);
  });

  it.each(['First', 'Last'])('handles a %s parent at a grandparent boundary', name => {
    const document = parseText('Root\n  First\n    X\n  Last\n    Y', 'plain');
    const moved = outdentFolder(document, row(document, name === 'First' ? 'X' : 'Y').node.id);
    expect(children(moved)).toEqual(name === 'First' ? ['First', 'X', 'Last'] : ['First', 'Last', 'Y']);
  });

  it('rejects the root and folders already directly inside it', () => {
    const document = fixture();
    expectCode(() => outdentFolder(document, document.root.id), 'ROOT_OPERATION');
    for (const child of document.root.children) {
      expectCode(() => outdentFolder(document, child.id), 'OUTDENT_UNAVAILABLE');
    }
  });

  it('rejects case-insensitive duplicate names in the grandparent without mutation', () => {
    const document = parseText('Root\n  Shared\n  Parent\n    shared', 'plain');
    const before = serializeJSON(document);
    expectCode(() => outdentFolder(document, row(document, 'shared').node.id), 'DUPLICATE_NAME');
    expect(serializeJSON(document)).toBe(before);
  });
});

describe('indent folder', () => {
  it('appends the subtree after the preceding sibling\'s existing children', () => {
    const document = fixture();
    const originalB = row(document, 'B').node;
    const before = serializeJSON(document);
    const moved = indentFolder(document, originalB.id);
    expect(children(moved, 'Parent')).toEqual(['A', 'C']);
    expect(children(moved, 'A')).toEqual(['A1', 'B']);
    expect(row(moved, 'B').node).toEqual(originalB);
    expect(row(moved, 'B').path).toBe('Root/Parent/A/B');
    expect(serializeJSON(document)).toBe(before);
  });

  it('uses the immediate preceding sibling rather than the first sibling', () => {
    const document = fixture();
    const moved = indentFolder(document, row(document, 'C').node.id);
    expect(children(moved, 'Parent')).toEqual(['A', 'B']);
    expect(children(moved, 'B')).toEqual(['B1', 'B2', 'C']);
    expect(children(moved, 'A')).toEqual(['A1']);
  });

  it('can indent a root child into an empty preceding sibling', () => {
    const document = fixture();
    const moved = indentFolder(document, row(document, 'Parent').node.id);
    expect(children(moved)).toEqual(['Before', 'After']);
    expect(children(moved, 'Before')).toEqual(['Parent']);
    expect(children(moved, 'Parent')).toEqual(['A', 'B', 'C']);
  });

  it('rejects root and first siblings at every level', () => {
    const document = fixture();
    expectCode(() => indentFolder(document, document.root.id), 'ROOT_OPERATION');
    for (const name of ['Before', 'A', 'A1', 'B1']) {
      expectCode(() => indentFolder(document, row(document, name).node.id), 'INDENT_UNAVAILABLE');
    }
  });

  it('rejects a duplicate in the preceding sibling without mutation', () => {
    const document = parseText('Root\n  Previous\n    Shared\n  shared', 'plain');
    const before = serializeJSON(document);
    expectCode(() => indentFolder(document, row(document, 'shared').node.id), 'DUPLICATE_NAME');
    expect(serializeJSON(document)).toBe(before);
  });

  it('rejects a move whose deepest descendant would exceed the depth limit', () => {
    const chain = Array.from({ length: LIMITS.depth }, (_, depth) => `${'  '.repeat(depth + 1)}Level-${depth}`).join('\n');
    const document = parseText(`Root\n  Previous\n${chain}`, 'plain');
    const before = serializeJSON(document);
    expectCode(() => indentFolder(document, row(document, 'Level-0').node.id), 'TOO_DEEP');
    expect(serializeJSON(document)).toBe(before);
  });
});

describe('add sibling folder', () => {
  it.each([
    ['A', ['A', 'New', 'B', 'C']],
    ['B', ['A', 'B', 'New', 'C']],
    ['C', ['A', 'B', 'C', 'New']],
  ] as const)('inserts directly after %s without an off-by-one reorder', (name, expected) => {
    const document = fixture();
    const before = serializeJSON(document);
    const added = addSiblingFolder(document, row(document, name).node.id, 'New');
    expect(children(added, 'Parent')).toEqual(expected);
    expect(row(added, 'New').node.children).toEqual([]);
    expect(row(added, 'New').depth).toBe(row(document, name).depth);
    const oldIds = flatten(document).map(item => item.node.id);
    const newIds = flatten(added).map(item => item.node.id);
    expect(newIds.filter(id => !oldIds.includes(id))).toEqual([row(added, 'New').node.id]);
    for (const old of flatten(document)) {
      const next = flatten(added).find(item => item.node.id === old.node.id)!;
      expect(next.node.name).toBe(old.node.name);
    }
    expect(children(added, 'B')).toEqual(['B1', 'B2']);
    expect(serializeJSON(document)).toBe(before);
  });

  it('works beside an only child and at the root-child level', () => {
    const document = fixture();
    const nested = addSiblingFolder(document, row(document, 'A1').node.id, 'A2');
    expect(children(nested, 'A')).toEqual(['A1', 'A2']);
    const rootLevel = addSiblingFolder(document, row(document, 'Parent').node.id, 'Next');
    expect(children(rootLevel)).toEqual(['Before', 'Parent', 'Next', 'After']);
  });

  it('rejects adding a sibling to the root', () => {
    const document = fixture();
    expectCode(() => addSiblingFolder(document, document.root.id, 'Second root'), 'ROOT_OPERATION');
  });

  it.each([
    ['b', 'DUPLICATE_NAME'], ['../escape', 'UNSAFE_NAME'], ['CON', 'RESERVED_NAME'],
    ['', 'INVALID_NAME'], ['Trailing ', 'INVALID_NAME'],
  ])('rejects invalid sibling name %j atomically', (name, code) => {
    const document = fixture();
    const before = serializeJSON(document);
    expectCode(() => addSiblingFolder(document, row(document, 'A').node.id, name), code);
    expect(serializeJSON(document)).toBe(before);
  });

  it('normalizes valid names and rejects canonically equivalent duplicates', () => {
    const document = fixture();
    const added = addSiblingFolder(document, row(document, 'A').node.id, 'Cafe\u0301');
    expect(children(added, 'Parent')).toEqual(['A', 'Café', 'B', 'C']);
    expectCode(() => addSiblingFolder(added, row(added, 'A').node.id, 'Café'), 'DUPLICATE_NAME');
  });

  it('can add a sibling at the deepest legal level without increasing depth', () => {
    const chain = Array.from({ length: LIMITS.depth }, (_, depth) => `${'  '.repeat(depth + 1)}Level-${depth}`).join('\n');
    const document = parseText(`Root\n${chain}`, 'plain');
    const deepest = flatten(document).at(-1)!;
    const added = addSiblingFolder(document, deepest.node.id, 'Sibling');
    expect(row(added, 'Sibling').depth).toBe(LIMITS.depth);
    expect(row(added, 'Sibling').parentId).toBe(deepest.parentId);
  });

  it('rejects exceeding the node limit without leaving an intermediate addition', () => {
    const document = parseText(`Root\n${Array.from({ length: LIMITS.nodes - 1 }, (_, index) => `  Folder-${index}`).join('\n')}`, 'plain');
    const before = serializeJSON(document);
    expectCode(() => addSiblingFolder(document, document.root.children[0].id, 'Too many'), 'TOO_MANY_FOLDERS');
    expect(serializeJSON(document)).toBe(before);
  });
});

describe('folder action validation, immutability, and history', () => {
  const actions = [
    ['outdent', outdentFolder],
    ['indent', indentFolder],
    ['add sibling', (document: DirectoryDocument, id: string) => addSiblingFolder(document, id, 'New')],
  ] as const;

  it.each(actions)('%s rejects stale IDs and malformed documents', (_name, action) => {
    const document = fixture();
    expectCode(() => action(document, 'missing'), 'NOT_FOUND');
    document.root.name = '../unsafe';
    expectCode(() => action(document, document.root.id), 'UNSAFE_NAME');
  });

  it.each(actions)('%s works with a recursively frozen document', (_name, action) => {
    const document = fixture();
    const id = row(document, 'B').node.id;
    const before = serializeJSON(document);
    const freeze = (node: DirectoryDocument['root']): void => {
      node.children.forEach(freeze);
      Object.freeze(node.children);
      Object.freeze(node);
    };
    freeze(document.root);
    Object.freeze(document);
    const next = action(document, id);
    expect(next).not.toBe(document);
    expect(serializeJSON(document)).toBe(before);
  });

  it.each(actions)('%s is a single undoable update, including the two-step sibling implementation', (_name, action) => {
    const document = fixture();
    const next = action(document, row(document, 'B').node.id);
    const initial: HistoryState = { past: [], present: document, future: [] };
    const committed = historyReducer(initial, { type: 'commit', document: next });
    expect(committed.past).toEqual([document]);
    expect(committed.present).toBe(next);
    const undone = historyReducer(committed, { type: 'undo' });
    expect(undone.present).toBe(document);
    expect(undone.past).toEqual([]);
    expect(historyReducer(undone, { type: 'redo' }).present).toBe(next);
  });
});
