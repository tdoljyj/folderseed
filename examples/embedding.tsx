import { useState } from 'react';
import { createDocument, serializeJSON, type DirectoryDocument } from '../src/core';
import { FolderEditor } from '../src/ui/FolderEditor';
import '../src/ui/style.css';

/** A host-owned draft: no browser persistence or product-specific dependency. */
export function EmbeddedFolderSettings() {
  const [initialDocument] = useState(() => createDocument('My project'));
  const [document, setDocument] = useState<DirectoryDocument>(initialDocument);

  return (
    <section aria-label="Project folder settings">
      <FolderEditor
        initialDocument={initialDocument}
        onChange={setDocument}
        storageKey={false}
      />
      <details>
        <summary>Validated document available to the host</summary>
        <pre>{serializeJSON(document)}</pre>
      </details>
    </section>
  );
}
