import { describe, expect, it, vi } from 'vitest';
import { documentContentEqual, flatten, parseIndented, parseJSON, renameFolder, serializeJSON, setFolderComment, type DirectoryDocument } from '../src/core';
import { catalogs, createTranslator, SUPPORTED_LANGUAGES } from '../src/ui/i18n';
import { makeTemplate, templates } from '../src/ui/templates';
import { resolveTemplateComments, templateCommentMessages } from '../src/ui/templateComments';

const locales = SUPPORTED_LANGUAGES.map(language => language.value);
const originalOutlines = [
  'My creative project\n  01 Inspiration\n    References\n    Moodboards\n  02 Work in progress\n    Drafts\n    Assets\n  03 Final delivery\n    Exports\n    Archive',
  'My space\n  Documents\n    Personal\n    Household\n  Photos\n    This year\n  Projects\n  Archive',
  'My website\n  src\n    components\n    styles\n    utils\n  public\n    images\n    fonts\n  docs\n  tests',
  'My project',
];
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('canonical template comments and stable bindings', () => {
  it('provides a descriptive canonical comment and a unique semantic binding for every folder', () => {
    expect(Object.keys(templateCommentMessages)).toHaveLength(29);
    expect(new Set(Object.values(templateCommentMessages)).size).toBe(28);
    expect(templates.map(template => template.text)).toEqual(originalOutlines);
    const allBindings: string[] = [];
    for (const [index, template] of templates.entries()) {
      const document = makeTemplate(index);
      const rows = flatten(document);
      expect(rows).toHaveLength(template.comments.length);
      expect(rows.map(row => row.node.comment)).toEqual(template.comments);
      expect(rows.map(row => row.path)).toEqual(flatten(parseIndented(template.text)).map(row => row.path));
      for (const { node } of rows) {
        expect(node.comment?.trim()).toBeTruthy();
        expect(node.commentBinding?.source).toBe('folderseed-template');
        expect(node.commentBinding?.key).toMatch(new RegExp(`^${template.id}\\.[a-z][a-z-]*$`));
        allBindings.push(node.commentBinding!.key);
      }
      expect(JSON.parse(serializeJSON(document)).version).toBe(3);
      expect(parseJSON(serializeJSON(document))).toEqual(document);
    }
    expect(new Set(allBindings).size).toBe(29);
    expect(makeTemplate(3).root.children).toEqual([]);
    expect(makeTemplate(3).root.commentBinding?.key).toBe('empty.root');
    expect(makeTemplate(0).root.children[0].children[1].commentBinding?.key).toBe('creative.moodboards');
    expect(makeTemplate(1).root.children[1].children[0].commentBinding?.key).toBe('personal.current-year');
    expect(makeTemplate(2).root.children[0].children[0].commentBinding?.key).toBe('web.components');
  });

  it.each(locales)('creates locale-independent canonical data and a separate %s projection', locale => {
    const translate = vi.fn(createTranslator(locale));
    for (const [index, template] of templates.entries()) {
      translate.mockClear();
      const document = makeTemplate(index, translate);
      expect(translate).not.toHaveBeenCalled();
      expect(flatten(document).map(row => row.node.comment)).toEqual(template.comments);
      const before = serializeJSON(document);
      deepFreeze(document);
      const projected = resolveTemplateComments(document, translate);
      expect(projected).not.toBe(document);
      expect(projected.root).not.toBe(document.root);
      expect(flatten(projected).map(row => row.node.name)).toEqual(flatten(document).map(row => row.node.name));
      expect(flatten(projected).map(row => row.node.id)).toEqual(flatten(document).map(row => row.node.id));
      expect(flatten(projected).map(row => row.node.commentBinding)).toEqual(flatten(document).map(row => row.node.commentBinding));
      expect(flatten(projected).map(row => row.node.comment)).toEqual(template.comments.map(key => createTranslator(locale)(key)));
      expect(translate.mock.calls.map(([key]) => key)).toEqual(template.comments);
      expect(serializeJSON(document)).toBe(before);
      for (const key of template.comments) {
        expect(Object.hasOwn(catalogs[locale], key), key).toBe(true);
        if (locale !== 'en') expect(createTranslator(locale)(key), key).not.toBe(key);
      }
    }
  });

  it('changes projected language immediately without writing saved fallback data', () => {
    const document = makeTemplate(0);
    const saved = serializeJSON(document);
    const french = resolveTemplateComments(document, createTranslator('fr'));
    const japanese = resolveTemplateComments(document, createTranslator('ja'));
    expect(french.root.comment).not.toBe(japanese.root.comment);
    expect(serializeJSON(document)).toBe(saved);
    const restored = parseJSON(saved);
    expect(resolveTemplateComments(restored, createTranslator('ar')).root.comment).toBe(createTranslator('ar')(templateCommentMessages['creative.root']));
    expect(documentContentEqual(document, restored)).toBe(true);
  });

  it('uses semantic bindings after renaming or reordering, never folder name or fallback-text inference', () => {
    const document = makeTemplate(0);
    const moodboards = document.root.children[0].children[1];
    const renamed = renameFolder(document, moodboards.id, 'User-defined folder');
    renamed.root.children.reverse();
    const renamedMoodboards = flatten(renamed).find(row => row.node.id === moodboards.id)!.node;
    renamedMoodboards.comment = 'A different fallback for this known key';
    const projected = resolveTemplateComments(renamed, createTranslator('zh-CN'));
    const translated = flatten(projected).find(row => row.node.id === moodboards.id)!.node;
    expect(translated.name).toBe('User-defined folder');
    expect(translated.comment).toBe(createTranslator('zh-CN')(templateCommentMessages['creative.moodboards']));
    expect(renamedMoodboards.comment).toBe('A different fallback for this known key');
  });

  it('does not infer bindings for imported text, old JSON, or comments identical to template phrases', () => {
    const phrase = templateCommentMessages['creative.root'];
    const plain = parseIndented(`My creative project // ${phrase}`);
    const older = parseJSON(JSON.stringify({ version: 2, root: plain.root }));
    const translator = vi.fn(createTranslator('ja'));
    for (const document of [plain, older]) {
      expect(resolveTemplateComments(document, translator)).toEqual(document);
      expect(document.root.commentBinding).toBeUndefined();
    }
    expect(translator).not.toHaveBeenCalled();
  });

  it.each(['future.comment', 'constructor', 'toString', 'hasOwnProperty'])('preserves unknown binding %s and its fallback without translating it', key => {
    const document = makeTemplate(3);
    document.root.commentBinding = { source: 'folderseed-template', key };
    document.root.comment = 'User fallback {name} $&';
    const translate = vi.fn(createTranslator('ar'));
    expect(resolveTemplateComments(document, translate)).toEqual(document);
    expect(translate).not.toHaveBeenCalled();
    expect(parseJSON(serializeJSON(document))).toEqual(document);
  });

  it('keeps edited comments custom even if they equal a translated or canonical template phrase', () => {
    const document = makeTemplate(3);
    for (const comment of ['My custom note', 'Folder name', document.root.comment!, createTranslator('fr')(document.root.comment!)]) {
      const custom = setFolderComment(document, document.root.id, comment);
      expect(custom.root.commentBinding).toBeUndefined();
      expect(resolveTemplateComments(custom, createTranslator('ja')).root.comment).toBe(comment);
      expect(document.root.commentBinding?.key).toBe('empty.root');
    }
  });

  it('creates independent nodes without changing template outlines or registry entries', () => {
    const first = makeTemplate(0);
    const second = makeTemplate(0);
    expect(first.root.id).not.toBe(second.root.id);
    expect(documentContentEqual(first, second)).toBe(true);
    first.root.comment = 'Custom fallback';
    first.root.children[0].name = 'Custom folder';
    expect(second.root.comment).toBe(templateCommentMessages['creative.root']);
    expect(second.root.children[0].name).toBe('01 Inspiration');
    expect(templates.map(template => template.text)).toEqual(originalOutlines);
  });

  it('validates projection data and rejects unsafe translations without mutating canonical data', () => {
    const document = makeTemplate(0);
    const before = serializeJSON(document);
    expect(() => resolveTemplateComments(document, () => 'Line one\nLine two')).toThrow('Folder comments must be one line without control characters or invalid Unicode.');
    expect(() => resolveTemplateComments(document, () => 'x'.repeat(501))).toThrow('Folder comments cannot exceed 500 characters.');
    expect(serializeJSON(document)).toBe(before);
    expect(() => resolveTemplateComments({ version: 1, root: { ...document.root, commentBinding: { source: 'other', key: 'creative.root' } } } as unknown as DirectoryDocument, createTranslator('fr'))).toThrow('Template comment bindings need a valid source, key, and nonempty fallback comment.');
  });
});
