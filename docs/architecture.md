# Architecture

FolderSeed separates the folder model from the editor and from the standalone page. The repository builds both a standalone app and reusable ESM modules with declarations. No npm package has been published.

## Data model

```ts
interface FolderNode {
  id: string;
  name: string;
  children: FolderNode[];
}

interface DirectoryDocument {
  version: 1;
  root: FolderNode;
}
```

There is one root. Every node is a folder. An empty `children` array represents an empty folder, not a missing file. Sibling order is meaningful and retained by JSON, text, previews, and exports.

Version `1` is explicit. Unknown versions are rejected rather than guessed or migrated silently. Validation returns a clean copy and discards unrecognized object properties. IDs are unique within a document and are preserved by JSON round-trips; parsing a text outline creates fresh IDs.

## Core (`src/core/index.ts`)

The core uses only standard JavaScript APIs. It does not require a UI framework, DOM, filesystem, server, or network.

### Creation and validation

- `createDocument(rootName?)`
- `validateName(value, line?)`
- `validateDocument(input)`
- `DirectoryError`: an error with `code` and optional `line`
- `LIMITS`: shared node, nesting, name, and input limits

Use `validateDocument` at trust boundaries. Never construct a ZIP path directly from arbitrary imported input.

### Parsing and formatting

- `TextFormat`: `'auto' | 'plain' | 'markdown' | 'ascii' | 'unicode'`.
- `parseText(text, format = 'auto', indent = 'auto')`: parses an explicitly selected text format or detects it automatically. Input indentation uses `ParseIndent`: `'auto' | 2 | 4 | 'tabs'`.
- `formatText(document, format = 'plain', indent = 2)`: serializes a document; output format excludes `'auto'`, and output indentation uses `Indent`: `2 | 4 | 'tabs'`.
- `detectTextFormat(text)`: returns a detected format other than `'auto'`.
- `formatMarkdown(document, indent = 2)` and `formatASCII(document)`: dedicated format helpers.
- `parseIndented(text, indent?)` and `formatIndented(document, indent?)`: compatibility helpers for existing integrations; two spaces remain the default output indentation.
- `formatTree(document)`: produces readable Unicode connectors.
- `parseJSON(text)` and `serializeJSON(document)`: the versioned, ID-preserving project format.
- `flatten(document)`: returns nodes with `parentId`, `depth`, and slash-separated relative `path`.

The standalone editor has no indentation selector: generated text, the Tab key, and TXT/Markdown-list downloads use four spaces. Core formatter defaults remain unchanged for library consumers. Pasted and imported source is kept verbatim. Unfinished legacy drafts retain their stored parsing rule until committed or reverted; new drafts use automatic indentation detection.

Automatic indentation detection uses the first indented line, then enforces the detected style. It supports two spaces, four spaces, or tabs and does not infer missing levels or silently repair mixed indentation. Errors retain source line numbers where possible.

The text parser supports plain outlines, Markdown unordered lists (`-`, `*`, or `+` markers), ASCII connectors (`|--`, `` `-- ``, or `+--`), and Unicode connectors (`├──` and `└──`). Markdown lists contain one root and use consistent two-space, four-space, or tab indentation; ordered lists are rejected.

Automatic format detection is heuristic. Explicit format selection resolves ambiguity instead of forcing every input through a guessed grammar. For example, a root literally named `- Notes` needs explicit plain parsing to avoid being interpreted as a list. Plain mode never strips list markers, branch characters, or fences. Round-trip a text representation with its matching format; use JSON when IDs and unambiguous restoration matter.

Fenced plain, ASCII, and Unicode text remains supported through automatic or Markdown parsing. Explicit ASCII/Unicode formats expect bare trees, not surrounding Markdown fences. Canonical ASCII output uses `|--` for non-final branches, `` `-- `` for the final branch, `|   ` for continuing ancestors, and four spaces otherwise.

Markdown output wraps every folder name in a complete code span. Its delimiter is longer than any backtick run in the name, with padding when required by code-span syntax. Parsing decodes whole-name code spans and standard backslash escapes of punctuation; otherwise labels remain literal folder names, not rendered Markdown or executable markup.

### Immutable editing

- `addFolder(document, parentId, name)`
- `renameFolder(document, id, name)`
- `removeFolder(document, id)`
- `moveFolder(document, id, parentId, index?)`

Each operation returns a validated copy. Deleting or moving the root is rejected. A move cannot target the node itself or any descendant. `index` is the final insertion position in the destination after removing the source; omit it to append. The UI `moveByDrop` adapter computes before/after positions from the target parent with the source already removed, preventing same-parent off-by-one errors. Row-edge hit zones use the outer 25% of row height; the center nests inside. The root only accepts nesting. Insertion lines use the whole target subtree boundary, while nesting highlights the target row. For after-drops, `dropDepth` maps pointer X to the tree's content-relative indentation band (including horizontal scroll), and `resolveDropTarget` can climb only a chain of last children to the requested depth. It never resolves to the root or crosses an unfinished sibling branch. The visual line and help text use that resolved ancestor, not merely the row under the pointer. Trailing tree whitespace uses the last visible row, respecting collapsed ancestors, with the same resolution rules. During an internal drag, `bottomAncestorTargets` enumerates shallower last-child-chain boundaries and filters them through `moveByDrop`, excluding invalid destinations and no-ops. The UI memoizes these targets and adds full-width, labeled ancestor bands below the short same-level gap. Bands use their explicit target ID rather than pointer X, allowing a straight-down gesture from a collapsed last folder. The band list is capped at 144 px and scrolls for deep trees; it disappears on drop or drag cancellation without reserving idle layout space. Target resolution happens before cycle checks, so outdenting a source above its own old parent is allowed while dropping within its descendants remains invalid. The Move dialog exposes the same final-index placement without dragging. `folderActions.ts` implements immutable sibling creation and indent/outdent adapters: sibling creation inserts after selection, outdent inserts after the former parent in its parent, and indent appends to the immediate preceding sibling. Each adapter delegates to validated core operations; the UI commits each result once.

These pure operations make history straightforward: retain earlier documents rather than relying on inverse operations. Hosts can build their own history and persistence around the same core.

## Export helpers (`src/exports/index.ts`)

```ts
import { createExport } from './src/exports';

const { blob, filename } = await createExport(document, 'zip');
```

Download filenames retain their format extension and are shortened when necessary to fit 255 UTF-8 bytes. This does not rename the root folder inside the document or ZIP.

`ExportFormat` is `'zip' | 'txt' | 'md' | 'md-tree' | 'ascii' | 'unicode' | 'json' | 'svg' | 'png'`. Every format validates the input before generating output. The caller owns the download interaction.

- **ZIP** uses `fflate`; each node has a zero-byte archive entry ending in `/` with directory metadata. No files, scripts, or placeholder contents are included.
- **TXT** (`txt`, `.txt`) is a two-space plain outline.
- **ASCII tree** (`ascii`, `.ascii.txt`) uses ASCII connectors while preserving Unicode folder names as UTF-8 text.
- **Unicode tree** (`unicode`, `.tree.txt`) uses Unicode connectors.
- **Markdown list** (`md`, `.md`) is a nested bullet list.
- **Markdown tree** (`md-tree`, `.tree.md`) preserves the earlier fenced Unicode-tree export and chooses a fence length that safely contains backticks in folder names.
- **JSON** is the versioned document.
- **SVG** is XML-escaped vector markup with no scripts, external resources, or `foreignObject`. `renderSVG(document)` exposes the SVG text and dimensions.
- **PNG** rasterizes the SVG using browser image and canvas APIs. It needs a browser; the other exports do not require the DOM. Dimension and pixel limits protect against unsupported or excessive canvases.

The UI keeps six top-level format cards: TXT exposes plain/ASCII/Unicode subtypes, and Markdown exposes list/fenced-tree subtypes. Compound download extensions are retained when a long root name must be shortened.

## React editor (`src/ui/FolderEditor.tsx`)

The reusable editor accepts:

```ts
interface FolderEditorProps {
  initialDocument?: DirectoryDocument;
  onChange?: (document: DirectoryDocument) => void;
  storageKey?: string | false;
}
```

The editor owns its document and editing history (up to 50 committed changes in memory). `initialDocument` is an initialization value, not a controlled prop. `onChange` reports the initialized document and valid committed changes, including automatically committed text edits; it does not emit invalid raw text. Do not use the callback to repeatedly remount the editor unless resetting selection and history is intentional.

### File import dispatch

File extensions select the parser before validation: `.json` uses `parseJSON`; `.ascii.txt`/`.ascii` use ASCII; `.tree.txt`/`.tree` use Unicode; `.md`/`.markdown`/`.tree.md` use Markdown; ordinary `.txt` uses explicit plain text. Unknown extensions use automatic detection. Compound tree suffixes are checked before the generic `.txt` suffix.

This deliberately preserves literal names in FolderSeed's plain-text exports, including a root starting with `- `. A tree-style `.txt` from another source should be pasted with the correct format selected or renamed to a matching tree suffix; it is not silently guessed during plain-text file import.

### Text state and automatic commits

Raw text is separate from the last valid `DirectoryDocument`. Valid text updates the preview immediately and commits after a 350 ms quiet period. Automatic commits preserve the user's raw formatting and cursor position instead of regenerating the textarea. Input-method composition suppresses commits and keeps the last valid preview until composition finishes.

Invalid text remains in the textarea with its error and does not overwrite the last valid model. It blocks export, switching to visual editing, import, and templates until corrected or explicitly reverted. **Revert text** regenerates the selected style from the last valid model; it is an intentional discard action, never an automatic repair.

Export, copy, and transitions to visual editing flush valid pending text before operating. Copy always produces the Unicode tree used by the text-tree preview. The split format control (`FormatSwitch`) keeps two independent click targets: its current-format label enters text editing without changing raw source, and its trailing arrow opens a four-item radio menu. Fresh workspaces use Plain text; the chosen label persists across visual-mode switches. Menu selection also enters text editing. Choosing a different format flushes and converts the current document; reopening the current format preserves raw text. The visual-mode control is a toggle button, not a one-tab tablist. For invalid input, format selection changes interpretation without replacing the raw text, allowing users to fix a wrong format choice.

Debounced typing bursts are history steps. Pending timers must not commit stale text after a newer edit, undo/redo, import, or other document replacement. Undo history is in-memory and is not restored after a reload.

Styles use the `.fs-app` root and namespaced `.fs-*` classes; import `src/ui/style.css` for source integration or `folderseed/styles.css` for the built package once in the host. The source example in `examples/embedding.tsx` disables browser persistence and keeps a host-level snapshot.

Legacy automatic-format drafts are migrated by `restoreTextFormat` only if an explicit parser yields the same tree. For committed drafts, the saved document is authoritative; for pending drafts, the old parser must succeed first. Invalid automatic drafts retain their raw source and internal parsing rule with the default Plain text label. Clicking that label only enters editing and does not reinterpret the draft; choosing a menu item explicitly changes its parser. Automatic format detection remains available to file imports and the core API, but is not an editor option.

The format menu implements arrow/Home/End/typeahead navigation, Enter/Space activation, Escape focus restoration, normal Tab dismissal, and outside pointer/focus dismissal. It is closed rather than activated during input-method composition.

Document shortcuts are handled on the editor root, not on `window` or `document`. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (plus Ctrl+Y) invoke the same history actions as the buttons. Inputs, textareas, selects, editable content, dialogs, and composing events are excluded. Completed or cancelled drags return focus to the dragged folder so keyboard history works immediately; unrelated host controls remain outside the event scope.

### Persistence

The standalone editor keeps its draft in browser `localStorage` under `folderseed:draft:v1`. The saved state includes raw text (including invalid or empty text), mode, format, a compatibility parsing rule for unfinished legacy drafts, and the last valid document; reloading restores the editing state rather than silently normalizing it. Set a different `storageKey` to isolate separate embedded projects, or set it to `false` to opt out. A host that persists documents should validate them on load and use JSON exports for portable backups.

Storage can be unavailable or cleared. It is not cloud synchronization, transactional multi-tab editing, or a guaranteed backup. Treat document changes as private user data when integrating with a host application's persistence.

## Standalone app and library builds

The Vite app entry mounts the same reusable editor. `npm run build` type-checks TypeScript and creates a static `dist/` bundle. No backend, API credentials, database migration, or environment file is needed.

`npm run build:lib` uses `vite.lib.config.ts` to create these independent ESM entry points in `dist-lib/`:

- `core.js`: the framework-independent model and operations.
- `exports.js`: export helpers, sharing the core and using external `fflate`.
- `react.js`: the editor, sharing core and export helpers and using external React.
- `styles.css`: extracted, namespaced editor styles.
- `types/`: TypeScript declarations; `styles.d.ts` supports typed stylesheet imports.

`tsconfig.lib.json` emits declarations without the standalone app, tests, or examples. `scripts/finalize-types.mjs` normalizes declaration import paths for both NodeNext and Bundler module resolution. The built React JavaScript does not inject CSS; consumers must import `folderseed/styles.css`.

The package export map exposes `folderseed/core`, `folderseed/exports`, `folderseed/react`, and `folderseed/styles.css`. The root `folderseed` export points to the core so a non-React host does not accidentally load UI dependencies. React, React DOM, the JSX runtime, and `fflate` are externalized rather than copied into the library bundles. Output is ESM-only.

`npm run build:all` builds both outputs. CI builds both, then runs browser tests against the standalone app. Development and preview servers bind to `127.0.0.1` by default.

The package remains `private: true` to avoid accidental npm publication. A local application can depend on a built checkout, or use the source directly; publishing and a wider version-compatibility promise remain separate decisions.

## Safety boundaries

The model rejects path separators, traversal names, reserved operating-system names, control characters, unsafe Unicode, invalid IDs, cycles, duplicate IDs, and case-insensitive duplicate sibling names. Names are normalized to NFC. Limits bound tree size, nesting, names, and text input.

Validation does not grant filesystem access or ensure every target operating system will accept every complete path. The app only returns downloads. Archive extraction is performed by the user's chosen tool and can still encounter platform-specific full-path restrictions.


### Selected-folder action group

Only the selected folder owns the eight-button contextual group. Container queries place it beside the row when the editor has enough width, otherwise below the row; mobile uses a four-column, two-row grid with 44 px targets. All icons have English accessible labels and tooltips. The path footer retains only the general Move dialog action rather than duplicating the row controls. Root, sibling-position, folder-count, duplicate-name, and depth restrictions disable unavailable actions. Adding a child expands its parent, while mutations keep the subtree intact and restore editor focus for keyboard history.

A native drag freezes the action group's owner and footprint to the pre-drag selection. Its controls are disabled and hidden from accessibility during the drag, so choosing the dragged folder does not shift rows under the pointer or disturb insertion geometry. Drop hit zones still measure only the main folder row, not the below-row action group.
