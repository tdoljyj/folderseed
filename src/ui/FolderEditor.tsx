import { useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { addFolder, flatten, formatIndented, formatTree, LIMITS, moveFolder, parseIndented, parseJSON, removeFolder, renameFolder, validateDocument, type DirectoryDocument, type FolderNode, type ParseIndent } from '../core';
import { createExport, type ExportFormat } from '../exports';
import { Icon } from './Icon';
import { historyReducer } from './history';
import { makeTemplate, templates } from './templates';

export interface FolderEditorProps {
  initialDocument?: DirectoryDocument;
  onChange?: (document: DirectoryDocument) => void;
  /** Set a unique key per instance, or false to disable browser draft persistence. */
  storageKey?: string | false;
}
type Modal = { kind: 'add' | 'rename' | 'delete' | 'move'; id: string } | { kind: 'template'; index: number };
const formats: { id: ExportFormat; title: string; description: string; icon: string }[] = [
  { id: 'zip', title: 'Folder ZIP', description: 'Real, empty folders', icon: 'folder' },
  { id: 'txt', title: 'Plain text', description: 'Easy to copy & edit', icon: 'code' },
  { id: 'md', title: 'Markdown', description: 'For docs & READMEs', icon: 'code' },
  { id: 'json', title: 'Project JSON', description: 'Save & reopen later', icon: 'code' },
  { id: 'svg', title: 'Vector SVG', description: 'Crisp at any size', icon: 'image' },
  { id: 'png', title: 'Image PNG', description: 'Ready to share', icon: 'image' },
];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function loadInitial(initialDocument: DirectoryDocument | undefined, storageKey: string | false) {
  if (initialDocument) return { document: validateDocument(initialDocument), draft: '', warning: '', recoveryRaw: null as string | null, indent: 'auto' as ParseIndent };
  if (storageKey && typeof window !== 'undefined') {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
      if (raw) {
        if (raw.length > LIMITS.textBytes * 2) throw new Error('Draft too large');
        const stored = JSON.parse(raw);
        const document = validateDocument(stored.document);
        return { document, draft: typeof stored.draft === 'string' && stored.draft.length <= LIMITS.textBytes ? stored.draft : '', warning: '', recoveryRaw: null as string | null, indent: ([2, 4, 'tabs', 'auto'].includes(stored.indent) ? stored.indent : 'auto') as ParseIndent };
      }
    } catch { return { document: makeTemplate(0), draft: '', warning: 'Your saved draft could not be loaded. The original is preserved in browser storage. A fresh example is open; import a JSON backup to recover.', recoveryRaw: raw, indent: 'auto' as ParseIndent }; }
  }
  return { document: makeTemplate(0), draft: '', warning: '', recoveryRaw: null as string | null, indent: 'auto' as ParseIndent };
}

export function FolderEditor({ initialDocument, onChange, storageKey = 'folderseed:draft:v1' }: FolderEditorProps) {
  const [initial] = useState(() => loadInitial(initialDocument, storageKey));
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initial.document, future: [] });
  const doc = history.present;
  const [selectedId, setSelectedId] = useState(doc.root.id);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'visual' | 'text'>(initial.draft ? 'text' : 'visual');
  const [indent, setIndent] = useState<ParseIndent>(initial.indent);
  const [textDraft, setTextDraft] = useState(initial.draft || formatIndented(doc, initial.indent === 'auto' ? 2 : initial.indent));
  const [textDirty, setTextDirty] = useState(!!initial.draft);
  const [format, setFormat] = useState<ExportFormat>('zip');
  const [previewMode, setPreviewMode] = useState<'folders' | 'text'>('folders');
  const [modal, setModal] = useState<Modal | null>(null);
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [modalError, setModalError] = useState('');
  const [notice, setNotice] = useState(initial.warning);
  const [noticeError, setNoticeError] = useState(!!initial.warning);
  const [saveState, setSaveState] = useState(storageKey ? 'Saved on this device' : 'Local-only workspace');
  const [exporting, setExporting] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const importTicket = useRef(0);
  const contentRevision = useRef(0);
  const recoveryBackedUp = useRef(initial.recoveryRaw === null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => flatten(doc), [doc]);
  const selected = rows.find(row => row.node.id === selectedId) ?? rows[0];
  const parent = rows.find(row => row.node.id === selected.parentId)?.node;
  const siblingIndex = parent?.children.findIndex(node => node.id === selected.node.id) ?? -1;
  const parsed = useMemo(() => {
    if (!textDirty) return { document: doc, error: '' };
    try { return { document: parseIndented(textDraft, indent), error: '' }; }
    catch (error) { return { document: doc, error: errorMessage(error) }; }
  }, [doc, textDirty, textDraft, indent]);
  const previewDoc = mode === 'text' ? parsed.document : doc;
  const previewRows = useMemo(() => flatten(previewDoc), [previewDoc]);
  const depth = Math.max(...previewRows.map(row => row.depth)) + 1;

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onChangeRef.current?.(doc); }, [doc]);
  useEffect(() => {
    if (!rows.some(row => row.node.id === selectedId)) setSelectedId(doc.root.id);
  }, [doc, rows, selectedId]);
  useEffect(() => {
    if (!storageKey) return;
    try {
      // Preserve unreadable data before replacing the active key. If backup fails, keep the original untouched.
      if (!recoveryBackedUp.current && initial.recoveryRaw !== null) {
        try {
          localStorage.setItem(`${storageKey}:recovery:${new Date().toISOString()}`, initial.recoveryRaw);
          recoveryBackedUp.current = true;
        } catch { setSaveState('Autosave paused — unreadable draft preserved'); return; }
      }
      localStorage.setItem(storageKey, JSON.stringify({ document: doc, draft: textDirty ? textDraft : '', indent }));
      setSaveState('Saved on this device');
    } catch { setSaveState('Draft not saved — export JSON as a backup'); }
  }, [doc, textDirty, textDraft, storageKey, indent, initial.recoveryRaw]);
  useEffect(() => {
    if (!modal) return;
    dialog.current?.showModal();
    if (modal.kind === 'add' || modal.kind === 'rename') { nameInput.current?.focus(); nameInput.current?.select(); }
  }, [modal]);
  useEffect(() => {
    if (!textDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [textDirty]);

  function notify(message: string, error = false) { setNotice(message); setNoticeError(error); }
  function commit(next: DirectoryDocument, message: string) {
    contentRevision.current++;
    dispatch({ type: 'commit', document: next });
    setTextDraft(formatIndented(next, indent === 'auto' ? 2 : indent)); setTextDirty(false); notify(message);
  }
  function historyStep(type: 'undo' | 'redo') {
    if (textDirty) return notify('Apply or discard your text draft before using history.', true);
    const next = historyReducer(history, { type });
    contentRevision.current++;
    dispatch({ type }); setTextDraft(formatIndented(next.present, indent === 'auto' ? 2 : indent)); notify(type === 'undo' ? 'Change undone.' : 'Change restored.');
  }
  function openModal(next: Modal) {
    setModalError(''); setModal(next);
    if (next.kind === 'add') setName('');
    if (next.kind === 'rename') setName(rows.find(row => row.node.id === next.id)!.node.name);
    if (next.kind === 'move') setDestination(rows.find(row => row.node.id === next.id)?.parentId ?? doc.root.id);
  }
  function closeModal() { dialog.current?.close(); setModal(null); }
  function applyText() {
    if (parsed.error) return notify('Fix the highlighted text error before applying changes.', true);
    commit(parsed.document, 'Text changes applied. Your folders are ready.'); setCollapsed(new Set());
  }
  function submitModal(event: FormEvent) {
    event.preventDefault(); if (!modal) return;
    try {
      if (modal.kind === 'add') {
        const next = addFolder(doc, modal.id, name);
        const added = flatten(next).find(row => row.parentId === modal.id && row.node.name === name.normalize('NFC'))!;
        commit(next, 'Folder added.'); setSelectedId(added.node.id);
        setCollapsed(previous => { const next = new Set(previous); next.delete(modal.id); return next; });
      } else if (modal.kind === 'rename') commit(renameFolder(doc, modal.id, name), 'Folder renamed.');
      else if (modal.kind === 'delete') commit(removeFolder(doc, modal.id), 'Folder removed. You can undo this.');
      else if (modal.kind === 'move') {
        commit(moveFolder(doc, modal.id, destination), 'Folder moved.'); setCollapsed(new Set());
      } else if (modal.kind === 'template') {
        commit(makeTemplate(modal.index), 'Template opened. Your previous structure is available with Undo.'); setCollapsed(new Set()); setMode('visual');
      }
      closeModal();
    } catch (error) { setModalError(errorMessage(error)); }
  }
  function reorder(delta: number) {
    if (!parent) return;
    try { commit(moveFolder(doc, selected.node.id, parent.id, siblingIndex + delta), 'Folder order updated.'); }
    catch (error) { notify(errorMessage(error), true); }
  }
  function drop(event: DragEvent, target: string) {
    event.preventDefault(); setDropTarget(null);
    const source = dragId.current; dragId.current = null;
    if (!source || source === target) return;
    try { commit(moveFolder(doc, source, target), 'Folder moved.'); setCollapsed(new Set()); }
    catch (error) { notify(errorMessage(error), true); }
  }
  async function importFile(file: File) {
    const ticket = ++importTicket.current;
    const revision = contentRevision.current;
    try {
      if (textDirty) throw new Error('Apply or discard your text draft before importing.');
      if (file.size > LIMITS.textBytes) throw new Error('Please choose a text or JSON file smaller than 1 MB.');
      const text = await file.text();
      if (ticket !== importTicket.current) return;
      if (revision !== contentRevision.current) return notify('Import cancelled because your structure changed while the file was being read.', true);
      const next = file.name.toLowerCase().endsWith('.json') ? parseJSON(text) : parseIndented(text);
      commit(next, `Imported ${file.name}.`); setCollapsed(new Set()); setMode('visual');
    } catch (error) { if (ticket === importTicket.current) notify(errorMessage(error), true); }
  }
  async function download() {
    if (textDirty || exporting) return;
    setExporting(true);
    try {
      const result = await createExport(doc, format);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      notify(format === 'zip' ? 'Your ZIP is ready. Extract it to create the empty folders.' : `${format.toUpperCase()} exported. This describes your structure; ZIP creates real folders.`);
    } catch (error) { notify(errorMessage(error), true); }
    finally { setExporting(false); }
  }
  async function copyPreview() {
    try { await navigator.clipboard.writeText(formatTree(previewDoc)); notify('Folder tree copied.'); }
    catch { notify('Clipboard access is unavailable. Download Plain text instead.', true); }
  }
  function renderFolder(node: FolderNode, level: number) {
    const isSelected = node.id === selected.node.id;
    const isCollapsed = collapsed.has(node.id);
    return <li key={node.id}>
      <div className={`fs-tree-row ${isSelected ? 'is-selected' : ''} ${dropTarget === node.id ? 'is-drop-target' : ''}`} style={{ paddingLeft: 12 + level * 22 }}
        draggable={level > 0} onDragStart={event => { dragId.current = node.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', node.id); }}
        onDragEnd={() => { dragId.current = null; setDropTarget(null); }} onDragOver={event => { if (dragId.current && dragId.current !== node.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(node.id); } }}
        onDragLeave={() => setDropTarget(null)} onDrop={event => drop(event, node.id)}>
        {node.children.length ? <button type="button" className="fs-disclosure" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`} aria-expanded={!isCollapsed} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}><Icon name={isCollapsed ? 'chevron' : 'down'} size={13}/></button> : <span className="fs-disclosure-placeholder"/>}
        <button type="button" className="fs-folder-select" aria-pressed={isSelected} onClick={() => setSelectedId(node.id)} title={node.name}><span className={`fs-folder-icon ${level === 0 ? 'root' : ''}`}><Icon name="folder" size={20}/></span><span className="fs-folder-name">{node.name}</span>{level === 0 && <span className="fs-root-label">ROOT</span>}</button>
        <span className="fs-row-count">{node.children.length || ''}</span><span className="fs-drag-hint"><Icon name="grip" size={15}/></span>
      </div>
      {!isCollapsed && node.children.length > 0 && <ul>{node.children.map(child => renderFolder(child, level + 1))}</ul>}
    </li>;
  }
  const modalRow = modal && modal.kind !== 'template' ? rows.find(row => row.node.id === modal.id) : undefined;
  const modalTitle = !modal ? '' : modal.kind === 'template' ? `Start with ${templates[modal.index].name.toLowerCase()}?` : modal.kind === 'add' ? 'A new place for something.' : modal.kind === 'rename' ? 'Give it a new name.' : modal.kind === 'delete' ? 'Remove this folder?' : 'Find a new home.';
  const descendants = modalRow ? new Set(flatten({ version: 1, root: modalRow.node }).map(row => row.node.id)) : new Set<string>();

  return <div className="fs-app">
    <aside className="fs-sidebar">
      <a className="fs-brand" href="#workspace" aria-label="FolderSeed workspace"><span className="fs-brand-mark"><Icon name="seed" size={26}/></span><span>FolderSeed<span className="fs-brand-subtitle">A little structure goes a long way.</span></span></a>
      <div className="fs-sidebar-section"><span className="fs-eyebrow">YOUR WORKSPACE</span><a className="fs-nav-active" href="#workspace"><Icon name="tree"/>Folder builder<span className="fs-nav-dot"/></a></div>
      <div className="fs-sidebar-section fs-templates"><span className="fs-eyebrow">A PLACE TO START</span><p>Skip the blank canvas.</p>{templates.map((template, index) => <button key={template.id} type="button" className="fs-template" disabled={textDirty} onClick={() => openModal({ kind: 'template', index })}><span className={`fs-template-icon color-${index}`}><Icon name={template.icon}/></span><span><strong>{template.name}</strong><small>{template.description}</small></span><Icon name="chevron" size={13}/></button>)}</div>
      <div className="fs-privacy-card"><span className="fs-privacy-icon"><Icon name="shield" size={22}/></span><strong>Your folders. Your device.</strong><p>No uploads, accounts, or tracking. Everything happens right here in your browser.</p><span className="fs-local-badge"><span/>LOCAL-FIRST BY DESIGN</span></div>
      <div className="fs-sidebar-footer">Made for fresh starts.<span>FolderSeed · v0.1</span></div>
    </aside>
    <main className="fs-main" id="workspace">
      <header className="fs-topbar"><span className="fs-breadcrumb">Workspace <Icon name="chevron" size={12}/> Folder builder</span><span className="fs-save-state"><span className={saveState.startsWith('Draft not') ? 'warning' : ''}/>{saveState}</span></header>
      <section className="fs-heading"><div><span className="fs-eyebrow">FROM A SMALL SEED, A CLEARER SPACE</span><h1>A little structure.<br className="fs-mobile-break"/> A fresh start.</h1><p>Shape your folders, make them yours, and take them anywhere.</p></div><button type="button" className="fs-button fs-import" disabled={textDirty} onClick={() => fileInput.current?.click()}><Icon name="upload"/>Import structure</button><input type="file" accept=".json,.txt,.md,.markdown,text/plain,application/json" ref={fileInput} hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }}/></section>
      <div className="fs-mobile-templates"><span><Icon name="spark" size={15}/>Need a starting point?</span><select aria-label="Choose a template" value="" disabled={textDirty} onChange={event => { if (event.target.value !== '') openModal({ kind: 'template', index: Number(event.target.value) }); }}><option value="" disabled>Choose a template</option>{templates.map((template, index) => <option key={template.id} value={index}>{template.name}</option>)}</select></div>
      <div className="fs-workspace-grid">
        <section className="fs-panel fs-editor" aria-label="Folder editor">
          <div className="fs-panel-heading"><div><span className="fs-step">01</span><h2>Make it yours</h2></div><div className="fs-history"><button type="button" aria-label="Undo" title="Undo" disabled={!history.past.length || textDirty} onClick={() => historyStep('undo')}><Icon name="undo" size={17}/></button><button type="button" aria-label="Redo" title="Redo" disabled={!history.future.length || textDirty} onClick={() => historyStep('redo')}><Icon name="redo" size={17}/></button></div></div>
          <div className="fs-editor-tabs" role="tablist" aria-label="Editing mode"><button type="button" role="tab" aria-selected={mode === 'visual'} aria-controls="visual-editor" id="visual-tab" onClick={() => { if (textDirty) notify('Apply or discard your text draft before switching to visual editing.', true); else setMode('visual'); }}><Icon name="tree" size={16}/>Visual editor</button><button type="button" role="tab" aria-selected={mode === 'text'} aria-controls="text-editor" id="text-tab" onClick={() => { setMode('text'); if (!textDirty) setTextDraft(formatIndented(doc, indent === 'auto' ? 2 : indent)); }}><Icon name="code" size={16}/>Text editor</button></div>
          {mode === 'visual' ? <div id="visual-editor" role="tabpanel" aria-labelledby="visual-tab" className="fs-visual-area">
            <div className="fs-tree-help"><span>{rows.length} folders, a world of possibilities</span><span>Drag to nest</span></div>
            <ul className="fs-tree" aria-label="Folder list">{renderFolder(doc.root, 0)}</ul>
            {rows.length === 1 && <div className="fs-empty-hint"><Icon name="spark" size={23}/><p>Every good structure starts somewhere.<br/>Add your first folder below.</p></div>}
            <button type="button" className="fs-add-folder" onClick={() => openModal({ kind: 'add', id: selected.node.id })}><Icon name="plus" size={17}/>Add folder<span>inside {selected.node.name}</span></button>
            <div className="fs-selection-tools"><div className="fs-selected-path" title={selected.path}><Icon name="folder" size={14}/><span>{selected.path}</span></div><div className="fs-tool-buttons"><button type="button" onClick={() => openModal({ kind: 'rename', id: selected.node.id })}><Icon name="edit" size={15}/>Rename</button><button type="button" disabled={!parent} onClick={() => openModal({ kind: 'move', id: selected.node.id })}><Icon name="move" size={15}/>Move</button><button type="button" aria-label="Move up" title="Move up" disabled={!parent || siblingIndex <= 0} onClick={() => reorder(-1)}><Icon name="up" size={15}/></button><button type="button" aria-label="Move down" title="Move down" disabled={!parent || siblingIndex >= parent.children.length - 1} onClick={() => reorder(1)}><Icon name="down" size={15}/></button><button type="button" className="fs-danger-icon" aria-label="Delete folder" title="Delete folder" disabled={!parent} onClick={() => openModal({ kind: 'delete', id: selected.node.id })}><Icon name="trash" size={15}/></button></div></div>
          </div> : <div id="text-editor" role="tabpanel" aria-labelledby="text-tab" className="fs-text-area"><div className="fs-text-options"><label htmlFor="indent">Indentation</label><select id="indent" value={indent} onChange={event => { const nextIndent: ParseIndent = event.target.value === '2' ? 2 : event.target.value === '4' ? 4 : event.target.value as ParseIndent; setIndent(nextIndent); if (!textDirty) setTextDraft(formatIndented(doc, nextIndent === 'auto' ? 2 : nextIndent)); }}><option value="auto">Auto-detect</option><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="tabs">Tabs</option></select></div><textarea aria-label="Folder structure text" spellCheck={false} value={textDraft} onChange={event => { contentRevision.current++; setTextDraft(event.target.value); setTextDirty(true); }} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); const input = event.currentTarget; const position = input.selectionStart; const insertion = indent === 'tabs' ? '\t' : indent === 4 ? '    ' : '  '; const next = textDraft.slice(0, position) + insertion + textDraft.slice(input.selectionEnd); contentRevision.current++; setTextDraft(next); setTextDirty(true); requestAnimationFrame(() => { input.selectionStart = input.selectionEnd = position + insertion.length; }); } }}/><p className="fs-text-guide">One folder per line. Indent children with 2 spaces, 4 spaces, or tabs. A single root keeps everything together.</p>{parsed.error ? <div className="fs-inline-error" role="alert">{parsed.error}</div> : textDirty && <div className="fs-text-valid"><Icon name="check" size={14}/>Valid structure · preview updated</div>}<div className="fs-text-actions"><button type="button" className="fs-button" disabled={!textDirty} onClick={() => { contentRevision.current++; setTextDraft(formatIndented(doc, indent === 'auto' ? 2 : indent)); setTextDirty(false); notify('Text draft discarded.'); }}>Discard draft</button><button type="button" className="fs-button fs-primary" disabled={!textDirty || !!parsed.error} onClick={applyText}>Apply changes</button></div></div>}
        </section>
        <section className="fs-panel fs-preview" aria-label="Live preview"><div className="fs-panel-heading"><div><span className="fs-step">02</span><h2>See it take shape</h2></div><span className={`fs-live-badge ${parsed.error && mode === 'text' ? 'is-paused' : ''}`}><span/>{parsed.error && mode === 'text' ? 'LAST SAVED' : 'LIVE PREVIEW'}</span></div><div className="fs-preview-toolbar"><div className="fs-segmented"><button type="button" aria-pressed={previewMode === 'folders'} onClick={() => setPreviewMode('folders')}>Folders</button><button type="button" aria-pressed={previewMode === 'text'} onClick={() => setPreviewMode('text')}>Text tree</button></div><button type="button" className="fs-copy" onClick={() => void copyPreview()}><Icon name="copy" size={15}/>Copy tree</button></div><div className="fs-preview-canvas">{previewMode === 'text' ? <pre className="fs-text-preview">{formatTree(previewDoc)}</pre> : <div className="fs-preview-tree">{previewRows.map(({ node, depth }) => <div className={`fs-preview-row ${depth === 0 ? 'fs-preview-root' : ''}`} key={node.id} style={{ marginLeft: depth * 24 }}><span className="fs-preview-branch"/><span className="fs-preview-folder"><Icon name="folder" size={depth === 0 ? 23 : 20}/></span><span>{node.name}</span>{depth === 0 && <span className="fs-preview-root-badge">YOUR ROOT FOLDER</span>}</div>)}</div>}</div><div className="fs-preview-stats"><span><strong>{previewRows.length}</strong> folders</span><span><strong>{depth}</strong> {depth === 1 ? 'level' : 'levels'}</span><span><Icon name="check" size={14}/>No files, just possibilities</span></div></section>
      </div>
      <section className="fs-panel fs-export" aria-label="Export structure"><div className="fs-export-heading"><div><span className="fs-step">03</span><h2>Take it with you</h2></div><p>A real folder structure, or a picture of the plan. Your choice.</p></div><div className="fs-export-options" role="radiogroup" aria-label="Export format">{formats.map(item => <button key={item.id} type="button" role="radio" aria-checked={format === item.id} onClick={() => setFormat(item.id)} className={format === item.id ? 'is-active' : ''}><span className="fs-format-icon"><Icon name={item.icon} size={20}/></span><strong>{item.title}</strong><small>{item.description}</small><span className="fs-radio-dot"/></button>)}</div><div className="fs-export-bottom"><p><Icon name="info" size={17}/>{textDirty ? 'Apply or discard your text draft before exporting.' : format === 'zip' ? <span><strong>Real folders, ready to use.</strong> Extract your ZIP to create this structure. No files or scripts included.</span> : format === 'json' ? <span><strong>A reusable project backup.</strong> Import this JSON into FolderSeed to keep editing later.</span> : <span><strong>A description, not real folders.</strong> Choose Folder ZIP if you want actual folders on your device.</span>}</p><button type="button" className="fs-button fs-primary fs-download" disabled={textDirty || exporting} onClick={() => void download()}><Icon name="download"/>{exporting ? 'Preparing…' : `Download ${format.toUpperCase()}`}</button></div></section>
      {notice && <div className={`fs-notice ${noticeError ? 'is-error' : ''}`} role={noticeError ? 'alert' : 'status'}><Icon name={noticeError ? 'info' : 'check'} size={17}/><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
      <footer className="fs-footer"><span>Small beginnings. Well-organized possibilities.</span><span><Icon name="shield" size={13}/>Your structure never leaves this browser.</span></footer>
    </main>
    {modal && <dialog ref={dialog} className="fs-dialog" aria-labelledby="folderseed-dialog-title" onCancel={closeModal} onClick={event => { if (event.target === event.currentTarget) closeModal(); }}><form onSubmit={submitModal}><div className="fs-dialog-top"><span className="fs-dialog-icon"><Icon name={modal.kind === 'delete' ? 'trash' : modal.kind === 'move' ? 'move' : 'folder'} size={25}/></span><button type="button" aria-label="Close dialog" className="fs-icon-button" onClick={closeModal}><Icon name="close"/></button></div><h2 id="folderseed-dialog-title">{modalTitle}</h2>{modal.kind === 'add' || modal.kind === 'rename' ? <><p>{modal.kind === 'add' ? `Inside ${modalRow?.path}` : `Rename ${modalRow?.node.name}. Its contents stay together.`}</p><label htmlFor="folder-name">Folder name</label><input id="folder-name" ref={nameInput} value={name} onChange={event => { setName(event.target.value); setModalError(''); }} placeholder="e.g. Ideas, Photos, First drafts" maxLength={200} required autoComplete="off"/><small>Use a name, not a path. Avoid / \ : * ? &quot; &lt; &gt; |</small></> : modal.kind === 'delete' ? <p>Remove <strong>{modalRow?.node.name}</strong>{descendants.size > 1 ? ` and its ${descendants.size - 1} nested folders` : ''}? This only changes your plan, not folders on your device. You can undo it.</p> : modal.kind === 'move' ? <><p>Move <strong>{modalRow?.node.name}</strong> and everything inside it.</p><label htmlFor="destination">New parent folder</label><select id="destination" value={destination} onChange={event => setDestination(event.target.value)}>{rows.filter(row => !descendants.has(row.node.id)).map(row => <option key={row.node.id} value={row.node.id}>{row.path}</option>)}</select></> : <p>This will replace the current plan with a fresh template. You can use Undo to bring your previous structure back.</p>}{modalError && <div className="fs-inline-error" role="alert">{modalError}</div>}<div className="fs-dialog-actions"><button type="button" className="fs-button" onClick={closeModal}>Cancel</button><button type="submit" className={`fs-button ${modal.kind === 'delete' ? 'fs-danger' : 'fs-primary'}`}>{modal.kind === 'add' ? 'Add folder' : modal.kind === 'rename' ? 'Save name' : modal.kind === 'delete' ? 'Remove folder' : modal.kind === 'move' ? 'Move folder' : 'Use template'}</button></div></form></dialog>}
  </div>;
}
