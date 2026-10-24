import { validateDocument, type DirectoryDocument, type FolderNode } from '../core';
import type { Translator } from './i18n';

/** Stable semantic keys are persisted; English phrases are only fallback/catalog messages. */
export const templateCommentMessages = {
  'creative.root': 'Project ideas, work in progress, and final deliveries.',
  'creative.inspiration': 'Collect ideas and visual direction.',
  'creative.references': 'Examples and research to guide the project.',
  'creative.moodboards': 'Colors, styles, and visual inspiration.',
  'creative.work': 'Keep unfinished work together.',
  'creative.drafts': 'Early versions and experiments.',
  'creative.assets': 'Materials used to create the project.',
  'creative.delivery': 'Approved work ready to share.',
  'creative.exports': 'Finished files in delivery formats.',
  'creative.archive': 'Past versions kept for reference.',
  'personal.root': 'Organize documents, photos, and everyday projects.',
  'personal.documents': 'Important records and paperwork.',
  'personal.records': 'Personal records and private documents.',
  'personal.household': 'Home records, bills, and maintenance.',
  'personal.photos': 'Photo collections and memories.',
  'personal.current-year': 'Photos from the current year.',
  'personal.projects': 'Personal projects and hobbies.',
  'personal.archive': 'Past versions kept for reference.',
  'web.root': 'Source code, public assets, documentation, and tests.',
  'web.source': 'Application source code.',
  'web.components': 'Reusable interface components.',
  'web.styles': 'Shared styles and design rules.',
  'web.utilities': 'Small reusable helper functions.',
  'web.public': 'Assets served directly to visitors.',
  'web.images': 'Images used by the website.',
  'web.fonts': 'Font files used by the website.',
  'web.docs': 'Project notes and usage guides.',
  'web.tests': 'Automated checks for project behavior.',
  'empty.root': 'The starting point for your folder structure.',
} as const;

export type TemplateCommentKey = keyof typeof templateCommentMessages;

/** Localize a display/export snapshot, never the canonical document or custom notes. */
export function resolveTemplateComments(document: DirectoryDocument, translate: Translator): DirectoryDocument {
  const projection = validateDocument(document);
  function visit(node: FolderNode) {
    const binding = node.commentBinding;
    if (binding?.source === 'folderseed-template' && Object.hasOwn(templateCommentMessages, binding.key)) {
      node.comment = translate(templateCommentMessages[binding.key as TemplateCommentKey]);
    }
    node.children.forEach(visit);
  }
  visit(projection.root);
  return validateDocument(projection);
}
