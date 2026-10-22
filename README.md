# FolderSeed

**Plan a folder structure. Make it yours. Download the real folders.**

FolderSeed is a small, local-first folder editor for people who would rather arrange folders than write scripts. Build your structure visually, edit it as text, and choose the export that fits your next step.

No account, backend, API key, or command-line knowledge is needed to use the editor. Your draft stays in your browser; the app includes no analytics or folder-upload service. The website host may log ordinary web requests (see Privacy and safety).

## What you can do

- Add, rename, delete, reorder, and move folders in a visual editor.
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

No dragging is required. A fresh workspace has no folder selected. Click a folder to immediately reveal eight action icons: **Move up**, **Move down**, **Move to parent level**, **Move into previous sibling**, **Add sibling folder**, **Add child folder**, **Rename**, and **Delete folder**. Moving to the parent level places the whole subtree immediately after its former parent; moving inward appends it inside the preceding sibling. Add sibling inserts immediately after selection, while Add child opens the selected folder if it was collapsed. Unavailable actions are disabled: the root cannot move, gain a sibling, or be deleted, and a first sibling has no preceding folder to move into. The controls surround the selected folder in the same arrangement on desktop and mobile: Move up/down sit above/below the folder icon, Move to parent level sits to its left, Rename sits above the name, the two Add controls sit below the name, and Move into previous sibling and Delete sit to its right. Selecting or deselecting never shifts the folder glyph or name horizontally. The eight action symbols are 14 px; their buttons remain 24 px high on desktop and 28 px on mobile (usually 32/36 px wide, with a 30 px outdent button). The compact frame stays 72/84 px high. Controls fit closely around short names, long names truncate, and no controls cover neighboring folders. Deep folders keep their original indentation and scroll horizontally within the tree when necessary rather than jumping left to fit. Click genuine blank space in the tree or editor, or press Escape, to clear selection and hide the controls and selected path. Clicking action controls, disclosure arrows, or dialog content does not clear selection. Selecting another folder immediately shows its actions; importing, opening a template, or reloading starts with no selection. Selection is not saved in the draft. After selecting a folder, its path and the general **Move** action become available. For any other destination, use **Move** and choose a **New parent folder** and **Position**. All controls are keyboard accessible, have descriptive labels/tooltips, and keep core name/depth safeguards. Moves keep the subtree together, support Undo/Redo, and preserve the displayed order in autosaved drafts and exports.

With focus in the editor, use **Ctrl+Z** (Mac: **Cmd+Z**) to undo visual changes, including drag reordering. Redo with **Ctrl/Cmd+Shift+Z** or **Ctrl+Y**. Text fields and editable content keep their native text undo; document shortcuts are paused in dialogs and during input-method composition. Shortcuts do not capture keys from controls outside an embedded FolderSeed editor.

## Appearance

Open the **FolderSeed** menu at the bottom of the sidebar, then choose **Settings**. On smaller screens, use the settings button in the workspace header. **System** follows your device appearance and reacts to changes automatically; **Light** and **Dark** stay fixed until you choose otherwise. Changes apply immediately.

The preference is saved separately from your folder draft, under `folderseed:theme:v1`. Changing appearance does not apply, discard, or alter unfinished text. If browser storage is blocked, the setting still works for the current session and Settings shows a session-only notice. Themes affect the editor, not the exported folder structure or a surrounding host application.

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
| **JSON** | The complete versioned document, including stable folder IDs. Best for backup or integration. | Yes |
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
} from './src/core';

const initial = createDocument('My project');
const updated = addFolder(initial, initial.root.id, 'Documents');

console.log(formatTree(updated));
const backup = serializeJSON(updated);
```

Import text with `parseText(text, 'auto', 'auto')` or JSON with `parseJSON(text)`. Use `formatText(document, format, indent)` to produce a chosen text representation; `parseIndented` and `formatIndented` remain available for existing integrations. Validate untrusted object input with `validateDocument(input)` before using it. Validation failures are `DirectoryError` instances with a stable `code` and, where applicable, a `line`.

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
      onChange={(document) => console.log(document)}
    />
  );
}
```

`initialDocument` initializes the editor; it is not a continuously controlled value. `onChange` receives the initialized document and valid committed changes, including automatically committed text edits. It does not receive invalid text or raw drafts. Set `storageKey={false}` when the host owns persistence, or pass a unique string to isolate drafts between projects. The standalone app uses `folderseed:draft:v1`. Appearance has its own `themeStorageKey` prop: pass a separate string to isolate its preference, or `false` to keep it only in memory. Disabling draft persistence does not implicitly disable theme persistence.

See [the embedding example](examples/embedding.tsx) and [architecture notes](docs/architecture.md) for the data model, integration boundaries, and export helper. With `npm run dev` running, open `/examples/index.html` on the local dev server for a working host-owned editor example. This example is a development route, not a separate deployed service.

## Privacy and safety

- Editing, validation, and export happen in the browser. Folder names, imported outlines, and drafts are not uploaded by the app.
- The app includes no analytics. Loading the hosted site sends ordinary requests for HTML, scripts, styles, and the bundled font to GitHub Pages; GitHub may collect request information such as IP addresses under its [Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Local-first editing does not mean the host receives no web requests.
- The application does not scan or write your filesystem. It generates downloads in memory.
- Folder names are treated as text, not HTML or commands. No scripts are generated or run.
- Unsafe names, path traversal, control characters, operating-system reserved names, and duplicate sibling names are rejected.
- ZIP entries are folder-only, use validated paths, and preserve empty folders.
- Local drafts use browser storage and include raw editor text, even when invalid or empty, together with its mode, format, and the last valid document. An unreadable saved draft is preserved under a timestamped recovery key before the active draft is replaced; if that backup cannot be saved, autosave pauses rather than overwriting the original. Clearing site data, private browsing, storage restrictions, or a different browser can remove or hide them. **Export JSON for a portable backup.**
- After the app has loaded, editing and exports do not need a network connection. This is not an installable offline/PWA app; a first load or later reload may still require access to its host.

## Current limits

- One root, at most **500 folders**, and at most **32 nested levels** below the root.
- Names are at most **100 Unicode characters** and **255 UTF-8 bytes**. Names are normalized to NFC; sibling comparisons are case-insensitive.
- Text/JSON imports are limited to **1 MB**.
- PNG export is limited to **8,192 pixels per edge** and **32 million pixels**. Large structures should use SVG instead.
- Folder-only: no real files, file contents, symbolic links, filesystem import, or ZIP import.
- No collaboration, cloud sync, account system, or backend.
- Undo/redo retains up to 50 committed changes in the current session. Text edits are grouped by the automatic-update pause; history is not saved across reloads.
- Local browser storage is a convenience, not a durable backup or multi-tab synchronization system.
- Browser font availability affects image appearance, especially emoji and less common scripts. Image exports do not bundle fonts.
- Name validation improves portability, but total extracted path length, case rules, archive tools, and filesystem restrictions vary by platform. Keep deeply nested names short and inspect the destination when extracting.

## Development and contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep public code, documentation, comments, and UI copy in English. International folder names are supported and covered by validation and export tests.

## License

[MIT](LICENSE).

### Brand typography

The FolderSeed wordmark uses a locally bundled, unmodified Source Sans 3 variable font (weight 500), licensed under SIL OFL 1.1. Body text retains its separate Arial/Helvetica stack. No font is fetched from a third party at runtime. The license is included in `public/SourceSans3-OFL.txt` and copied into the library distribution.

Font source: Google Fonts repository, commit `47d54ca1ebb14fd864695f1d39dc734f39017c33`, `ofl/sourcesans3/SourceSans3[wght].ttf`. SHA-256: `042fe2cc0b933e328410d7acbd0aa6a1873dca5aef81875f4bc214b08825c7b9`.
