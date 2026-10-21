import { addFolder, DirectoryError, flatten, moveFolder, type DirectoryDocument, type FlatFolder } from '../core';

function selection(document: DirectoryDocument, id: string): { rows: FlatFolder[]; selected: FlatFolder } {
  const rows = flatten(document);
  const selected = rows.find(row => row.node.id === id);
  if (!selected) throw new DirectoryError('NOT_FOUND', 'This folder no longer exists. Please select another folder.');
  return { rows, selected };
}

/** Move a subtree one level up, immediately after its current parent. */
export function outdentFolder(document: DirectoryDocument, id: string): DirectoryDocument {
  const { rows, selected } = selection(document, id);
  if (selected.parentId === null) throw new DirectoryError('ROOT_OPERATION', 'The root folder cannot be moved.');
  const parent = rows.find(row => row.node.id === selected.parentId)!;
  if (parent.parentId === null) {
    throw new DirectoryError('OUTDENT_UNAVAILABLE', 'This folder is already directly inside the root folder.');
  }
  const grandparent = rows.find(row => row.node.id === parent.parentId)!;
  const parentIndex = grandparent.node.children.findIndex(node => node.id === parent.node.id);
  return moveFolder(document, id, grandparent.node.id, parentIndex + 1);
}

/** Append a subtree inside its immediate preceding sibling. */
export function indentFolder(document: DirectoryDocument, id: string): DirectoryDocument {
  const { rows, selected } = selection(document, id);
  if (selected.parentId === null) throw new DirectoryError('ROOT_OPERATION', 'The root folder cannot be moved.');
  const parent = rows.find(row => row.node.id === selected.parentId)!;
  const index = parent.node.children.findIndex(node => node.id === id);
  if (index === 0) {
    throw new DirectoryError('INDENT_UNAVAILABLE', 'This folder has no preceding sibling to move into.');
  }
  return moveFolder(document, id, parent.node.children[index - 1].id);
}

/** Add an empty sibling immediately after the selection, as one document update. */
export function addSiblingFolder(document: DirectoryDocument, id: string, name: string): DirectoryDocument {
  const { rows, selected } = selection(document, id);
  if (selected.parentId === null) {
    throw new DirectoryError('ROOT_OPERATION', 'The root folder cannot have siblings. Add a child folder instead.');
  }
  const parent = rows.find(row => row.node.id === selected.parentId)!;
  const index = parent.node.children.findIndex(node => node.id === id);
  const added = addFolder(document, parent.node.id, name);
  const addedParent = flatten(added).find(row => row.node.id === parent.node.id)!.node;
  const newId = addedParent.children.at(-1)!.id;
  return moveFolder(added, newId, parent.node.id, index + 1);
}
