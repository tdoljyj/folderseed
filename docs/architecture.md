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

- `parseIndented(text, indent?)`: accepts `'auto'`, `2`, `4`, or `'tabs'`; also accepts generated Unicode tree text and a single fenced Markdown block.
- `formatIndented(document, indent?)`: formats with two spaces by default.
- `formatTree(document)`: produces readable Unicode connectors.
- `parseJSON(text)` and `serializeJSON(document)`: the versioned, ID-preserving project format.
- `flatten(document)`: returns nodes with `parentId`, `depth`, and slash-separated relative `path`.

Automatic indentation detection uses the first indented line, then enforces the detected style. It does not infer missing levels or silently repair mixed indentation. Errors retain source line numbers where possible.

### Immutable editing

- `addFolder(document, parentId, name)`
- `renameFolder(document, id, name)`
- `removeFolder(document, id)`
- `moveFolder(document, id, parentId, index?)`

Each operation returns a validated copy. Deleting or moving the root is rejected. A move cannot target the node itself or any descendant. `index` is the final insertion position in the destination after removing the source; omit it to append.

These pure operations make history straightforward: retain earlier documents rather than relying on inverse operations. Hosts can build their own history and persistence around the same core.

## Export helpers (`src/exports/index.ts`)

```ts
import { createExport } from './src/exports';

const { blob, filename } = await createExport(document, 'zip');
```

Download filenames retain their format extension and are shortened when necessary to fit 255 UTF-8 bytes. This does not rename the root folder inside the document or ZIP.

`ExportFormat` is `'zip' | 'txt' | 'md' | 'json' | 'svg' | 'png'`. Every format validates the input before generating output. The caller owns the download interaction.

- **ZIP** uses `fflate`; each node has a zero-byte archive entry ending in `/` with directory metadata. No files, scripts, or placeholder contents are included.
- **TXT** is a two-space outline.
- **Markdown** uses a fenced tree and chooses a fence length that safely contains backticks in folder names.
- **JSON** is the versioned document.
- **SVG** is XML-escaped vector markup with no scripts, external resources, or `foreignObject`. `renderSVG(document)` exposes the SVG text and dimensions.
- **PNG** rasterizes the SVG using browser image and canvas APIs. It needs a browser; the other exports do not require the DOM. Dimension and pixel limits protect against unsupported or excessive canvases.

## React editor (`src/ui/FolderEditor.tsx`)

The reusable editor accepts:

```ts
interface FolderEditorProps {
  initialDocument?: DirectoryDocument;
  onChange?: (document: DirectoryDocument) => void;
  storageKey?: string | false;
}
```

The editor owns its document and editing history (up to 50 committed changes in memory). Text editing is staged: valid drafts update preview, but only applying the draft changes the committed document. Invalid drafts leave the committed preview intact. Applying or discarding is required before export and other structure-changing actions. `initialDocument` is an initialization value, not a controlled prop. `onChange` reports the initialized document and valid committed changes, not text drafts. Do not use the callback to repeatedly remount the editor unless resetting selection and history is intentional.

Styles use the `.fs-app` root and namespaced `.fs-*` classes; import `src/ui/style.css` for source integration or `folderseed/styles.css` for the built package once in the host. The source example in `examples/embedding.tsx` disables browser persistence and keeps a host-level snapshot.

### Persistence

The standalone editor keeps its draft in browser `localStorage` under `folderseed:draft:v1`. Set a different `storageKey` to isolate separate embedded projects, or set it to `false` to opt out. A host that persists documents should validate them on load and use JSON exports for portable backups.

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
