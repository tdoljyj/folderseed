# FolderSeed

**Plan a folder structure. Make it yours. Download the real folders.**

FolderSeed is a small, local-first folder editor for people who would rather arrange folders than write scripts. Build your structure visually, edit it as text, and choose the export that fits your next step.

No account, backend, API key, or command-line knowledge is needed to use the editor. Your draft stays in your browser; the app includes no analytics or folder-upload service. The website host may log ordinary web requests (see Privacy and safety).

## What you can do

- Add, rename, delete, reorder, and move folders in a visual editor.
- Add a short comment beside any folder without changing its name or ZIP path.
- Undo and redo changes, start from a template, and keep a local draft between visits.
- Choose System, Light, or Dark appearance without changing your folder draft.
- Edit plain outlines, Markdown lists, or ASCII/Unicode trees. Pasted and imported text supports **2 spaces, 4 spaces, or tabs**. Generated outlines use four spaces; there is no indentation setting to configure.
- See valid text changes in the preview immediately; the folder model updates automatically after a short pause. Invalid input is reported instead of silently flattening your structure.
- Import text, Markdown, or a versioned JSON document.
- Export actual folders as ZIP, or choose plain text, ASCII/Unicode trees, Markdown lists/trees, JSON, SVG, or PNG.
- Reuse the framework-independent TypeScript core or embed the React editor in another application.

FolderSeed currently models **folders only**, under one root folder. It does not create files or execute scripts.

## Moving and ordering folders

Drag a folder to the **top or bottom edge of a row** to insert it before or after that folder at the same level. A blue insertion line marks the destination; for an expanded folder, an after-line appears below its whole subtree. At the end of a subtree, slide the pointer **left to move out to a parent level**, or right to keep the deeper level. The line's indentation and release hint show which folder you will follow. To move straight down instead, use the full-width **Move out · After …** bands that appear below the tree while dragging. Each band chooses a parent or ancestor level regardless of pointer X, including when the last folder is collapsed and you are dragging that folder itself. Bands are listed from the nearest valid ancestor outward, stay hidden when not dragging, and scroll within a compact area for deep trees. The row edge and the small gap immediately below it still support the original same-level/horizontal placement. Outdenting is available only where the whole ancestor subtree ends; it never moves a folder outside the root. Drop in the **middle of a row** to nest inside it, indicated by a filled highlight. The root stays fixed, and drops into your own descendants are rejected.

The six-dot drag grip sits at the start of each row, before the disclosure arrow and folder name. Its slot is always reserved so hover or selection does not shift labels; the immovable root has a blank slot. You can still drag from the rest of the row. Direct-child counts stay in their right-hand gutter when a folder is selected, hovered, or collapsed; leaves do not show a zero.

No dragging is required. A fresh workspace has no folder selected. Click a folder to reveal the available actions in an eight-position layout: **Move up**, **Move down**, **Move to parent level**, **Move into a sibling**, **Add sibling folder**, **Add child folder**, **Rename**, and **Delete folder**. Moving to the parent level places the whole subtree immediately after its former parent; moving inward appends it inside the preceding sibling, or inside the next sibling when the selected folder is first. Its complete subtree moves with it and the destination opens automatically. Add sibling inserts immediately after selection, while Add child opens the selected folder if it was collapsed. Unavailable action icons are hidden and cannot receive focus or clicks; their positions remain reserved so other controls do not move: the root cannot move, gain a sibling, or be deleted, and an only child has no sibling to move into. The controls surround the selected folder in the same arrangement on desktop and mobile: Move up/down sit above/below the folder icon, Move to parent level sits to its left, Rename sits above the name, the two Add controls sit below the name, and Move into a sibling and Delete sit to its right. Selection does not move folders horizontally or vertically: every row stays 34 px high and the list keeps its spacing. The selected-path footer always reserves its space, so the editor, preview, and export panels do not jump when selecting or clearing a folder. The eight 16 px action symbols float around the selected row rather than inserting extra rows. All action buttons have equal 24 × 24 px targets with restrained surfaces and may cover a small part of neighboring rows; clicking a visible button always acts on the selected folder. The floating controls follow scrolling and disappear while their folder is outside the tree viewport. Controls fit closely around short names and long names truncate. Deep folders keep their original indentation and scroll horizontally within the tree when necessary rather than jumping left to fit. Click genuine blank space in the tree or editor, or press Escape, to clear selection and hide the controls and selected path. Clicking action controls, disclosure arrows, or dialog content does not clear selection. Selecting another folder immediately shows its available actions; importing, opening a template, or reloading starts with no selection. Selection is not saved in the draft. After selecting a folder, its path and the general **Move** action become available. For any other destination, use **Move** and choose a **New parent folder** and **Position**. All controls are keyboard accessible, have descriptive labels/tooltips, and keep core name/depth safeguards. Moves keep the subtree together, support Undo/Redo, and preserve the displayed order in autosaved drafts and exports.

**Add and rename in place.** Add child or Add sibling opens an inline name field in its intended position; Rename edits the existing label. Press Enter or choose Save name to commit, or click outside the field to commit a valid name. Escape or Cancel editing discards the unfinished name. Invalid or duplicate names stay in the field with an error and focus returns to it. Input-method composition does not commit on Enter. An unfinished new-folder placeholder is not part of the saved document, preview, exports, or undo history until its name is committed; canceling it adds no history step. While a name is unfinished, the status says Editing folder name; refreshing or leaving with a meaningful unfinished name asks for confirmation because inline input is not saved as a draft. Move, template replacement, and Settings still use dialogs.

**Delete without a confirmation dialog.** Delete folder removes the selected folder and its entire subtree immediately; the root cannot be deleted. A floating, localized notice offers **Undo**, restoring that deletion in its original position. This action disappears after another edit, history change, import, or notification so it cannot undo an unrelated change; ordinary history Undo remains available. The notice overlays the page without resizing the panels. Invalid inline names must be corrected or canceled before other folder actions are available.

With focus in the editor, use **Ctrl+Z** (Mac: **Cmd+Z**) to undo visual changes, including drag reordering. Redo with **Ctrl/Cmd+Shift+Z** or **Ctrl+Y**. Text fields and editable content keep their native text undo; document shortcuts are paused in dialogs and during input-method composition. Shortcuts do not capture keys from controls outside an embedded FolderSeed editor.

## Folder comments

Use the optional comment column to the right of a folder name to add a note, or click an existing comment to edit it. The text becomes an input **inside that same cell**: no popup, extra row, or panel resizing. Long comments are shortened when not editing; while editing, the field scrolls horizontally so the entire value remains reachable. Press Enter or leave the field with a valid value to save; Escape discards the unfinished edit. Wider cells also show **Save comment** and **Cancel comment** buttons; narrow cells keep all available width for typing. Clear the field and save to remove a comment. Invalid input remains focused, with an associated error in the existing tree-help line rather than a second row. Input-method composition and native text undo are preserved. Committed changes support document Undo/Redo and browser autosave. As with unfinished inline names, unfinished comment input is not saved; leaving with a changed value asks for confirmation.

Comments are **literal single-line metadata**, not part of folder names, paths, or executable markup. Each comment allows up to **500 Unicode characters**; all comments together may contain at most **262,144 UTF-8 bytes (256 KiB)**. Newlines, control characters, and invalid Unicode are rejected. The visual preview, text/Markdown exports, JSON, SVG, and PNG include comments. **ZIP ignores comments** and contains the same empty folder entries as an unannotated structure.

Every built-in template folder includes a starting comment that **follows the interface language until you customize it**. This uses an explicit template binding, not a guess based on its wording. Changing language only changes the displayed translation; it does not change the saved project, create an Undo step, or notify an embedding host of a document edit.

**Save comment** or Enter makes the displayed value a custom, literal comment—even if you leave the wording unchanged. Editing and then leaving the field also makes it custom, including when you type and remove a character before saving. Simply opening and leaving an untouched field, or canceling, preserves its language binding. Undo restores the original binding. Renaming or moving the folder also preserves it. Custom comments, imported text, and older projects without bindings always stay exactly as saved, even when their wording happens to match a template translation.

## Workspace layout

On desktop, the sidebar stays within the viewport while the main page scrolls. The brand and lower privacy/settings area remain anchored; on shorter screens, the navigation and templates scroll inside the sidebar. At extremely short viewport heights, the sidebar itself can scroll so no control becomes unreachable. On mobile, the brand/settings bar hides after a deliberate downward page scroll and reappears when you scroll up or return to the top. Small movements near the top do not make it flicker. An open menu, Settings dialog, or keyboard focus in the header keeps it visible. Scrolling inside the folder tree does not hide it. The bar moves with a transform, so the editor does not jump; reduced-motion preferences remove the slide animation.

Visual and text editing reserve the same panel height. Switching formats, displaying validation feedback, or resizing the textarea does not move the preview or export panels. Long text and feedback scroll inside the editor; textarea resizing stays bounded by its body.

## Appearance and language

Open the **FolderSeed** menu at the bottom of the sidebar, then choose **Settings**. On smaller screens, use the settings button in the workspace header. **System** follows your device appearance and reacts to changes automatically; **Light** and **Dark** stay fixed until you choose otherwise. Changes apply immediately.

The preference is saved separately from your folder draft, under `folderseed:theme:v1`. Changing appearance does not apply, discard, or alter unfinished text. If browser storage is blocked, the setting still works for the current session and Settings shows a session-only notice. Themes affect the editor, not the exported folder structure or a surrounding host application.

Settings also includes **Language**. **Automatic** follows the first supported browser language and reacts to language changes. You can choose English, Simplified Chinese, Traditional Chinese, Spanish, French, German, Brazilian Portuguese, Japanese, Korean, Arabic, Hindi, or Russian explicitly. The choice applies immediately and is saved independently under `folderseed:language:v1`; returning to Automatic reads the current browser preferences again. Arabic uses right-to-left interface layout, while directory trees, paths, and outline syntax retain their structural direction. Folder names and custom comments are never translated. Untouched template comments follow the current language through a display-only projection; invalid or unfinished raw text is not rewritten. JSON keeps canonical template bindings, while text and image downloads use the current displayed language. Language settings are scoped to the embedded editor and do not change a host page's language or direction.

## Choose the right export

The six export cards remain ZIP, Plain text, Markdown, JSON, SVG, and PNG. **Plain text** offers Indented text, ASCII tree, or Unicode tree; **Markdown** offers Nested list or Fenced tree.

| Format | What you get | Import again? |
| --- | --- | --- |
| **ZIP** | The actual empty folders, including the root and every nested folder. Extract the archive to create them on your device. | No ZIP import |
| **TXT** | A plain-text, four-space-indented outline. | Yes |
| **ASCII tree** | A connector-based tree in an `.ascii.txt` file. | Yes |
| **Unicode tree** | A tree with `├──` and `└──` connectors in a `.tree.txt` file. | Yes |
| **Markdown** | A nested bullet list in a `.md` file. | Yes |
| **Markdown tree** | A fenced Unicode tree in a `.tree.md` file, preserving the earlier Markdown export style. | Yes |
| **JSON** | The complete versioned document, including stable folder IDs and comments. Best for backup or integration. | Yes |
| **SVG** | A scalable image of the directory structure. | No |
| **PNG** | A raster image for sharing. | No |

**Text, tree, Markdown, SVG, and PNG exports describe the structure; they do not create folders.** Only the ZIP contains real folder entries. Downloading any format does not modify existing folders on your device.

## Run locally

Requirements: **Node.js 22.12 or later** and npm. Node.js 24 is used in CI.

```sh
git clone https://github.com/tdoljyj/folderseed.git
cd folderseed
npm ci
npm run dev
```

Open the local URL printed by Vite. No `.env` file, credentials, database, or separate server is required.

```sh
npm run build       # Type-check and build the standalone app in dist/
npm run build:lib   # Build reusable ESM modules, types, and CSS in dist-lib/
npm run build:all   # Build both the standalone app and reusable library
npm run preview     # Preview the production app locally
npm test            # Run the core and export unit tests
```

The generated `dist/` directory is a static application.

### GitHub Pages deployment

The Pages workflow tests and builds each push to `main`, then publishes only `dist/` using GitHub's official Pages actions. It can also be run manually from the Actions tab on `main`. In repository Settings → Pages, the source must be **GitHub Actions**.

Expected deployment URL (available after the first successful Pages deployment): **https://tdoljyj.github.io/folderseed/**

No custom domain, paid service, user account, or repository secret is required. The build job has read-only repository access; only the deployment job receives the temporary Pages and OpenID Connect permissions needed by GitHub. Pull requests do not deploy.

To test the production build at the same project subpath locally:

```sh
npm run build:pages
npm run test:pages
npm run preview -- --base=/folderseed/
```

Open `http://127.0.0.1:4173/folderseed/`. The production smoke tests check the bundled script, stylesheet, local font, favicon, editing, saved drafts, and the available download formats. They supplement the full development-server browser suite, which also tests the development-only embedding example.

### Browser tests

```sh
npx playwright install chromium
npm run test:e2e
```

On Linux, Playwright may need system dependencies (`npx playwright install --with-deps chromium`). If your environment already provides a compatible Chromium, you can use it instead:

```sh
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

```sh
npm run check     # Unit tests, both builds, and browser tests
```

The test suite covers indentation and round-trips, document validation, immutable folder operations, and export contents. See the tests and the current CI run for the precise verified coverage; the existence of a test is not a guarantee about every browser or archive utility.

## Text editing

Use one unindented root and a consistent indentation style below it:

```text
My project
    Documents
        Notes
    Media
        Photos
        Video
    Archive
```

### Supported text formats

The toolbar has a **Visual editor** button and a split text-format button. Its label starts as **Plain text**: click the label to enter that text editor immediately, without opening a menu. The separate trailing arrow opens **Plain text**, **Markdown list**, **ASCII tree**, and **Unicode tree**. Choosing a menu item also enters its editor. The current format stays on the label when you return to visual editing; there is no placeholder, generic Text editor button, or automatic-format option.

The format menu supports arrow keys, Home/End, and typing the first letter of a format. Enter or Space chooses an item; Escape closes the menu and returns focus to its arrow button. Tab, clicking outside, or pressing the arrow button again dismisses it without changing formats.

Choosing a different format converts valid text to that representation; reopening the same format preserves its raw text. If the text is invalid, changing the format only changes how it is interpreted, so you can correct a mistaken format selection without losing the draft.

- **Plain text:** one root followed by indented children. Use two spaces, four spaces, or one tab per level. Indentation is detected from the first child; no manual setting is needed. Generated text and the Tab key use four spaces per level, while pasted or imported text keeps its original spacing.
- **Markdown list:** one-root nested unordered lists using `-`, `*`, or `+` markers, with consistent two-space, four-space, or tab indentation. Ordered lists are not supported. Exported labels use whole-name code spans so punctuation remains part of the folder name, not Markdown styling.
- **ASCII tree:** connector-based trees using `|--`, `` `-- ``, or `+--` branches. Only the connectors are ASCII; Unicode folder names remain UTF-8 text.
- **Unicode tree:** branches such as `├──` and `└──` with matching indentation.
- **Fenced text:** existing fenced plain, ASCII, and Unicode blocks are accepted in Markdown mode or through automatic file-import detection, including Markdown tree downloads. Explicit Plain text mode treats bullets, connectors, and fences as literal text rather than stripping them.

Blank lines are ignored. Mixed spaces and tabs, skipped levels, duplicate sibling names, and additional roots are rejected rather than guessed. A trailing `/` may mark a folder, but names containing path separators are not accepted.

For example, these Markdown and ASCII inputs describe the same structure:

```markdown
- My project
    - Documents
        - Notes
    - Media
```

```text
My project
|-- Documents
|   `-- Notes
`-- Media
```

### Comments in text

Append an exact **` // `** separator (a space, two slashes, and a space) after a folder name to add a comment. The first separator starts the comment; later separators remain literal comment text. The same suffix works in plain, ASCII, Unicode, and supported fenced trees:

```text
My project // Everything for this project
    Documents // Notes and reference material
    Media // Source assets // keep originals
```

Markdown lists use the same suffix inside each whole-label code span:

```markdown
- `My project // Everything for this project`
    - `Documents // Notes and reference material`
```

Generated Markdown chooses safe code-span delimiters when a label contains backticks. Comments are not rendered as Markdown or HTML. Slashes remain forbidden in folder names, so the separator cannot turn a valid folder name into a different name. An empty comment is omitted from saved data and generated text. Comments follow folders through renaming, reordering, and moving; editing only a comment does not rename its folder.

### File import versus pasted text

File imports use their extension to avoid guessing away parts of a folder name:

- `.txt` imports as **literal plain text**.
- `.ascii.txt` or `.ascii` imports as an **ASCII tree**.
- `.tree.txt` or `.tree` imports as a **Unicode tree**.
- `.md`, `.markdown`, or `.tree.md` imports as **Markdown**, including supported fenced blocks.
- `.json` imports the versioned project; other extensions use automatic text detection.

If a tree from another tool is saved as an ordinary `.txt` file, choose its format from the arrow menu and paste it into the text editor, or rename it to the appropriate `.ascii.txt` or `.tree.txt` suffix. FolderSeed's own downloads already use the matching suffixes. Plain-text downloads whose shortened basename would end in `.ascii` or `.tree` use `.plain.txt` to avoid being mistaken for a tree format.

### Automatic updates, without losing your text

There is no Apply button. Valid text updates the preview immediately and is committed to the folder model after **350 ms without further typing**. Typing bursts become undo steps, rather than one step per keystroke. Your raw formatting and cursor position are not rewritten during automatic updates. Text generated by visual edits is assigned a known format, so punctuation in a folder name cannot change its meaning on reload. Input-method composition is allowed to finish before committing.

An invalid draft shows an error with a source line when available and keeps the **last valid structure** in the preview. The invalid text stays in the editor; it is never silently replaced. Fix the error or choose **Revert text** to explicitly return to a valid structure. Export, switching to visual editing, importing, and opening a template are blocked while text is invalid.

Exporting, copying, or switching to visual editing commits valid pending text first, so these actions do not use an older version of the tree. **Copy tree** always copies the Unicode tree shown by the text-tree preview. Browser autosave retains the raw text, editor mode, selected format, and last valid document—including when the text is temporarily invalid or empty. Reloading restores that editing state; unfinished drafts from older versions also retain their original parsing rule. Older automatic-format drafts are assigned an explicit format only when that preserves their structure; invalid drafts keep their raw text and error until corrected or a format is explicitly chosen. Undo history remains session-only.

Template comments in text formats are localized snapshots, not reusable language bindings. Switching editor modes or formats without changing the parsed content preserves existing bindings. Re-entering exactly the same parsed names, structure, and comments also preserves them. A substantive text edit commits the whole displayed outline as literal comments; an inline note explains this before editing, without a confirmation dialog. There is no wording-based recovery of a template binding. JSON is the format for retaining those bindings.

All exported text and Markdown variants can be parsed again using their matching format. Internal file-import detection is a convenience, not a guarantee for syntax-like names: for example, choose Plain text to preserve a root literally named `- Notes`. Text parsing creates new IDs; JSON preserves IDs and is the preferred lossless project format.

## Reuse in your application

FolderSeed is an independent tool, not tied to another product, service, or store. No npm package has been published. You can use the built library locally or integrate the source directly.

### Build and consume the library

Run `npm run build:lib` in this repository. This creates ESM entry points, TypeScript declarations, and a separate stylesheet in `dist-lib/`. The package exports are:

| Import | Purpose |
| --- | --- |
| `folderseed` or `folderseed/core` | Framework-independent typed model and operations |
| `folderseed/exports` | ZIP, text, JSON, SVG, and PNG generation |
| `folderseed/react` | The React editor component and its prop types |
| `folderseed/styles.css` | Namespaced editor stylesheet |

From a separate application, add the built local checkout as a dependency:

```sh
npm install ../folderseed
```

Then import the pieces you need:

```tsx
import { createDocument } from 'folderseed/core';
import { FolderEditor } from 'folderseed/react';
import 'folderseed/styles.css';
```

Use the React entry in a React 19 application. React and `fflate` remain external dependencies of the library build; the core entry does not load them. Styles are not injected by the JavaScript bundle, so import the CSS explicitly. The build is ESM-only; CommonJS and UMD bundles are not provided. `private: true` remains enabled to prevent accidental npm publication.

The following examples use source imports for development inside this repository.

### Framework-independent core

The core has no React, DOM, filesystem, or network dependency. All operations return a new validated document without mutating their input.

```ts
import {
  addFolder,
  createDocument,
  formatTree,
  serializeJSON,
  setFolderComment,
} from './src/core';

const initial = createDocument('My project');
const updated = addFolder(initial, initial.root.id, 'Documents');
const annotated = setFolderComment(updated, updated.root.children[0].id, 'Notes and reference material');

console.log(formatTree(annotated));
const backup = serializeJSON(annotated);
```

Import text with `parseText(text, 'auto', 'auto')` or JSON with `parseJSON(text)`. Use `formatText(document, format, indent)` to produce a chosen text representation; `parseIndented` and `formatIndented` remain available for existing integrations. Validate untrusted object input with `validateDocument(input)` before using it. Validation failures are `DirectoryError` instances with a stable `code` and, where applicable, a `line`.

`FolderNode` has an optional `comment?: string` field and optional `commentBinding?: { source: 'folderseed-template'; key: string }` metadata. A bound node stores an English fallback comment plus a stable semantic key. Use `setFolderComment(document, folderId, text)` for an immutable, validated custom-comment update; it removes any binding, and an empty string also removes the comment. `validateComment(text)` validates a standalone comment, while `validateDocument` also enforces the combined comment-byte budget. `formatFolderLabel(node)` formats the name and optional comment suffix; paths and ZIP entry names continue to use `node.name` alone.

### JSON compatibility

The JSON wire format uses **`version: 3` when any comment has a template binding**, **`version: 2` for literal comments without bindings**, and **`version: 1` when there are no comments**. `parseJSON` and `validateDocument` read all three versions and preserve IDs and explicit bindings. Older version-1/version-2 projects remain literal; their comment wording is never used to infer a binding. Older readers reject unsupported newer versions instead of silently losing metadata. Export chooses the lowest version needed by the actual content.

JSON downloads and local drafts retain canonical fallback comments and bindings, regardless of the interface language. Text, Markdown, Copy tree, SVG, and PNG use a localized snapshot; ZIP paths still use only folder names. The framework-independent format/export helpers use the document passed to them and do not choose a language automatically. The React UI resolves its display/export snapshot separately. Unknown but valid template keys retain their saved fallback text.

The framework-independent `DirectoryDocument` returned by the current API retains its internal `version: 1` discriminant, including when its nodes have comments. Use **`serializeJSON(document)`**, rather than serializing that internal object directly, for the versioned interchange format. The standalone draft also stores the versioned wire document, while its existing `folderseed:draft:v1` storage key stays unchanged. No manual local-storage migration is needed.

```json
{
  "version": 3,
  "root": {
    "id": "project",
    "name": "My project",
    "comment": "The starting point for your folder structure.",
    "commentBinding": { "source": "folderseed-template", "key": "empty.root" },
    "children": []
  }
}
```

### React editor

```tsx
import { FolderEditor } from './src/ui/FolderEditor';
import './src/ui/style.css';
import { createDocument } from './src/core';

const initialDocument = createDocument('My project');

export function ProjectFolders() {
  return (
    <FolderEditor
      initialDocument={initialDocument}
      storageKey={false}
      themeStorageKey={false}
      languageStorageKey={false}
      onChange={(document) => console.log(document)}
    />
  );
}
```

`initialDocument` initializes the editor; it is not a continuously controlled value. `onChange` receives the initialized document and valid committed changes, including automatically committed text edits. It does not receive invalid text or raw drafts. Set `storageKey={false}` when the host owns persistence, or pass a unique string to isolate drafts between projects. The standalone app uses `folderseed:draft:v1`. Appearance has its own `themeStorageKey` prop: pass a separate string to isolate its preference, or `false` to keep it only in memory. Language has a separate `languageStorageKey` prop with the same custom-string or `false` behavior. Disabling draft persistence does not implicitly disable appearance or language persistence. Language changes do not emit document `onChange` callbacks.

See [the embedding example](examples/embedding.tsx) and [architecture notes](docs/architecture.md) for the data model, integration boundaries, and export helper. With `npm run dev` running, open `/examples/index.html` on the local dev server for a working host-owned editor example. This example is a development route, not a separate deployed service.

## Privacy and safety

- Editing, validation, and export happen in the browser. Folder names, comments, imported outlines, and drafts are not uploaded by the app.
- The app includes no analytics. Loading the hosted site sends ordinary requests for HTML, scripts, styles, and the bundled font to GitHub Pages; GitHub may collect request information such as IP addresses under its [Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Local-first editing does not mean the host receives no web requests.
- The application does not scan or write your filesystem. It generates downloads in memory.
- Folder names and comments are treated as text, not HTML or commands. No scripts are generated or run.
- Unsafe names, path traversal, control characters, operating-system reserved names, and duplicate sibling names are rejected.
- ZIP entries are folder-only, use validated paths, and preserve empty folders.
- Local drafts use browser storage and include raw editor text, even when invalid or empty, together with its mode, format, and the last valid document. An unreadable saved draft is preserved under a timestamped recovery key before the active draft is replaced; if that backup cannot be saved, autosave pauses rather than overwriting the original. Clearing site data, private browsing, storage restrictions, or a different browser can remove or hide them. **Export JSON for a portable backup.**
- After the app has loaded, editing and exports do not need a network connection. This is not an installable offline/PWA app; a first load or later reload may still require access to its host.

## Current limits

- One root, at most **500 folders**, and at most **32 nested levels** below the root.
- Names are at most **100 Unicode characters** and **255 UTF-8 bytes**. Names are normalized to NFC; sibling comparisons are case-insensitive.
- Comments are single-line text, at most **500 Unicode characters each** and **262,144 UTF-8 bytes combined**. They do not create files or change folder names.
- Text/JSON imports are limited to **1 MB**.
- PNG export is limited to **8,192 pixels per edge** and **32 million pixels**. Large structures should use SVG instead.
- Folder-only: no real files, file contents, symbolic links, filesystem import, or ZIP import.
- No collaboration, cloud sync, account system, or backend.
- Undo/redo retains up to 50 committed changes in the current session. Text edits are grouped by the automatic-update pause; history is not saved across reloads.
- Local browser storage is a convenience, not a durable backup or multi-tab synchronization system.
- Browser font availability affects image appearance, especially emoji and less common scripts. Image exports do not bundle fonts.
- Name validation improves portability, but total extracted path length, case rules, archive tools, and filesystem restrictions vary by platform. Keep deeply nested names short and inspect the destination when extracting.

### Mobile editing and spacing

Clicking or tapping a genuine blank area inside the owning workspace—including the gutters outside the editor card—clears selection. Controls, dialogs, scroll gestures, invalid inline edits, other editor instances, and unrelated host-page controls are not treated as blank workspace.

Phone-width trees do not reserve a drag grip for the immovable root. A root with children keeps only its working disclosure target; a childless root needs no leading slot. Nested folders keep their grip and use 14 px steps after the first level, without a redundant first-level offset. Desktop rows retain their existing geometry. Names gain space without moving on selection, while deep trees scroll inside the editor. Floating actions retain distinct 24 × 24 px targets.

Inline comment, rename, and new-folder fields focus within the opening tap, with a collapsed insertion caret at the end rather than selecting all text. Clicking an already open input keeps native caret placement. Native editable controls use real 16 px text on narrow or touch screens to avoid small-font focus zoom; the app never disables pinch zoom or forcibly resets an intentional zoom. Browser tests check focus, computed font sizes, viewport bounds, and selection geometry. Chromium touch emulation does not reproduce every physical iOS keyboard/zoom behavior, so physical-device verification remains a separate check.

## Development and contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep public documentation, source comments, and commit messages in English. UI translations belong in the locale catalogs. International folder names and user-authored comments are supported and covered by validation and export tests.

## License

[MIT](LICENSE).

### Brand typography

The FolderSeed wordmark uses a locally bundled, unmodified Source Sans 3 variable font (weight 500), licensed under SIL OFL 1.1. Body text retains its separate Arial/Helvetica stack. No font is fetched from a third party at runtime. The license is included in `public/SourceSans3-OFL.txt` and copied into the library distribution.

Font source: Google Fonts repository, commit `47d54ca1ebb14fd864695f1d39dc734f39017c33`, `ofl/sourcesans3/SourceSans3[wght].ttf`. SHA-256: `042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9`.
