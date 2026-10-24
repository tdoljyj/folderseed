import { describe, expect, it, vi } from 'vitest';
import { flatten, parseIndented, parseJSON, serializeJSON } from '../src/core';
import { catalogs, createTranslator, SUPPORTED_LANGUAGES } from '../src/ui/i18n';
import { makeTemplate, templates } from '../src/ui/templates';

const locales = SUPPORTED_LANGUAGES.map(language => language.value);
const commentKeys = [...new Set(templates.flatMap(template => [...template.comments]))];

describe('descriptive template comments', () => {
  it('provides exactly one meaningful comment per folder, including every root', () => {
    expect(commentKeys).toHaveLength(28);
    expect(templates.reduce((count, template) => count + template.comments.length, 0)).toBe(29);
    for (const [index, template] of templates.entries()) {
      const rows = flatten(makeTemplate(index));
      expect(rows).toHaveLength(template.comments.length);
      expect(rows.map(row => row.node.comment)).toEqual(template.comments);
      expect(rows.every(row => !!row.node.comment?.trim())).toBe(true);
      expect(rows.map(row => row.path)).toEqual(flatten(parseIndented(template.text)).map(row => row.path));
    }
    expect(makeTemplate(3).root.children).toEqual([]);
    expect(makeTemplate(3).root.comment).toBe('The starting point for your folder structure.');
  });

  it.each(locales)('creates all four templates with %s comments without translating folder names', locale => {
    const translate = createTranslator(locale);
    for (const [index, template] of templates.entries()) {
      const document = makeTemplate(index, translate);
      const rows = flatten(document);
      const expectedNames = flatten(parseIndented(template.text)).map(row => row.node.name);
      expect(rows.map(row => row.node.name)).toEqual(expectedNames);
      expect(rows.map(row => row.node.comment)).toEqual(template.comments.map(key => translate(key)));
      expect(rows.every(row => typeof row.node.comment === 'string' && row.node.comment.length > 0 && [...row.node.comment].length <= 500)).toBe(true);
      const wire = serializeJSON(document);
      expect(JSON.parse(wire).version).toBe(2);
      expect(parseJSON(wire)).toEqual(document);
      for (const key of template.comments) {
        expect(Object.hasOwn(catalogs[locale], key), key).toBe(true);
        if (locale !== 'en') expect(translate(key), key).not.toBe(key);
      }
    }
  });

  it('translates only template comment metadata once, never folder names or existing data', () => {
    const translate = vi.fn(createTranslator('fr'));
    const document = makeTemplate(0, translate);
    expect(translate.mock.calls.map(([key]) => key)).toEqual(templates[0].comments);
    const saved = serializeJSON(document);
    makeTemplate(0, createTranslator('ja'));
    expect(serializeJSON(document)).toBe(saved);
    const restored = parseJSON(saved);
    expect(flatten(restored).map(row => row.node.comment)).toEqual(flatten(document).map(row => row.node.comment));
    // A user comment that happens to be a UI key is still plain saved content.
    restored.root.comment = 'Folder name';
    const persisted = serializeJSON(restored);
    makeTemplate(0, createTranslator('ar'));
    expect(parseJSON(persisted).root.comment).toBe('Folder name');
    expect(translate).toHaveBeenCalledTimes(templates[0].comments.length);
  });

  it('creates fresh independent nodes and never changes the original template outlines', () => {
    const originalOutline = templates[0].text;
    const first = makeTemplate(0);
    const second = makeTemplate(0);
    expect(first.root).not.toBe(second.root);
    expect(first.root.id).not.toBe(second.root.id);
    first.root.comment = 'Custom note';
    first.root.children[0].name = 'Custom folder';
    expect(second.root.comment).toBe(templates[0].comments[0]);
    expect(second.root.children[0].name).toBe('01 Inspiration');
    expect(templates[0].text).toBe(originalOutline);
  });

  it('validates creation-time translations instead of allowing unsafe comment data', () => {
    expect(() => makeTemplate(0, () => 'Line one\nLine two')).toThrow('Folder comments must be one line without control characters or invalid Unicode.');
    expect(() => makeTemplate(0, () => 'x'.repeat(501))).toThrow('Folder comments cannot exceed 500 characters.');
  });
});
