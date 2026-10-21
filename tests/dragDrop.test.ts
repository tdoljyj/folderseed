import { describe, expect, it } from 'vitest';
import { createDocument, DirectoryError, flatten, LIMITS, parseText, serializeJSON, type DirectoryDocument } from '../src/core';
import { dropDepth, dropPlacement, moveByDrop, resolveDropTarget, type DropPlacement } from '../src/ui/dragDrop';
import { historyReducer, type HistoryState } from '../src/ui/history';

function fixture(): DirectoryDocument {
  return parseText('Root\n  A\n    A1\n    A2\n  B\n    B1\n    B2\n  C\n    C1\n  D', 'plain');
}
function id(document: DirectoryDocument, name: string): string {
  return flatten(document).find(row => row.node.name === name)!.node.id;
}
function children(document: DirectoryDocument, name = 'Root'): string[] {
  return flatten(document).find(row => row.node.name === name)!.node.children.map(node => node.name);
}
function expectCode(run: () => unknown, code: string): void {
  let error: unknown;
  try { run(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(DirectoryError);
  expect((error as DirectoryError).code).toBe(code);
}

describe('drop placement zones', () => {
  it.each([
    [-10, 'before'], [0, 'before'], [24.999, 'before'], [25, 'inside'],
    [25.001, 'inside'], [50, 'inside'], [74.999, 'inside'], [75, 'inside'],
    [75.001, 'after'], [100, 'after'], [110, 'after'],
  ] as const)('maps offset %s in a 100px row to %s', (offset, expected) => {
    expect(dropPlacement(offset, 100, false)).toBe(expected);
  });

  it('scales the thresholds to the actual row height', () => {
    expect(dropPlacement(9, 40, false)).toBe('before');
    expect(dropPlacement(10, 40, false)).toBe('inside');
    expect(dropPlacement(30, 40, false)).toBe('inside');
    expect(dropPlacement(31, 40, false)).toBe('after');
    expect(dropPlacement(0.24, 1, false)).toBe('before');
    expect(dropPlacement(0.76, 1, false)).toBe('after');
  });

  it.each([-10, 0, 25, 50, 75, 100, 110, NaN, Infinity])('always nests drops on the root at offset %s', offset => {
    expect(dropPlacement(offset, 100, true)).toBe('inside');
  });

  it.each([[0, 0], [10, -1], [10, NaN], [10, Infinity], [NaN, 100], [Infinity, 100], [-Infinity, 100]])('handles invalid geometry (%s, %s) without unsafe placement', (offset, height) => {
    expect(dropPlacement(offset, height, false)).toBe('inside');
  });
});

describe('same-parent before and after drops', () => {
  it.each([
    ['A', 'C', 'before', ['B', 'A', 'C', 'D']],
    ['A', 'C', 'after', ['B', 'C', 'A', 'D']],
    ['D', 'B', 'before', ['A', 'D', 'B', 'C']],
    ['D', 'B', 'after', ['A', 'B', 'D', 'C']],
    ['A', 'D', 'after', ['B', 'C', 'D', 'A']],
    ['D', 'A', 'before', ['D', 'A', 'B', 'C']],
    ['B', 'C', 'after', ['A', 'C', 'B', 'D']],
    ['C', 'B', 'before', ['A', 'C', 'B', 'D']],
  ] as const)('moves %s %s %s using the final sibling index', (source, target, placement, expected) => {
    const document = fixture();
    const before = serializeJSON(document);
    const next = moveByDrop(document, id(document, source), id(document, target), placement);
    expect(children(next)).toEqual(expected);
    expect(children(next, 'A')).toEqual(['A1', 'A2']);
    expect(children(next, 'B')).toEqual(['B1', 'B2']);
    expect(serializeJSON(document)).toBe(before);
  });

  it.each([
    ['A', 'B', 'before'], ['B', 'A', 'after'], ['B', 'C', 'before'],
    ['C', 'B', 'after'], ['C', 'D', 'before'], ['D', 'C', 'after'],
  ] as const)('keeps adjacent no-op %s / %s / %s out of history', (source, target, placement) => {
    const document = fixture();
    expect(moveByDrop(document, id(document, source), id(document, target), placement)).toBe(document);
  });

  it.each(['before', 'inside', 'after'] as const)('returns the original document when a folder targets itself %s', placement => {
    const document = fixture();
    expect(moveByDrop(document, id(document, 'A'), id(document, 'A'), placement)).toBe(document);
  });

  it('handles every pair of root siblings without changing the folder set', () => {
    const document = fixture();
    const names = children(document);
    for (const source of names) {
      for (const target of names.filter(name => name !== source)) {
        for (const placement of ['before', 'after'] as const) {
          const next = moveByDrop(document, id(document, source), id(document, target), placement);
          const order = children(next);
          expect(order.slice().sort()).toEqual(names);
          expect(order.indexOf(source)).toBe(order.indexOf(target) + (placement === 'before' ? -1 : 1));
          expect(flatten(next).map(row => row.node.id).sort()).toEqual(flatten(document).map(row => row.node.id).sort());
        }
      }
    }
  });
});

describe('cross-parent placement and nesting', () => {
  it.each([
    ['B1', 'before', ['A1', 'B1', 'B2']],
    ['B1', 'after', ['B1', 'A1', 'B2']],
    ['B2', 'before', ['B1', 'A1', 'B2']],
    ['B2', 'after', ['B1', 'B2', 'A1']],
  ] as const)('inserts A1 around %s / %s', (target, placement, expected) => {
    const document = fixture();
    const next = moveByDrop(document, id(document, 'A1'), id(document, target), placement);
    expect(children(next, 'A')).toEqual(['A2']);
    expect(children(next, 'B')).toEqual(expected);
    expect(children(next)).toEqual(['A', 'B', 'C', 'D']);
    expect(children(document, 'A')).toEqual(['A1', 'A2']);
  });

  it('moves a whole subtree and preserves its internal ordering and IDs', () => {
    const document = fixture();
    const originalA = document.root.children[0];
    const next = moveByDrop(document, originalA.id, id(document, 'B1'), 'after');
    expect(children(next)).toEqual(['B', 'C', 'D']);
    expect(children(next, 'B')).toEqual(['B1', 'A', 'B2']);
    expect(flatten(next).find(row => row.node.id === originalA.id)!.node).toEqual(originalA);
    expect(flatten(next).find(row => row.node.name === 'A1')!.path).toBe('Root/B/A/A1');
  });

  it.each(['before', 'after'] as const)('allows promotion %s an ancestor without creating a cycle', placement => {
    const document = fixture();
    const next = moveByDrop(document, id(document, 'A1'), id(document, 'A'), placement);
    expect(children(next)).toEqual(placement === 'before' ? ['A1', 'A', 'B', 'C', 'D'] : ['A', 'A1', 'B', 'C', 'D']);
    expect(children(next, 'A')).toEqual(['A2']);
  });

  it('appends inside a target rather than replacing or prepending its children', () => {
    const document = fixture();
    const next = moveByDrop(document, id(document, 'A'), id(document, 'B'), 'inside');
    expect(children(next, 'B')).toEqual(['B1', 'B2', 'A']);
    expect(children(next, 'A')).toEqual(['A1', 'A2']);
    expect(children(next)).toEqual(['B', 'C', 'D']);
  });

  it('can append into an empty folder and into the root', () => {
    const document = fixture();
    const nested = moveByDrop(document, id(document, 'A1'), id(document, 'D'), 'inside');
    expect(children(nested, 'D')).toEqual(['A1']);
    const promoted = moveByDrop(nested, id(nested, 'A1'), nested.root.id, 'inside');
    expect(children(promoted)).toEqual(['A', 'B', 'C', 'D', 'A1']);
    expect(children(promoted, 'D')).toEqual([]);
  });

  it('recognizes inside drops that already occupy the final position', () => {
    const document = fixture();
    expect(moveByDrop(document, id(document, 'A2'), id(document, 'A'), 'inside')).toBe(document);
    expect(moveByDrop(document, id(document, 'D'), document.root.id, 'inside')).toBe(document);
    const reordered = moveByDrop(document, id(document, 'A1'), id(document, 'A'), 'inside');
    expect(children(reordered, 'A')).toEqual(['A2', 'A1']);
  });
});

describe('drag safety and atomic failures', () => {
  it('rejects moves of the root, but allows an inside self-drop without changing anything', () => {
    const document = fixture();
    for (const placement of ['before', 'inside', 'after'] as const) {
      expectCode(() => moveByDrop(document, document.root.id, id(document, 'A'), placement), 'ROOT_OPERATION');
    }
    expect(moveByDrop(document, document.root.id, document.root.id, 'inside')).toBe(document);
  });

  it.each(['before', 'after'] as const)('rejects explicit %s placement outside the root', placement => {
    const document = fixture();
    expectCode(() => moveByDrop(document, id(document, 'A'), document.root.id, placement), 'ROOT_OPERATION');
    expectCode(() => moveByDrop(document, document.root.id, document.root.id, placement), 'ROOT_OPERATION');
  });

  it.each(['before', 'inside', 'after'] as const)('rejects %s drops into descendants atomically', placement => {
    const document = fixture();
    const before = serializeJSON(document);
    expectCode(() => moveByDrop(document, id(document, 'A'), id(document, 'A1'), placement), 'CYCLE');
    expect(serializeJSON(document)).toBe(before);
  });

  it.each(['before', 'after'] as const)('rejects duplicate names at the destination for %s drops', placement => {
    const document = parseText('Root\n  Left\n    Shared\n  Right\n    shared\n    Target', 'plain');
    const before = serializeJSON(document);
    expectCode(() => moveByDrop(document, id(document, 'Shared'), id(document, 'Target'), placement), 'DUPLICATE_NAME');
    expect(serializeJSON(document)).toBe(before);
  });

  it('rejects duplicate names when nesting', () => {
    const document = parseText('Root\n  Left\n    Shared\n  Right\n    shared', 'plain');
    const before = serializeJSON(document);
    expectCode(() => moveByDrop(document, id(document, 'Shared'), id(document, 'Right'), 'inside'), 'DUPLICATE_NAME');
    expect(serializeJSON(document)).toBe(before);
  });

  it('rejects unknown IDs even if source and target are equal', () => {
    const document = fixture();
    expectCode(() => moveByDrop(document, 'missing', document.root.id, 'inside'), 'NOT_FOUND');
    expectCode(() => moveByDrop(document, id(document, 'A'), 'missing', 'before'), 'NOT_FOUND');
    expectCode(() => moveByDrop(document, 'missing', 'missing', 'inside'), 'NOT_FOUND');
    expectCode(() => moveByDrop(document, id(document, 'A'), id(document, 'B'), 'middle' as DropPlacement), 'INVALID_DROP');
  });

  it('validates untrusted documents before returning a no-op', () => {
    const document = createDocument('Root');
    document.root.name = '../escape';
    expectCode(() => moveByDrop(document, document.root.id, document.root.id, 'inside'), 'UNSAFE_NAME');
    document.root.name = 'Root';
    document.root.children.push({ id: document.root.id, name: 'Duplicate ID', children: [] });
    expectCode(() => moveByDrop(document, document.root.id, document.root.id, 'inside'), 'DUPLICATE_ID');
  });

  it('retains core depth limits without changing the source document on failure', () => {
    const document = parseText(`Root\n  Branch\n    Leaf\n${Array.from({ length: LIMITS.depth }, (_, index) => `${'  '.repeat(index + 1)}Level-${index}`).join('\n')}`, 'plain');
    const before = serializeJSON(document);
    const deepest = flatten(document).at(-1)!.node;
    expectCode(() => moveByDrop(document, id(document, 'Branch'), deepest.id, 'inside'), 'TOO_DEEP');
    expectCode(() => moveByDrop(document, id(document, 'Branch'), deepest.id, 'before'), 'TOO_DEEP');
    expect(serializeJSON(document)).toBe(before);
  });

  it('works with recursively frozen inputs without mutating them', () => {
    const document = fixture();
    for (const { node } of flatten(document)) expect(node.name).toBeTruthy();
    function freeze(node: DirectoryDocument['root']): void {
      node.children.forEach(freeze);
      Object.freeze(node.children);
      Object.freeze(node);
    }
    freeze(document.root);
    Object.freeze(document);
    expect(children(moveByDrop(document, id(document, 'A'), id(document, 'D'), 'after'))).toEqual(['B', 'C', 'D', 'A']);
    expect(children(document)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('horizontal insertion depth', () => {
  it.each([
    [-200, 1], [0, 1], [12, 1], [34, 1], [39, 1], [45, 1], [55.999, 1],
    [56, 2], [61, 2], [67, 2], [77.999, 2], [78, 3], [100, 4],
  ])('maps x=%s to depth %s with the default insertion-line geometry', (x, expected) => {
    expect(dropDepth(x, 0)).toBe(expected);
    expect(dropDepth(x + 240, 240)).toBe(expected);
    expect(dropDepth(x - 240, -240)).toBe(expected);
  });

  it('supports custom insets, fractional coordinates, and indent widths', () => {
    expect(dropDepth(230, 200, 10, 10)).toBe(2);
    expect(dropDepth(235, 200, 10, 10)).toBe(2);
    expect(dropDepth(22.5, 10, 0, 5)).toBe(2);
    expect(dropDepth(1e10, 0)).toBeGreaterThan(32);
  });

  it.each([
    [NaN, 0, 12, 22], [Infinity, 0, 12, 22], [-Infinity, 0, 12, 22],
    [34, NaN, 12, 22], [34, Infinity, 12, 22], [34, 0, NaN, 22],
    [34, 0, Infinity, 22], [34, 0, -1, 22], [34, 0, 12, NaN],
    [34, 0, 12, Infinity], [34, 0, 12, 0], [34, 0, 12, -1],
  ])('does not request an outdent for invalid geometry %j', (x, left, inset, indent) => {
    expect(dropDepth(x, left, inset, indent)).toBe(Infinity);
  });
});

function outdentFixture(): DirectoryDocument {
  return parseText('Root\n  Before\n  Parent\n    First\n      First leaf\n    Last\n      Earlier\n      Tail\n        Deep leaf\n  After', 'plain');
}

describe('after-subtree horizontal target resolution', () => {
  it.each([
    [4, 'Deep leaf'], [3, 'Tail'], [2, 'Last'], [1, 'Parent'],
    [0, 'Parent'], [-20, 'Parent'], [20, 'Deep leaf'],
  ])('resolves a complete last-child chain at requested depth %s to %s', (depth, expected) => {
    const document = outdentFixture();
    const before = serializeJSON(document);
    expect(resolveDropTarget(document, id(document, 'Deep leaf'), 'after', depth)).toBe(id(document, expected));
    expect(serializeJSON(document)).toBe(before);
  });

  it.each(['before', 'inside'] as const)('never adjusts %s placement horizontally', placement => {
    const document = outdentFixture();
    for (const depth of [-1, 0, 1, 2, 3, 20, NaN, Infinity]) {
      expect(resolveDropTarget(document, id(document, 'Deep leaf'), placement, depth)).toBe(id(document, 'Deep leaf'));
    }
  });

  it('stops immediately when the target is not its parent\'s last child', () => {
    const document = outdentFixture();
    expect(resolveDropTarget(document, id(document, 'Earlier'), 'after', 1)).toBe(id(document, 'Earlier'));
    expect(resolveDropTarget(document, id(document, 'First'), 'after', 1)).toBe(id(document, 'First'));
  });

  it('can climb part of a chain but stops at the first non-last ancestor', () => {
    const document = outdentFixture();
    expect(resolveDropTarget(document, id(document, 'First leaf'), 'after', 1)).toBe(id(document, 'First'));
  });

  it('treats an after-target boundary as after the full subtree, independent of collapse state', () => {
    const document = outdentFixture();
    expect(resolveDropTarget(document, id(document, 'Tail'), 'after', 1)).toBe(id(document, 'Parent'));
    expect(resolveDropTarget(document, id(document, 'Last'), 'after', 1)).toBe(id(document, 'Parent'));
    expect(flatten(document).find(row => row.node.name === 'Tail')!.node.children).toHaveLength(1);
  });

  it('never climbs to the root, even from its last child', () => {
    const document = outdentFixture();
    expect(resolveDropTarget(document, id(document, 'After'), 'after', 0)).toBe(id(document, 'After'));
    for (const placement of ['before', 'inside', 'after'] as const) {
      expect(resolveDropTarget(document, document.root.id, placement, 1)).toBe(document.root.id);
    }
    expectCode(() => moveByDrop(document, id(document, 'Before'), resolveDropTarget(document, document.root.id, 'after', 1), 'after'), 'ROOT_OPERATION');
  });

  it.each([NaN, Infinity, -Infinity])('leaves the target unchanged for invalid depth %s', depth => {
    const document = outdentFixture();
    expect(resolveDropTarget(document, id(document, 'Deep leaf'), 'after', depth)).toBe(id(document, 'Deep leaf'));
  });

  it('uses the containing indentation band for fractional depth', () => {
    const document = outdentFixture();
    expect(resolveDropTarget(document, id(document, 'Deep leaf'), 'after', 1.49)).toBe(id(document, 'Parent'));
    expect(resolveDropTarget(document, id(document, 'Deep leaf'), 'after', 1.99)).toBe(id(document, 'Parent'));
    expect(resolveDropTarget(document, id(document, 'Deep leaf'), 'after', 2)).toBe(id(document, 'Last'));
  });

  it('validates the model, target, and placement without mutating the input', () => {
    const document = outdentFixture();
    expectCode(() => resolveDropTarget(document, 'missing', 'before', 1), 'NOT_FOUND');
    expectCode(() => resolveDropTarget(document, document.root.id, 'middle' as DropPlacement, 1), 'INVALID_DROP');
    document.root.name = '../unsafe';
    expectCode(() => resolveDropTarget(document, document.root.id, 'inside', 1), 'UNSAFE_NAME');
  });
});

describe('resolved drop hierarchy and history', () => {
  it.each([
    [1, 'Root', 'Root/Before'],
    [2, 'Parent', 'Root/Parent/Before'],
    [3, 'Last', 'Root/Parent/Last/Before'],
  ] as const)('moves a source to requested depth %s using the resolved target', (depth, expectedParent, expectedPath) => {
    const document = outdentFixture();
    const target = resolveDropTarget(document, id(document, 'Deep leaf'), 'after', depth);
    const next = moveByDrop(document, id(document, 'Before'), target, 'after');
    expect(flatten(next).find(row => row.node.name === 'Before')!.depth).toBe(depth);
    expect(flatten(next).find(row => row.node.name === 'Before')!.path).toBe(expectedPath);
    expect(children(next, expectedParent).at(-1)).toBe(depth === 1 ? 'After' : 'Before');
    expect(children(next, 'Tail')).toEqual(['Deep leaf']);
    expect(children(document)).toEqual(['Before', 'Parent', 'After']);
  });

  it('outdents a nested source after its own ancestor and preserves its subtree', () => {
    const document = outdentFixture();
    const target = resolveDropTarget(document, id(document, 'Deep leaf'), 'after', 1);
    const next = moveByDrop(document, id(document, 'Tail'), target, 'after');
    expect(children(next)).toEqual(['Before', 'Parent', 'Tail', 'After']);
    expect(children(next, 'Last')).toEqual(['Earlier']);
    expect(children(next, 'Tail')).toEqual(['Deep leaf']);
  });

  it('preserves an existing position as the original document identity', () => {
    const document = outdentFixture();
    const target = resolveDropTarget(document, id(document, 'Deep leaf'), 'after', 1);
    expect(moveByDrop(document, id(document, 'After'), target, 'after')).toBe(document);
    expect(moveByDrop(document, id(document, 'Parent'), target, 'after')).toBe(document);
  });

  it('does not bypass cycle protection when the boundary cannot climb far enough', () => {
    const document = outdentFixture();
    const before = serializeJSON(document);
    const target = resolveDropTarget(document, id(document, 'First leaf'), 'after', 1);
    expectCode(() => moveByDrop(document, id(document, 'Parent'), target, 'after'), 'CYCLE');
    expect(serializeJSON(document)).toBe(before);
  });

  it('preserves duplicate-name checks after changing the insertion parent', () => {
    const document = parseText('Root\n  Shared\n  Parent\n    shared\n    Last\n      Tail', 'plain');
    const before = serializeJSON(document);
    const target = resolveDropTarget(document, id(document, 'Tail'), 'after', 2);
    expectCode(() => moveByDrop(document, id(document, 'Shared'), target, 'after'), 'DUPLICATE_NAME');
    expect(serializeJSON(document)).toBe(before);
  });

  it('undoes and redoes a resolved move as one operation while no-op drops need no commit', () => {
    const document = outdentFixture();
    const target = resolveDropTarget(document, id(document, 'Deep leaf'), 'after', 1);
    const next = moveByDrop(document, id(document, 'Tail'), target, 'after');
    const initial: HistoryState = { past: [], present: document, future: [] };
    const committed = historyReducer(initial, { type: 'commit', document: next });
    expect(committed.past).toEqual([document]);
    const undone = historyReducer(committed, { type: 'undo' });
    expect(undone.present).toBe(document);
    expect(historyReducer(undone, { type: 'redo' }).present).toBe(next);
    const unchanged = moveByDrop(next, id(next, 'Tail'), id(next, 'Parent'), 'after');
    expect(unchanged).toBe(next);
  });
});
