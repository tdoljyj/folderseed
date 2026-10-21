import { parseIndented } from '../core';
export const templates = [
  { id: 'creative', name: 'Creative project', description: 'From first spark to final delivery', icon: 'spark', text: 'My creative project\n  01 Inspiration\n    References\n    Moodboards\n  02 Work in progress\n    Drafts\n    Assets\n  03 Final delivery\n    Exports\n    Archive' },
  { id: 'personal', name: 'Everyday life', description: 'A home for the everyday', icon: 'home', text: 'My space\n  Documents\n    Personal\n    Household\n  Photos\n    This year\n  Projects\n  Archive' },
  { id: 'web', name: 'Web project', description: 'A simple starting structure', icon: 'code', text: 'My website\n  src\n    components\n    styles\n    utils\n  public\n    images\n    fonts\n  docs\n  tests' },
  { id: 'empty', name: 'Start from scratch', description: 'One folder, endless possibilities', icon: 'plus', text: 'My project' },
] as const;
export const makeTemplate = (index: number) => parseIndented(templates[index].text);
