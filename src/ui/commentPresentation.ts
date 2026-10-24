import {
  documentContentEqual,
  flatten,
  formatText,
  setFolderComment,
  validateDocument,
  type DirectoryDocument,
  type FolderNode,
  type Indent,
  type TextFormat,
  type TextFormatOptions,
} from '../core';
import { isLanguagePreference, type Locale } from './i18n';

/** Draft provenance is explicit metadata, never inferred from comment wording. */
export function restoreDraftLocale(value: unknown): Locale {
  return isLanguagePreference(value) && value !== 'auto' ? value : 'en';
}

export function hasCommentBindings(document: DirectoryDocument): boolean {
  return flatten(document).some(({ node }) => node.commentBinding !== undefined);
}

/** Text formats carry literal localized notes, not reusable template bindings. */
export function literalCommentSnapshot(document: DirectoryDocument): DirectoryDocument {
  const snapshot = validateDocument(document);
  function visit(node: FolderNode) { delete node.commentBinding; node.children.forEach(visit); }
  visit(snapshot.root);
  return snapshot;
}

/**
 * Preserve the canonical model only when the full parsed content is unchanged
 * from the exact projection that was shown when this typing burst began.
 * A substantive text edit creates a fully literal snapshot; no fuzzy matching.
 */
export function reconcileTextSnapshot(
  canonical: DirectoryDocument,
  parsed: DirectoryDocument,
  baseline: DirectoryDocument,
): DirectoryDocument {
  const literal = literalCommentSnapshot(parsed);
  return documentContentEqual(literalCommentSnapshot(baseline), literal) ? canonical : literal;
}

/** Merely opening or leaving a comment editor is not a customization action. */
export function finishCommentEdit(
  canonical: DirectoryDocument,
  id: string,
  value: string,
  touched: boolean,
  explicitSave: boolean,
): DirectoryDocument {
  if (!touched && !explicitSave) return canonical;
  const next = setFolderComment(canonical, id, value);
  return documentContentEqual(canonical, next) ? canonical : next;
}

/** Derived display only: never rewrite a pending/composing draft or persisted state. */
export function presentTextDraft(
  canonical: DirectoryDocument,
  projection: DirectoryDocument,
  draft: string,
  authoredLocale: Locale,
  currentLocale: Locale,
  format: Exclude<TextFormat, 'auto'>,
  dirty: boolean,
  composing: boolean,
  indent: Indent = 4,
  options: TextFormatOptions = {},
): { text: string; locale: Locale } {
  const localize = hasCommentBindings(canonical) && !dirty && !composing && authoredLocale !== currentLocale;
  return localize
    ? { text: formatText(projection, format, indent, options), locale: currentLocale }
    : { text: draft, locale: authoredLocale };
}
