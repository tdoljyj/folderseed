import { describe, expect, it } from 'vitest';
import {
  addFolder, createDocument, documentContentEqual, flatten, formatText, moveFolder, parseJSON, parseText,
  renameFolder, serializeJSON, type DirectoryDocument,
} from '../src/core';
import { finishCommentEdit, hasCommentBindings, literalCommentSnapshot, presentTextDraft, reconcileTextSnapshot, restoreDraftLocale } from '../src/ui/commentPresentation';
import { createTranslator, SUPPORTED_LANGUAGES, type Locale } from '../src/ui/i18n';
import { historyReducer, type HistoryState } from '../src/ui/history';
import { makeTemplate } from '../src/ui/templates';
import { resolveTemplateComments } from '../src/ui/templateComments';
import { createExport } from '../src/exports';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const project = (document: DirectoryDocument, locale: Locale) => resolveTemplateComments(document, createTranslator(locale));
const formats = ['plain', 'markdown', 'ascii', 'unicode'] as const;

describe('comment presentation and explicit editing policy', () => {
  it('strips every binding only from an independent literal snapshot', () => {
    const canonical = deepFreeze(makeTemplate(0));
    const snapshot = literalCommentSnapshot(project(canonical, 'ja'));
    expect(hasCommentBindings(canonical)).toBe(true);
    expect(hasCommentBindings(snapshot)).toBe(false);
    expect(flatten(snapshot).map(({ node }) => node.comment)).toEqual(flatten(project(canonical, 'ja')).map(({ node }) => node.comment));
    expect(snapshot.root.id).toBe(canonical.root.id);
    expect(snapshot.root).not.toBe(canonical.root);
  });

  it.each(SUPPORTED_LANGUAGES.map(({ value }) => value))('keeps canonical storage, history and document identity unchanged for %s display', locale => {
    const canonical = deepFreeze(makeTemplate(0));
    const history: HistoryState = deepFreeze({ past: [], present: canonical, future: [] });
    const before = serializeJSON(canonical);
    const raw = formatText(canonical, 'plain', 4);
    const view = presentTextDraft(canonical, project(canonical, locale), raw, 'en', locale, 'plain', false, false);
    expect(view.text).toBe(formatText(project(canonical, locale), 'plain', 4));
    expect(serializeJSON(history.present)).toBe(before);
    expect(history.present).toBe(canonical);
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
  });

  it.each(formats)('%s exact unchanged localized content retains canonical IDs and bindings', format => {
    const canonical = deepFreeze(makeTemplate(0));
    const baseline = project(canonical, 'zh-CN');
    const raw = formatText(baseline, format, 4);
    const parsed = parseText(raw, format);
    expect(parsed.root.id).not.toBe(canonical.root.id);
    expect(reconcileTextSnapshot(canonical, parsed, baseline)).toBe(canonical);
    expect(hasCommentBindings(canonical)).toBe(true);
  });

  it('preserves bindings for whitespace-only source edits with identical parsed content', () => {
    const canonical = makeTemplate(0);
    const baseline = project(canonical, 'fr');
    const formatted = formatText(baseline, 'plain', 4);
    const parsed = parseText(`\n${formatted}\n\n`, 'plain');
    expect(reconcileTextSnapshot(canonical, parsed, baseline)).toBe(canonical);
  });

  it('compares a pending draft against its authored locale, not the new UI language', () => {
    const canonical = makeTemplate(3);
    const authored = project(canonical, 'ja');
    const raw = formatText(authored, 'plain', 4);
    const shown = presentTextDraft(canonical, project(canonical, 'de'), raw, 'ja', 'de', 'plain', true, false);
    expect(shown).toEqual({ text: raw, locale: 'ja' });
    expect(reconcileTextSnapshot(canonical, parseText(raw, 'plain'), project(canonical, restoreDraftLocale('ja')))).toBe(canonical);
  });

  it.each([
    { dirty: true, composing: false, raw: 'Root\n   broken indent' },
    { dirty: true, composing: true, raw: 'Root // unfinished composition' },
    { dirty: false, composing: true, raw: 'in-progress IME bytes' },
  ])('never rewrites a pending/composing raw draft ($dirty/$composing)', ({ dirty, composing, raw }) => {
    const canonical = makeTemplate(0);
    const shown = presentTextDraft(canonical, project(canonical, 'ar'), raw, 'ja', 'ar', 'plain', dirty, composing);
    expect(shown).toEqual({ text: raw, locale: 'ja' });
  });

  it('pins the currently displayed localized value before composition starts', () => {
    const canonical = makeTemplate(3);
    const storedRaw = formatText(canonical, 'plain', 4);
    const beforeComposition = presentTextDraft(canonical, project(canonical, 'zh-CN'), storedRaw, 'en', 'zh-CN', 'plain', false, false);
    expect(beforeComposition.text).not.toBe(storedRaw);
    // The composition-start handler snapshots currentTarget.value and this exact locale.
    const composing = presentTextDraft(canonical, project(canonical, 'ja'), beforeComposition.text, beforeComposition.locale, 'ja', 'plain', true, true);
    expect(composing.text).toBe(beforeComposition.text);
    expect(composing.locale).toBe('zh-CN');
    const unchanged = parseText(composing.text, 'plain');
    expect(reconcileTextSnapshot(canonical, unchanged, project(canonical, composing.locale))).toBe(canonical);
  });

  it('keeps user formatting when its clean draft is already in the current locale', () => {
    const canonical = makeTemplate(0);
    const raw = '\n' + formatText(project(canonical, 'fr'), 'plain', 'tabs') + '\n';
    expect(presentTextDraft(canonical, project(canonical, 'fr'), raw, 'fr', 'fr', 'plain', false, false).text).toBe(raw);
  });

  it('turns a substantive folder-name text edit into one literal localized snapshot', () => {
    const canonical = deepFreeze(makeTemplate(0));
    const baseline = project(canonical, 'ja');
    const parsed = parseText(formatText(baseline, 'plain', 4), 'plain');
    parsed.root.name = 'Custom project';
    const next = reconcileTextSnapshot(canonical, parsed, baseline);
    expect(next).not.toBe(canonical);
    expect(next.root.name).toBe('Custom project');
    expect(hasCommentBindings(next)).toBe(false);
    expect(flatten(next).map(({ node }) => node.comment)).toEqual(flatten(baseline).map(({ node }) => node.comment));
    expect(project(next, 'de')).toEqual(next);
    const history = historyReducer({ past: [], present: canonical, future: [] }, { type: 'commit', document: next });
    expect(history.past).toHaveLength(1);
    expect(historyReducer(history, { type: 'undo' }).present).toBe(canonical);
  });

  it('does not preserve a binding when comment text changes by even one character', () => {
    const canonical = makeTemplate(3);
    const baseline = project(canonical, 'fr');
    const parsed = parseText(formatText(baseline, 'plain', 4), 'plain');
    parsed.root.comment += ' ';
    const next = reconcileTextSnapshot(canonical, parsed, baseline);
    expect(hasCommentBindings(next)).toBe(false);
    expect(next.root.comment).toBe(parsed.root.comment);
  });

  it('does not infer template bindings for legacy or custom comments with identical wording', () => {
    const template = makeTemplate(3);
    for (const version of [1, 2]) {
      const legacy = parseJSON(JSON.stringify({ version, root: { ...template.root, commentBinding: undefined } }));
      const raw = formatText(legacy, 'plain', 4);
      const next = reconcileTextSnapshot(legacy, parseText(raw, 'plain'), project(legacy, 'fr'));
      expect(next).toBe(legacy);
      expect(hasCommentBindings(next)).toBe(false);
      expect(presentTextDraft(next, project(next, 'zh-CN'), raw, 'en', 'zh-CN', 'plain', false, false).text).toBe(raw);
    }
  });

  it('preserves an explicit unknown binding only for exact unchanged content', () => {
    const canonical = makeTemplate(3);
    canonical.root.commentBinding = { source: 'folderseed-template', key: 'unknown.future-key' };
    canonical.root.comment = 'A custom fallback';
    const baseline = project(canonical, 'fr');
    expect(baseline.root.comment).toBe('A custom fallback');
    expect(reconcileTextSnapshot(canonical, parseText(formatText(baseline, 'plain'), 'plain'), baseline)).toBe(canonical);
    const detached = finishCommentEdit(canonical, canonical.root.id, baseline.root.comment!, false, true);
    expect(detached.root.commentBinding).toBeUndefined();
  });

  it('opening and untouched blur keep the binding without history or localized fallback writes', () => {
    const canonical = deepFreeze(makeTemplate(3));
    const shown = project(canonical, 'zh-CN').root.comment!;
    expect(shown).not.toBe(canonical.root.comment);
    expect(finishCommentEdit(canonical, canonical.root.id, shown, false, false)).toBe(canonical);
    expect(hasCommentBindings(canonical)).toBe(true);
  });

  it.each([
    { touched: false, explicit: true },
    { touched: true, explicit: true },
    { touched: true, explicit: false },
  ])('explicit Save/Enter or touched blur detaches identical displayed text ($touched/$explicit)', ({ touched, explicit }) => {
    const canonical = deepFreeze(makeTemplate(3));
    for (const locale of ['en', 'zh-CN'] as const) {
      const shown = project(canonical, locale).root.comment!;
      const next = finishCommentEdit(canonical, canonical.root.id, shown, touched, explicit);
      expect(next).not.toBe(canonical);
      expect(next.root.commentBinding).toBeUndefined();
      expect(next.root.comment).toBe(shown);
      expect(documentContentEqual(canonical, next)).toBe(false);
      expect(project(next, 'ja').root.comment).toBe(shown);
      const history = historyReducer({ past: [], present: canonical, future: [] }, { type: 'commit', document: next });
      expect(historyReducer(history, { type: 'undo' }).present).toBe(canonical);
    }
  });

  it('rejects an invalid touched comment without changing canonical metadata', () => {
    const canonical = deepFreeze(makeTemplate(3));
    expect(() => finishCommentEdit(canonical, canonical.root.id, 'invalid\ncomment', true, false)).toThrow();
    expect(hasCommentBindings(canonical)).toBe(true);
  });

  it('saving unchanged custom text is a no-op, and clearing a bound comment detaches it', () => {
    const custom = createDocument('Custom');
    custom.root.comment = 'My note';
    expect(finishCommentEdit(custom, custom.root.id, 'My note', true, true)).toBe(custom);
    const bound = makeTemplate(3);
    const cleared = finishCommentEdit(bound, bound.root.id, '', true, true);
    expect(cleared.root.comment).toBeUndefined();
    expect(cleared.root.commentBinding).toBeUndefined();
  });

  it('rename and move retain semantic bindings without using the folder names as keys', () => {
    const canonical = makeTemplate(0);
    const moving = canonical.root.children[0];
    const destination = canonical.root.children[1];
    const next = moveFolder(renameFolder(canonical, moving.id, 'Renamed'), moving.id, destination.id);
    const projected = flatten(project(next, 'ja')).find(({ node }) => node.id === moving.id)!.node;
    expect(projected.name).toBe('Renamed');
    expect(projected.commentBinding).toEqual(moving.commentBinding);
    expect(projected.comment).toBe(createTranslator('ja')(moving.comment!));
  });

  it('adding any new text node is substantive even when all existing comments match', () => {
    const canonical = makeTemplate(3);
    const baseline = project(canonical, 'fr');
    const withChild = addFolder(literalCommentSnapshot(baseline), baseline.root.id, 'New');
    const next = reconcileTextSnapshot(canonical, withChild, baseline);
    expect(hasCommentBindings(next)).toBe(false);
    expect(next.root.children[0].name).toBe('New');
  });

  it('exports the current literal locale for text and the original binding for JSON', async () => {
    const canonical = makeTemplate(3);
    const projection = project(canonical, 'fr');
    const saved = serializeJSON(canonical);
    const txt = await createExport(projection, 'txt');
    const fromText = parseText(await txt.blob.text(), 'plain');
    expect(fromText.root.comment).toBe(projection.root.comment);
    expect(fromText.root.commentBinding).toBeUndefined();
    const json = await createExport(canonical, 'json');
    expect(JSON.parse(await json.blob.text()).version).toBe(3);
    expect(parseJSON(await json.blob.text())).toEqual(canonical);
    expect(serializeJSON(canonical)).toBe(saved);
  });

  it('accepts only explicit supported draft locales and never guesses from content', () => {
    expect(restoreDraftLocale('zh-CN')).toBe('zh-CN');
    for (const value of [undefined, null, 'auto', 'zh', 'unknown', 1, {}]) expect(restoreDraftLocale(value)).toBe('en');
  });
});
