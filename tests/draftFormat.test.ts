import { describe, expect, it } from 'vitest';
import { parseText } from '../src/core';
import { restoreTextFormat } from '../src/ui/draftFormat';

const document = parseText('Root\n    Child', 'plain');

describe('legacy text-format restoration', () => {
  it.each([
    ['plain', 'Root\n  Child'],
    ['markdown', '- Root\n  - Child'],
    ['ascii', 'Root\n`-- Child'],
    ['unicode', 'Root\n└── Child'],
    ['markdown', '```text\nRoot\n└── Child\n```'],
  ] as const)('resolves a matching legacy source to %s without changing its structure', (format, raw) => {
    expect(restoreTextFormat('auto', raw, document, false, 'auto')).toBe(format);
  });

  it('preserves literal punctuation using the committed model as authority', () => {
    const raw = '- Root\n  Child';
    expect(restoreTextFormat('auto', raw, parseText(raw, 'plain'), false, 'auto')).toBe('plain');
  });

  it('resolves valid pending automatic input against its pending tree, not the older model', () => {
    expect(restoreTextFormat('auto', '- New root\n  - Child', document, true, 'auto')).toBe('markdown');
  });

  it.each(['', '- Root\n  Child', 'Root\n  Good\n     Invalid'])('keeps invalid pending automatic input under its old rule: %j', raw => {
    expect(restoreTextFormat('auto', raw, document, true, 'auto')).toBe('auto');
  });

  it('keeps explicit legacy indentation errors instead of guessing away a skipped level', () => {
    expect(restoreTextFormat('auto', 'Root\n    Child', document, true, 2)).toBe('auto');
  });

  it('does not reinterpret an explicitly chosen format', () => {
    expect(restoreTextFormat('markdown', 'unfinished', document, true, 'auto')).toBe('markdown');
  });

  it('uses plain text when no saved source exists', () => {
    expect(restoreTextFormat('auto', null, document, false, 'auto')).toBe('plain');
  });
});
