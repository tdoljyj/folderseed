import { formatIndented, parseText, type DirectoryDocument, type ParseIndent, type TextFormat } from '../core';

export type ExplicitTextFormat = Exclude<TextFormat, 'auto'>;

const formats: ExplicitTextFormat[] = ['plain', 'markdown', 'ascii', 'unicode'];

/** Migrate legacy automatic parsing only when an explicit parser preserves the same tree. */
export function restoreTextFormat(value: unknown, draft: string | null, document: DirectoryDocument, pending: boolean, indent: ParseIndent): TextFormat {
  if (formats.includes(value as ExplicitTextFormat)) return value as ExplicitTextFormat;
  if (draft === null) return 'plain';
  try {
    const expected = formatIndented(pending ? parseText(draft, 'auto', indent) : document);
    for (const format of formats) {
      try { if (formatIndented(parseText(draft, format, indent)) === expected) return format; }
      catch { /* Another explicit format may preserve this source. */ }
    }
  } catch { /* Keep malformed legacy drafts under their original parsing rule. */ }
  return 'auto';
}
