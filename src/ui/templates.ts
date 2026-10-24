import { createDocument, validateDocument, type FolderNode } from '../core';
import type { Translator } from './i18n';
import { templateCommentMessages, type TemplateCommentKey } from './templateComments';

interface TemplateFolder {
  name: string;
  commentKey: TemplateCommentKey;
  children?: readonly TemplateFolder[];
}

const definitions = [
  {
    id: 'creative', name: 'Creative project', description: 'From first spark to final delivery', icon: 'spark',
    root: { name: 'My creative project', commentKey: 'creative.root', children: [
      { name: '01 Inspiration', commentKey: 'creative.inspiration', children: [
        { name: 'References', commentKey: 'creative.references' },
        { name: 'Moodboards', commentKey: 'creative.moodboards' },
      ] },
      { name: '02 Work in progress', commentKey: 'creative.work', children: [
        { name: 'Drafts', commentKey: 'creative.drafts' },
        { name: 'Assets', commentKey: 'creative.assets' },
      ] },
      { name: '03 Final delivery', commentKey: 'creative.delivery', children: [
        { name: 'Exports', commentKey: 'creative.exports' },
        { name: 'Archive', commentKey: 'creative.archive' },
      ] },
    ] },
  },
  {
    id: 'personal', name: 'Everyday life', description: 'A home for the everyday', icon: 'home',
    root: { name: 'My space', commentKey: 'personal.root', children: [
      { name: 'Documents', commentKey: 'personal.documents', children: [
        { name: 'Personal', commentKey: 'personal.records' },
        { name: 'Household', commentKey: 'personal.household' },
      ] },
      { name: 'Photos', commentKey: 'personal.photos', children: [
        { name: 'This year', commentKey: 'personal.current-year' },
      ] },
      { name: 'Projects', commentKey: 'personal.projects' },
      { name: 'Archive', commentKey: 'personal.archive' },
    ] },
  },
  {
    id: 'web', name: 'Web project', description: 'A simple starting structure', icon: 'code',
    root: { name: 'My website', commentKey: 'web.root', children: [
      { name: 'src', commentKey: 'web.source', children: [
        { name: 'components', commentKey: 'web.components' },
        { name: 'styles', commentKey: 'web.styles' },
        { name: 'utils', commentKey: 'web.utilities' },
      ] },
      { name: 'public', commentKey: 'web.public', children: [
        { name: 'images', commentKey: 'web.images' },
        { name: 'fonts', commentKey: 'web.fonts' },
      ] },
      { name: 'docs', commentKey: 'web.docs' },
      { name: 'tests', commentKey: 'web.tests' },
    ] },
  },
  {
    id: 'empty', name: 'Start from scratch', description: 'One folder, endless possibilities', icon: 'plus',
    root: { name: 'My project', commentKey: 'empty.root' },
  },
] as const satisfies readonly { id: string; name: string; description: string; icon: string; root: TemplateFolder }[];

function outline(root: TemplateFolder): { node: TemplateFolder; depth: number }[] {
  const rows: { node: TemplateFolder; depth: number }[] = [];
  function visit(node: TemplateFolder, depth: number) {
    rows.push({ node, depth });
    node.children?.forEach(child => visit(child, depth + 1));
  }
  visit(root, 0);
  return rows;
}

/** Keep the original plain outlines available without encoding comments into folder names. */
export const templates = definitions.map(({ root, ...metadata }) => {
  const rows = outline(root);
  return {
    ...metadata,
    text: rows.map(({ node, depth }) => `${'  '.repeat(depth)}${node.name}`).join('\n'),
    comments: rows.map(({ node }) => templateCommentMessages[node.commentKey]),
  };
});

/** The optional translator is retained for compatibility; only projections are localized. */
export function makeTemplate(index: number, _translate?: Translator) {
  function createNode(definition: TemplateFolder): FolderNode {
    const node = createDocument(definition.name).root;
    node.comment = templateCommentMessages[definition.commentKey];
    node.commentBinding = { source: 'folderseed-template', key: definition.commentKey };
    node.children = definition.children?.map(createNode) ?? [];
    return node;
  }
  return validateDocument({ version: 3, root: createNode(definitions[index].root) });
}
