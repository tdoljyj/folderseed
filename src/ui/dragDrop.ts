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
