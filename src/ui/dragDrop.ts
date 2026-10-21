import { DirectoryError, flatten, moveFolder, validateDocument, type DirectoryDocument } from '../core';

export type DropPlacement = 'before' | 'inside' | 'after';

/** The exact quarter boundaries belong to the inside zone. Invalid geometry is safe to nest. */
export function dropPlacement(offsetY: number, height: number, isRoot: boolean): DropPlacement {
  if (isRoot || !Number.isFinite(offsetY) || !Number.isFinite(height) || height <= 0) return 'inside';
  if (offsetY < height * 0.25) return 'before';
  if (offsetY > height * 0.75) return 'after';
  return 'inside';
}

/**
 * Map a pointer's indentation band to an insertion depth (root is depth zero).
 * Infinity means the geometry is unavailable: resolveDropTarget will not outdent.
 */
export function dropDepth(clientX: number, treeLeft: number, baseInset = 12, indent = 22): number {
  if (![clientX, treeLeft, baseInset, indent].every(Number.isFinite) || baseInset < 0 || indent <= 0) {
    return Infinity;
  }
  return Math.max(1, Math.floor((clientX - treeLeft - baseInset) / indent));
}

/**
 * Resolve the same after-subtree boundary at a shallower horizontal depth.
 * An ancestor is eligible only when the current candidate is its last child.
 * This uses the complete model, never the visible/collapsed row list.
 */
export function resolveDropTarget(
  document: DirectoryDocument,
  targetId: string,
  placement: DropPlacement,
  desiredDepth: number,
): string {
  const rows = flatten(document);
  if (!['before', 'inside', 'after'].includes(placement)) {
    throw new DirectoryError('INVALID_DROP', 'Choose before, inside, or after as the drop position.');
  }
  const byId = new Map(rows.map(row => [row.node.id, row]));
  const original = byId.get(targetId);
  if (!original) throw new DirectoryError('NOT_FOUND', 'A dragged folder no longer exists. Please select it again.');
  if (placement !== 'after' || !Number.isFinite(desiredDepth)) return targetId;

  let target: (typeof rows)[number] = original;
  const depth = Math.max(1, Math.floor(desiredDepth));
  while (target.depth > depth && target.depth > 1) {
    const parent: (typeof rows)[number] = byId.get(target.parentId!)!;
    if (parent.node.children.at(-1)?.id !== target.node.id) break;
    target = parent;
  }
  return target.node.id;
}

/**
 * Move a folder relative to a drop target without mutating the input.
 * Sibling positions are calculated after removing the source, as required by moveFolder.
 * Valid drops that do not change position return the original document identity.
 */
export function moveByDrop(
  document: DirectoryDocument,
  sourceId: string,
  targetId: string,
  placement: DropPlacement,
): DirectoryDocument {
  const clean = validateDocument(document);
  if (!['before', 'inside', 'after'].includes(placement)) {
    throw new DirectoryError('INVALID_DROP', 'Choose before, inside, or after as the drop position.');
  }
  const rows = flatten(clean);
  const source = rows.find(row => row.node.id === sourceId);
  const target = rows.find(row => row.node.id === targetId);
  if (!source || !target) throw new DirectoryError('NOT_FOUND', 'A dragged folder no longer exists. Please select it again.');
  if (placement !== 'inside' && target.parentId === null) {
    throw new DirectoryError('ROOT_OPERATION', 'Folders cannot be placed before or after the root folder.');
  }
  if (sourceId === targetId) return document;

  if (placement === 'inside') {
    if (source.parentId === targetId && target.node.children.at(-1)?.id === sourceId) return document;
    return moveFolder(clean, sourceId, targetId);
  }

  const parent = rows.find(row => row.node.id === target.parentId)!.node;
  const remainingSiblings = parent.children.filter(node => node.id !== sourceId);
  const targetIndex = remainingSiblings.findIndex(node => node.id === targetId);
  const destinationIndex = targetIndex + (placement === 'after' ? 1 : 0);
  if (source.parentId === parent.id && parent.children.findIndex(node => node.id === sourceId) === destinationIndex) {
    return document;
  }
  return moveFolder(clean, sourceId, parent.id, destinationIndex);
}
