# Architecture

FolderSeed separates the folder model from the editor and from the standalone page. The repository builds both a standalone app and reusable ESM modules with declarations. No npm package has been published.

## Data model

```ts
interface FolderNode {
  id: string;
  name: string;
  comment?: string;
  commentBinding?: { source: 'folderseed-template'; key: string };
  children: FolderNode[];
}

interface DirectoryDocument {
  version: 1;
  root: FolderNode;
}
```

There is one root. Every node is a folder. An empty `children` array represents an empty folder, not a missing file. Sibling order is meaningful and retained by JSON, text, previews, and exports.

The internal `DirectoryDocument` retains its `version: 1` discriminant. The JSON wire format is version 3 when any node has a comment binding, otherwise version 2 for literal comments or version 1 without comments. `parseJSON` and `validateDocument` accept all three wire versions and return a clean internal document; other versions are rejected. `serializeJSON` chooses the correct wire version, so integrations should not serialize the internal object directly for interchange. Version-1/version-2 backups remain readable and literal unless they explicitly contain binding metadata; no bindings are inferred from wording. Older readers reject unsupported version-3 projects rather than silently dropping provenance. IDs are unique within a document and are preserved by JSON round-trips; parsing a text outline creates fresh IDs. Unknown properties are discarded.

An optional `comment` is literal single-line metadata, never part of `name` or a path. Empty comments are omitted. Each comment is limited to 500 Unicode characters, with a combined 262,144-byte UTF-8 budget per document. Controls, line separators, invalid Unicode, and directional control characters are rejected. Literal comments retain their exact text rather than being normalized or translated. A binding requires a nonempty fallback comment, the exact source `folderseed-template`, and a 1–100-character semantic key beginning with a letter and containing letters, digits, dots, underscores, or hyphens. Unknown valid keys are preserved and display their fallback.

## Core (`src/core/index.ts`)

The core uses only standard JavaScript APIs. It does not require a UI framework, DOM, filesystem, server, or network.

### Creation and validation

- `createDocument(rootName?)`
- `validateName(value, line?)`
- `validateComment(value, line?)`
- `validateDocument(input)`
- `DirectoryError`: an error with `code` and optional `line`
- `LIMITS`: shared node, nesting, name, comment, and input limits

Use `validateDocument` at trust boundaries. Never construct a ZIP path directly from arbitrary imported input.

### Parsing and formatting

- `TextFormat`: `'auto' | 'plain' | 'markdown' | 'ascii' | 'unicode'`.
- `parseText(text, format = 'auto', indent = 'auto')`: parses an explicitly selected text format or detects it automatically. Input indentation uses `ParseIndent`: `'auto' | 2 | 4 | 'tabs'`.
- `formatText(document, format = 'plain', indent = 2)`: serializes a document; output format excludes `'auto'`, and output indentation uses `Indent`: `2 | 4 | 'tabs'`.
- `detectTextFormat(text)`: returns a detected format other than `'auto'`.
- `formatMarkdown(document, indent = 2)` and `formatASCII(document)`: dedicated format helpers.
- `parseIndented(text, indent?)` and `formatIndented(document, indent?)`: compatibility helpers for existing integrations; two spaces remain the default output indentation.
- `formatTree(document)`: produces readable Unicode connectors.
- `formatFolderLabel(node)`: combines the folder name and optional comment suffix.
- `parseJSON(text)` and `serializeJSON(document)`: the versioned, ID-preserving project format.
- `flatten(document)`: returns nodes with `parentId`, `depth`, and slash-separated relative `path`.

The standalone editor has no indentation selector: generated text, the Tab key, and TXT/Markdown-list downloads use four spaces. Core formatter defaults remain unchanged for library consumers. Pasted and imported source is kept verbatim. Unfinished legacy drafts retain their stored parsing rule until committed or reverted; new drafts use automatic indentation detection.

Automatic indentation detection uses the first indented line, then enforces the detected style. It supports two spaces, four spaces, or tabs and does not infer missing levels or silently repair mixed indentation. Errors retain source line numbers where possible.

The text parser supports plain outlines, Markdown unordered lists (`-`, `*`, or `+` markers), ASCII connectors (`|--`, `` `-- ``, or `+--`), and Unicode connectors (`├──` and `└──`). Markdown lists contain one root and use consistent two-space, four-space, or tab indentation; ordered lists are rejected.

Automatic format detection is heuristic. Explicit format selection resolves ambiguity instead of forcing every input through a guessed grammar. For example, a root literally named `- Notes` needs explicit plain parsing to avoid being interpreted as a list. Plain mode never strips list markers, branch characters, or fences. Round-trip a text representation with its matching format; use JSON when IDs and unambiguous restoration matter.

Fenced plain, ASCII, and Unicode text remains supported through automatic or Markdown parsing. Explicit ASCII/Unicode formats expect bare trees, not surrounding Markdown fences. Canonical ASCII output uses `|--` for non-final branches, `` `-- `` for the final branch, `|   ` for continuing ancestors, and four spaces otherwise.

Every text format uses the first exact ` // ` separator to split a folder label into its name and comment. Additional separators belong to the comment. Slashes are already invalid in names, so this does not reinterpret valid old folder names. Markdown output wraps the complete name/comment label in a code span. Its delimiter is longer than any backtick run in the label, with padding when required by code-span syntax. Parsing decodes whole-label code spans and standard backslash punctuation escapes before splitting the comment; labels are not rendered Markdown or executable markup.

### Immutable editing

- `addFolder(document, parentId, name)`
- `renameFolder(document, id, name)`
- `setFolderComment(document, id, comment)`: always removes the binding; an empty string also removes the comment.
- `removeFolder(document, id)`
- `moveFolder(document, id, parentId, index?)`

Each operation returns a validated copy. Deleting or moving the root is rejected. A move cannot target the node itself or any descendant. `index` is the final insertion position in the destination after removing the source; omit it to append. The UI `moveByDrop` adapter computes before/after positions from the target parent with the source already removed, preventing same-parent off-by-one errors. Row-edge hit zones use the outer 25% of row height; the center nests inside. The root only accepts nesting. Insertion lines use the whole target subtree boundary, while nesting highlights the target row. For after-drops, `dropDepth` maps pointer X to the tree's content-relative indentation band (including horizontal scroll), and `resolveDropTarget` can climb only a chain of last children to the requested depth. It never resolves to the root or crosses an unfinished sibling branch. The visual line and help text use that resolved ancestor, not merely the row under the pointer. Trailing tree whitespace uses the last visible row, respecting collapsed ancestors, with the same resolution rules. During an internal drag, `bottomAncestorTargets` enumerates shallower last-child-chain boundaries and filters them through `moveByDrop`, excluding invalid destinations and no-ops. The UI memoizes these targets and adds full-width, labeled ancestor bands below the short same-level gap. Bands use their explicit target ID rather than pointer X, allowing a straight-down gesture from a collapsed last folder. The band list is capped at 144 px and scrolls for deep trees; it disappears on drop or drag cancellation without reserving idle layout space. Target resolution happens before cycle checks, so outdenting a source above its own old parent is allowed while dropping within its descendants remains invalid. The Move dialog exposes the same final-index placement without dragging. `folderActions.ts` implements immutable sibling creation and indent/outdent adapters: sibling creation inserts after selection, outdent inserts after the former parent in its parent, and indent appends to the immediate preceding sibling. Each adapter delegates to validated core operations; the UI commits each result once.

Renaming and moving preserve comments, bindings, and descendants; changing a comment preserves the folder name, ID, order, and children. These pure operations make history straightforward: retain earlier documents rather than relying on inverse operations. Hosts can build their own history and persistence around the same core.

## Export helpers (`src/exports/index.ts`)

```ts
import { createExport } from './src/exports';

const { blob, filename } = await createExport(document, 'zip');
```

Download filenames retain their format extension and are shortened when necessary to fit 255 UTF-8 bytes. This does not rename the root folder inside the document or ZIP.

`ExportFormat` is `'zip' | 'txt' | 'md' | 'md-tree' | 'ascii' | 'unicode' | 'json' | 'svg' | 'png'`. Every format validates the input before generating output. The caller owns the download interaction.

- **ZIP** uses `fflate`; each node has a zero-byte archive entry ending in `/` with directory metadata. No files, scripts, or placeholder contents are included. Comments do not affect ZIP entry names or add metadata files.
- **TXT** (`txt`, `.txt`) is a four-space plain outline.
- **ASCII tree** (`ascii`, `.ascii.txt`) uses ASCII connectors while preserving Unicode folder names as UTF-8 text.
- **Unicode tree** (`unicode`, `.tree.txt`) uses Unicode connectors.
- **Markdown list** (`md`, `.md`) is a nested bullet list.
- **Markdown tree** (`md-tree`, `.tree.md`) preserves the earlier fenced Unicode-tree export and chooses a fence length that safely contains backticks in folder names.
- **JSON** uses version 3 for bound comments, version 2 for literal comments, and version 1 without comments, preserving IDs and explicit provenance.
- **SVG** is XML-escaped vector markup with no scripts, external resources, or `foreignObject`. `renderSVG(document)` exposes the SVG text and dimensions.
- **PNG** rasterizes the SVG using browser image and canvas APIs. It needs a browser; the other exports do not require the DOM. Dimension and pixel limits protect against unsupported or excessive canvases.

The React UI passes a current-locale projection to non-JSON exports and keeps JSON canonical. Direct core/export-helper calls use their supplied document without choosing a language. All text/Markdown and image formats include comments; SVG escapes names and comments separately and renders comments with secondary styling. PNG inherits that SVG content. The UI keeps six top-level format cards: TXT exposes plain/ASCII/Unicode subtypes, and Markdown exposes list/fenced-tree subtypes. Compound download extensions are retained when a long root name must be shortened.

## React editor (`src/ui/FolderEditor.tsx`)

The reusable editor accepts:

```ts
interface FolderEditorProps {
  initialDocument?: DirectoryDocument;
  onChange?: (document: DirectoryDocument) => void;
  storageKey?: string | false;
  themeStorageKey?: string | false;
  languageStorageKey?: string | false;
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

Styles use the `.fs-app` root and namespaced `.fs-*` classes; import `src/ui/style.css` for source integration or `folderseed/styles.css` for the built package once in the host. The source example in `examples/embedding.tsx` disables draft persistence and keeps a host-level snapshot; appearance persistence is configured independently.

Legacy automatic-format drafts are migrated by `restoreTextFormat` only if an explicit parser yields the same tree. For committed drafts, the saved document is authoritative; for pending drafts, the old parser must succeed first. Invalid automatic drafts retain their raw source and internal parsing rule with the default Plain text label. Clicking that label only enters editing and does not reinterpret the draft; choosing a menu item explicitly changes its parser. Automatic format detection remains available to file imports and the core API, but is not an editor option.

The format menu implements arrow/Home/End/typeahead navigation, Enter/Space activation, Escape focus restoration, normal Tab dismissal, and outside pointer/focus dismissal. It is closed rather than activated during input-method composition.

Document shortcuts are handled on the editor root, not on `window` or `document`. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (plus Ctrl+Y) invoke the same history actions as the buttons. Inputs, textareas, selects, editable content, dialogs, and composing events are excluded. Completed or cancelled drags return focus to the dragged folder so keyboard history works immediately; unrelated host controls remain outside the event scope.

### Appearance and settings

`themeStorageKey` defaults to `folderseed:theme:v1`, independently of `storageKey`. It stores a raw `system`, `light`, or `dark` string rather than changing the versioned document or draft schema. An absent or unrecognized value falls back to System. Pass a different key for an isolated embedded preference, or `false` to avoid reading and writing appearance storage. Theme changes do not create history steps, invoke `onChange`, or flush an invalid text draft.

System resolves through `matchMedia('(prefers-color-scheme: dark)')` and follows live changes. Manual Light/Dark preferences ignore those changes. If media-query APIs are unavailable, System safely resolves to light; manual choices still work. Storage failures preserve an in-memory preference and show a session-only notice rather than blocking editing.

The resolved appearance and preference are exposed only on the editor wrapper as `data-theme` and `data-theme-preference`. Theme selectors and color-scheme styling stay scoped to `.fs-app`; the editor does not rewrite host `html`/`body` classes, styles, or attributes. The folder model and exported document are appearance-independent.

The bottom sidebar menu and its responsive header counterpart open the same Settings dialog. Menu keyboard navigation, Escape, Tab, and outside dismissal are supported. The native modal focuses the checked theme radio, supports arrow-key selection, contains keyboard focus, and returns focus to a visible menu trigger when dismissed, including after a viewport change. Closing Settings never requires saving a second time.

### Mobile header visibility

At mobile widths, the brand/settings bar keeps its layout space while a transform hides or reveals it. The scroll hook observes page/window scrolling, not tree or textarea scroll events: 24 px of downward movement hides the bar, 12 px upward reveals it, and positions at or above 16 px from the document top always show it. Direction changes reset the accumulated distance to avoid jitter. Keyboard-visible header focus (`:focus-visible`), an expanded menu, and the Settings dialog pin it open. Any header focus reveals it immediately, but restored pointer/touch focus alone does not keep it pinned during later scrolling; viewport changes also reveal it. `.fs-sidebar.is-scroll-hidden` uses a vertical transform and disables pointer hits while hidden, without changing the main page's flow or dimensions. The 160 ms slide transition is removed under `prefers-reduced-motion`. Desktop sidebar behavior remains independent.

### Persistence

The standalone editor keeps its draft in browser `localStorage` under `folderseed:draft:v1`. The saved state includes raw text (including invalid or empty text), mode, format, a compatibility parsing rule for unfinished legacy drafts, the text snapshot locale (`textLocale`), and the last valid document serialized with the correct version-1/version-2/version-3 wire format; reloading restores the editing state rather than silently normalizing it. Set a different `storageKey` to isolate separate embedded projects, or set it to `false` to opt out. The storage key is unchanged, and existing version-1 drafts remain readable. A host that persists documents should validate them on load and use `serializeJSON` for portable backups.

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

Selection is an in-memory UI state. Initial load, reload, successful import, and opening a template have no selection. Clicking a folder immediately shows its eight-button action group; selecting another folder transfers the controls. There is no separate Edit/Close gate. Escape or genuine blank space in the editor clears selection and focuses the editor section so keyboard history remains available. The blank-space handler excludes controls, folder-row gaps, dialogs, and drag gestures. Touch background taps are recognized on primary pointer release, without waiting for a compatibility click. The tracker rejects movement beyond 8 px, holds beyond 500 ms, changed scroll positions, additional pointers, and cancellation; handlers remain scoped to the editor and never prevent native scrolling. Mouse/keyboard clicks retain the existing path. Valid inline blur commits before clearing selection without scheduling a later focus jump back to the folder; invalid edits still veto dismissal. The selected path and general Move action exist only while a folder is selected, but their footer always retains its height. Selection and deselection therefore leave the editor, preview, workspace grid, and export section positions unchanged. A `.fs-folder-frame.has-actions` marks the selected anchor. Its floating `.fs-context-actions` group uses `data-action` identifiers and lives in a `.fs-floating-actions` wrapper beside the tree, inside the relatively positioned visual area, rather than inside the scrolling list. Up/down align with the glyph above/below; outdent sits to its left; Rename is above the name; sibling/child creation are adjacent below the name; indent and Delete sit to its right. The spatial arrangement does not change at narrow widths. The eight action SVGs are 16 px while the folder SVG stays 20 px. Every folder row remains 34 px high; selection never adds vertical padding or changes neighboring positions or list height. The floating group is 68 px high, beginning 17 px above its anchor. All eight buttons use equal 24 × 24 px targets on desktop and mobile. Neighboring rows may be partially covered, but action targets do not overlap each other. Distinct button backgrounds and a higher stacking level ensure pointer hits reach the visible action, not the covered row. Empty overlay space does not intercept pointers. The selected grid retains 30 px leading and 28 px glyph tracks and an exact depth × 22 px inset, preserving both glyph and name coordinates. Long names truncate; deep frames use tree-local horizontal scrolling rather than reindenting or expanding the page. A layout effect measures the anchor relative to the visual area, with animation-frame updates on tree scroll and resize observation. The wrapper is removed while the anchor is vertically outside the tree viewport without clearing selection. Root and bottom controls can extend beyond the list viewport without being clipped by it. All icons have localized accessible labels and tooltips. The path footer retains only the general Move dialog action rather than duplicating the row controls. Root, sibling-position, folder-count, duplicate-name, and depth restrictions disable unavailable actions. Adding a child expands its parent. Add, rename, reorder, indent, and outdent retain the resulting selection and its actions; deleting selects the surviving parent. Mutations keep the subtree intact and restore editor focus for keyboard history.

A native drag selects its source while retaining the preceding selection's floating action owner, or showing no controls if nothing was selected. The frozen controls are disabled, hidden from accessibility, and transparent to drag pointer events. Choosing the dragged folder does not shift rows under the pointer or disturb insertion geometry; its own actions appear after the drag ends. Before/inside/after hit zones measure the actual 34 px row; no artificial frame padding is added. Blank areas beside a compact frame retain their row-relative drop behavior. Post-drag click suppression prevents the completed gesture from immediately clearing selection.


### Inline naming

Adding and renaming use `.fs-inline-editor` with a labeled input, Save name, Cancel editing, and an associated validation alert. Rename temporarily replaces the selected label; add renders an `.fs-inline-placeholder` at the prospective insertion point without changing the document. Enter, Save name, or focus leaving the inline editor validates and commits once. Explicit commits focus the resulting folder for scoped history shortcuts; a valid blur commit keeps focus on the destination control so opening a menu is not interrupted. Escape or Cancel editing discards the local value without changing the document or history. Moving focus between the inline controls does not trigger a premature blur commit. Invalid names remain editable and regain focus; duplicate, unsafe, and empty names use the same core validator. Composition state and the native composing/key-code signals prevent IME Enter from committing unfinished input. The preview, autosaved document, and callbacks see only valid commits. Inline drafts are ephemeral rather than saved folders. The status identifies an active name edit, and `beforeunload` warns for nonempty adds or changed rename values. Document history shortcuts are suspended while inline editing is active, including when Save or Cancel has focus, without overriding native input undo. Invalid inline descendants prevent ancestor collapse so validation cannot become hidden. Move, template confirmation, and Settings remain modal dialogs; deletion is immediate and recoverable with Undo.

### Inline comments and templates

Each tree item owns a separate `.fs-folder-comment` column before its trailing child count. Comment cells ellipsize and expose their full text as a title. Editing replaces the button with a `.fs-folder-comment.is-editing` div at identical bounds, containing the existing `.fs-inline-editor` and labeled `.fs-inline-comment` textarea. There is no popover or second row. The single-line textarea scrolls horizontally for long values. Cells at least 132 px wide show 24 × 24 px Save/Cancel controls; narrower cells reserve the full width for the textarea. Enter and valid blur commit once; Escape cancels, composition delays commits, and text undo remains native. Invalid input stays focused and references a `.fs-comment-error` alert in the preexisting `.fs-tree-help` line with `aria-describedby`; its full message is also available as a title without increasing layout height. Unfinished comment values are not persisted or exported; `beforeunload` warns about changed values. The document and preview see only successful commits. Row pitch, folder anchors, count placement, and panel dimensions do not depend on comment editing. The folder preview renders comments separately in `.fs-preview-comment`.

All 29 template folders store canonical English fallback comments and `{ source: 'folderseed-template', key }` bindings. `makeTemplate(index, translate?)` retains its optional translator parameter for compatibility but does not use it to mutate the document. `templateComments.ts` maps stable keys to catalog messages; `resolveTemplateComments` validates and clones the canonical document into a current-locale projection. Unknown keys use the saved fallback. No text, folder-name, or legacy-project heuristic creates bindings.

Locale changes update only projections, never history, `onChange`, or persisted drafts. Visual comments, preview, Copy tree, and non-JSON UI downloads use the projection; JSON retains canonical fallback/binding metadata. Explicit comment Save/Enter or a touched valid blur calls the core custom-comment operation and detaches even if the displayed text is unchanged. Untouched blur and Cancel preserve the canonical node. Undo restores the binding; renaming and moving retain it.

`commentPresentation.ts` compares the complete parsed text against the exact localized baseline recorded for that editing burst. Equal content preserves canonical IDs and bindings, including mode/format switches; substantive content changes become a literal snapshot with all bindings removed. A nonmodal `.fs-comment-format-note` explains this boundary. Saved `textLocale` reconstructs the baseline on reload. Clean bound text can be derived in a new locale without rewriting stored raw text; invalid or composing drafts stay byte-identical. Old literal comments and imported matching phrases never acquire bindings.

### Interface language (`src/ui/i18n.tsx`)

`useLanguage` and the per-editor `I18nProvider` resolve an Automatic preference from `navigator.languages`, then `navigator.language`, with English fallback. Regional and script aliases map to the twelve supported catalogs; browser preference order is respected. Automatic mode subscribes to `languagechange`, while a manual preference ignores those events until Automatic is selected again. The raw preference (`auto` or a supported locale code) uses `folderseed:language:v1` by default. `languageStorageKey` supports a custom key or `false` independently of document and theme storage. Blocked storage keeps the active session usable and reports a localized settings notice.

Only the `.fs-app` root receives `lang` and `dir`; host document attributes are untouched. Arabic uses RTL chrome. Trees, overlays, preview paths, and text syntax stay LTR to retain hierarchy geometry, and inline folder-name inputs use `dir="auto"`. Catalog translation applies to interface labels, recognized errors, and explicitly bound template-comment projections, never folder names, literal custom notes, or arbitrary imported text. Switching language does not rewrite invalid drafts, rename folders, change canonical JSON, or emit document callbacks; localized snapshot exports reflect the newly displayed language. Public repository documentation and source comments remain English.
