# Contributing to FolderSeed

Thanks for helping make folder planning easier.

## Development setup

Use Node.js 22.12 or later and npm. CI uses Node.js 24.

```sh
npm ci
npm run dev
```

Before submitting a change:

```sh
npm test
npm run build:all
npx playwright install chromium
npm run test:e2e
```

Or, after installing the browser, run `npm run check`.

## Project boundaries

- `src/core/`: framework-independent document model, validation, parsing, and immutable operations.
- `src/exports/`: in-memory archive, text, JSON, and image exports.
- `src/ui/`: reusable React editor and scoped styles.
- `tests/`: automated checks.
- `examples/`: integration examples.

Keep the core independent of the DOM and UI framework. Do not add a backend, analytics, remote fonts, account system, filesystem write access, or script execution without discussing the scope first.

## What a good change includes

1. A focused explanation of the problem and the intended behavior.
2. Tests for the behavior, including invalid input and interrupted or repeated flows where relevant.
3. Documentation updates for changed APIs, limits, or user-facing behavior.
4. Screenshots for visible UI changes, with narrow and wide layouts checked.
5. Honest verification notes: distinguish tests that passed from checks that were not run.

Preserve 2-space, 4-space, and tab indentation during parsing. Cover plain outlines, Markdown lists, ASCII trees, Unicode trees, and fenced text with round-trip tests. Automatic detection must not silently flatten an invalid tree; explicit format selection must remain available for ambiguous input. Treat imported JSON, text, and folder names as untrusted input. Never bypass the document validator to make an export succeed.

Text-editor changes must preserve these guarantees:

- Valid edits commit after the 350 ms quiet period without reformatting raw text or moving the cursor.
- Input-method composition does not commit an unfinished value.
- Invalid edits retain their text and the last valid model; only an explicit revert may discard them.
- Export, copy, and visual-mode actions flush valid pending changes instead of using stale state.
- Reload restores raw text, format, and the last valid document, including invalid drafts and their legacy parsing rules.
- Generated editor text, the Tab key, and TXT/Markdown-list downloads use four spaces; pasted/imported two-space and tab outlines remain supported without a visible indentation setting.
- Undo/redo groups typing bursts and does not leave stale timers that overwrite newer changes.

Test rapid edits, immediate export, independent format-label/menu-arrow clicks, menu keyboard navigation and dismissal, and reopening the same format from visual mode, invalid drafts, composition events, reloads, and undo/redo around pending updates. Browser tests should check actual download contents as well as the visible preview. For drag changes, cover real top/center/bottom row drops, same-parent index adjustment, cross-parent subtrees, bottom-edge horizontal outdenting at valid ancestor boundaries, collapsed trees and trailing whitespace, straight-down full-width ancestor bands at left/center/right pointer positions, drag cancellation and deep-band scrolling, cycles, undo, and visible insertion lines at each depth; preserve the Move dialog and selected-row actions as non-drag alternatives. Selected-row changes must cover all eight actions, root/first-sibling/depth restrictions, sibling insertion immediately after selection, child expansion, subtree-preserving indent/outdent, drag footprint stability, restored keyboard focus, and wide/narrow light/dark screenshots with touch-sized controls. Assert positions against the actual folder glyph and displayed name: up/down above/below the glyph, outdent to its left, Rename above the name, both Add controls below it, and indent/Delete to its right. Preserve this arrangement on mobile, verify non-overlapping targets and neighboring rows, and freeze the selected frame during native drags rather than moving the controls into a detached toolbar. Document history shortcuts must remain scoped to the editor and leave native input/contenteditable undo, dialogs, IME, and unrelated host controls untouched.

Keep all public documentation, comments, UI copy, issue templates, and commit messages in English. Unicode folder names and internationalization test fixtures are welcome.

## Issues and pull requests

Before opening a large pull request, open an issue describing the use case. For a bug, include the browser/OS, the smallest safe sample that reproduces it, expected behavior, and actual behavior. Remove personal directory names from shared examples.

Do not commit `node_modules/`, `dist/`, `dist-lib/`, local browser profiles, screenshots containing personal information, credentials, or generated test reports.

## License

Contributions are provided under the repository's MIT license. Only include code and assets you have permission to contribute; preserve required third-party notices.
