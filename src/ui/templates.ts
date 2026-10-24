import { parseIndented, validateDocument, type FolderNode } from '../core';
import type { Translator } from './i18n';

export const templates = [
  {
    id: 'creative', name: 'Creative project', description: 'From first spark to final delivery', icon: 'spark',
    text: 'My creative project\n  01 Inspiration\n    References\n    Moodboards\n  02 Work in progress\n    Drafts\n    Assets\n  03 Final delivery\n    Exports\n    Archive',
    comments: [
      'Project ideas, work in progress, and final deliveries.',
      'Collect ideas and visual direction.',
      'Examples and research to guide the project.',
      'Colors, styles, and visual inspiration.',
      'Keep unfinished work together.',
      'Early versions and experiments.',
      'Materials used to create the project.',
      'Approved work ready to share.',
      'Finished files in delivery formats.',
      'Past versions kept for reference.',
    ],
  },
  {
    id: 'personal', name: 'Everyday life', description: 'A home for the everyday', icon: 'home',
    text: 'My space\n  Documents\n    Personal\n    Household\n  Photos\n    This year\n  Projects\n  Archive',
    comments: [
      'Organize documents, photos, and everyday projects.',
      'Important records and paperwork.',
      'Personal records and private documents.',
      'Home records, bills, and maintenance.',
      'Photo collections and memories.',
      'Photos from the current year.',
      'Personal projects and hobbies.',
      'Past versions kept for reference.',
    ],
  },
  {
    id: 'web', name: 'Web project', description: 'A simple starting structure', icon: 'code',
    text: 'My website\n  src\n    components\n    styles\n    utils\n  public\n    images\n    fonts\n  docs\n  tests',
    comments: [
      'Source code, public assets, documentation, and tests.',
      'Application source code.',
      'Reusable interface components.',
      'Shared styles and design rules.',
      'Small reusable helper functions.',
      'Assets served directly to visitors.',
      'Images used by the website.',
      'Font files used by the website.',
      'Project notes and usage guides.',
      'Automated checks for project behavior.',
    ],
  },
  {
    id: 'empty', name: 'Start from scratch', description: 'One folder, endless possibilities', icon: 'plus', text: 'My project',
    comments: ['The starting point for your folder structure.'],
  },
] as const;

/** Comments follow the outline's preorder and become ordinary saved data at creation time. */
export function makeTemplate(index: number, translate: Translator = message => message) {
  const template = templates[index];
  const document = parseIndented(template.text);
  let commentIndex = 0;
  function attachComment(node: FolderNode) {
    node.comment = translate(template.comments[commentIndex++]);
    node.children.forEach(attachComment);
  }
  attachComment(document.root);
  return validateDocument({ version: 2, root: document.root });
}
