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

Test rapid edits, immediate export, independent format-label/menu-arrow clicks, menu keyboard navigation and dismissal, and reopening the same format from visual mode, invalid drafts, composition events, reloads, and undo/redo around pending updates. Browser tests should check actual download contents as well as the visible preview. For drag changes, cover real top/center/bottom row drops, same-parent index adjustment, cross-parent subtrees, bottom-edge horizontal outdenting at valid ancestor boundaries, collapsed trees and trailing whitespace, straight-down full-width ancestor bands at left/center/right pointer positions, drag cancellation and deep-band scrolling, cycles, undo, and visible insertion lines at each depth; preserve the Move dialog and selected-row actions as non-drag alternatives. Selected-row changes must distinguish no selection from immediate eight-action selection, without an Edit/Close gate. Cover Escape and genuine blank-area dismissal, protected controls/dialogs/row padding, keyboard history after deselection, switching rows, fresh/reloaded/imported/template states, compact short-name spacing, and all eight actions, root/first-sibling/depth restrictions, sibling insertion immediately after selection, child expansion, subtree-preserving indent/outdent, drag footprint stability, restored keyboard focus, and wide/narrow light/dark screenshots with floating controls (16 px action SVGs, uniform 24 × 24 px buttons, 68 px overlay height and unchanged 34 px rows). Assert positions against the actual folder glyph and displayed name: up/down above/below the glyph, outdent to its left, Rename above the name, both Add controls below it, and indent/Delete to its right. Preserve this arrangement on mobile. Compare actual glyph/name X and Y coordinates before selection, after selection, after switching rows, and after deselection, including root, collapsed/long-name folders, and every supported depth. Measure both tree-content coordinates to distinguish scrolling from a layout shift, and assert all row positions, list height, editor/preview panel dimensions, reserved footer height, and export section position remain unchanged; deep rows must scroll locally rather than clamp their indentation. Neighbor occlusion is intentional, but action targets must not overlap one another. Use real pointer clicks and hit-testing to prove covered-row clicks reach the action, root/bottom controls are not clipped, and controls follow scrolling or hide when the anchor is offscreen. Freeze the action owner during native drags while keeping the row geometry fixed. Document history shortcuts must remain scoped to the editor and leave native input/contenteditable undo, dialogs, IME, and unrelated host controls untouched.

Inline naming tests must cover Enter, valid blur, Escape and Cancel editing, invalid/duplicate names with focus restoration, IME composition, unchanged descendants, one-step undo/redo, and autosave. An uncommitted add placeholder must not enter the document, preview, callbacks, or undo history.

Language changes must cover browser preference order and regional aliases, live Automatic updates, explicit preference persistence, custom/disabled storage, invalid-draft preservation, all twelve choices, scoped Arabic RTL, and narrow-screen screenshots. Never translate user folder names or exported data. Keep original English message keys and catalog coverage aligned, and preserve native option names so users can recover from an accidental language choice.

Keep public documentation, comments, issue templates, and commit messages in English. UI translations belong in the locale catalogs; Unicode folder names and internationalization fixtures are welcome.

## Issues and pull requests

Before opening a large pull request, open an issue describing the use case. For a bug, include the browser/OS, the smallest safe sample that reproduces it, expected behavior, and actual behavior. Remove personal directory names from shared examples.

Do not commit `node_modules/`, `dist/`, `dist-lib/`, local browser profiles, screenshots containing personal information, credentials, or generated test reports.

## License

Contributions are provided under the repository's MIT license. Only include code and assets you have permission to contribute; preserve required third-party notices.
