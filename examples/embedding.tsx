import { useState } from 'react';
import { createDocument, serializeJSON } from '../src/core';
import { FolderEditor } from '../src/ui/FolderEditor';
import '../src/ui/style.css';

/** A host-owned draft: no browser persistence or product-specific dependency. */
export function EmbeddedFolderSettings() {
  const [initialDocument] = useState(() => createDocument('My project'));
  const [state, setState] = useState({ document: initialDocument, updates: 0 });

  return (
    <section aria-label="Project folder settings">
      <header style={{ padding: '16px 24px', fontFamily: 'system-ui', background: '#eaf2e8', color: '#315944' }}>
        <strong>Host application example</strong>
        {' · '}Committed updates: <output data-testid="host-update-count">{state.updates}</output>
      </header>
      <FolderEditor
        initialDocument={initialDocument}
        storageKey={false}
        onChange={(document) => setState(current => ({ document, updates: current.updates + 1 }))}
      />
      <details style={{ padding: 24, fontFamily: 'system-ui' }}>
        <summary>Validated document available to the host</summary>
        <pre>{serializeJSON(state.document)}</pre>
      </details>
    </section>
  );
}
