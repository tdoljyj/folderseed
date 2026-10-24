import { Fragment, useId, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type CSSProperties, type MouseEvent, type ChangeEvent, type CompositionEvent } from 'react';
import { addFolder, flatten, formatIndented, formatTree, LIMITS, moveFolder, parseText, formatText, detectTextFormat, parseJSON, removeFolder, renameFolder, setFolderComment, serializeJSON, validateDocument, type DirectoryDocument, type FolderNode, type ParseIndent, type TextFormat } from '../core';
import { createExport, type ExportFormat } from '../exports';
import { Icon } from './Icon';
import { FormatSwitch } from './FormatSwitch';
import { AppMenu, SettingsDialog } from './Settings';
import { useTheme } from './theme';
import { I18nProvider, useI18n, useLanguage, readBrowserLocale, readLanguagePreference, createTranslator } from './i18n';
import { bottomAncestorTargets, dropDepth, dropPlacement, moveByDrop, resolveDropTarget, type DropPlacement } from './dragDrop';
import { historyReducer, historyShortcut } from './history';
import { addSiblingFolder, indentFolder, outdentFolder } from './folderActions';
import { restoreTextFormat, type ExplicitTextFormat } from './draftFormat';
import { makeTemplate, templates } from './templates';

export interface FolderEditorProps {
  initialDocument?: DirectoryDocument;
  onChange?: (document: DirectoryDocument) => void;
  /** Set a unique key per instance, or false to disable browser draft persistence. */
  storageKey?: string | false;
  /** Independent appearance preference; false keeps theme changes in this session only. */
  themeStorageKey?: string | false;
  /** Independent language preference; false keeps overrides in this editor session only. */
  languageStorageKey?: string | false;
}
type Modal = { kind: 'move'; id: string } | { kind: 'template'; index: number };
type DeleteUndo = { before: DirectoryDocument; after: DirectoryDocument; folderId: string };
type InlineEdit = { kind: 'rename' | 'add' | 'comment'; id: string; afterId?: string; anchorId: string; value: string; error: string };
const formats: { id: ExportFormat; title: string; description: string; icon: string }[] = [
  { id: 'zip', title: 'Folder ZIP', description: 'Real, empty folders', icon: 'folder' },
  { id: 'txt', title: 'Plain text', description: 'Easy to copy & edit', icon: 'code' },
  { id: 'md', title: 'Markdown', description: 'For docs & READMEs', icon: 'code' },
  { id: 'json', title: 'Project JSON', description: 'Save & reopen later', icon: 'code' },
  { id: 'svg', title: 'Vector SVG', description: 'Crisp at any size', icon: 'image' },
  { id: 'png', title: 'Image PNG', description: 'Ready to share', icon: 'image' },
];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

const AUTO_APPLY_MS = 350;
const OUTPUT_INDENT = 4;
interface InitialState {
  document: DirectoryDocument;
  draft: string | null;
  pending: boolean;
  mode: 'visual' | 'text';
  textFormat: TextFormat;
  indent: ParseIndent;
  warning: string;
  recoveryRaw: string | null;
  freshTemplate: boolean;
}
function loadInitial(initialDocument: DirectoryDocument | undefined, storageKey: string | false): InitialState {
  const defaults = { draft: null, pending: false, mode: 'visual' as const, textFormat: 'plain' as TextFormat, indent: 'auto' as ParseIndent, warning: '', recoveryRaw: null, freshTemplate: false };
  if (initialDocument) return { ...defaults, textFormat: 'plain', document: validateDocument(initialDocument) };
  if (storageKey && typeof window !== 'undefined') {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
      if (raw) {
        if (raw.length > LIMITS.textBytes * 2) throw new Error('Draft too large');
        const stored = JSON.parse(raw);
        const document = validateDocument(stored.document);
        const hasDraft = typeof stored.draft === 'string';
        // Older drafts used an empty string for "no draft" and did not persist a pending flag.
        const draft = hasDraft && (typeof stored.pending === 'boolean' || stored.draft !== '') ? stored.draft as string : null;
        const restoredIndent: ParseIndent = [2, 4, 'tabs', 'auto'].includes(stored.indent) ? stored.indent : 'auto';
        // A saved committed model is authoritative. Do not reinterpret its unchanged raw source on reload.
        const pending = draft !== null && stored.pending !== false;
        return {
          ...defaults, document, draft,
          pending,
          mode: stored.mode === 'text' || pending ? 'text' : 'visual',
          textFormat: restoreTextFormat(stored.textFormat, draft, document, pending, restoredIndent),
          indent: pending ? restoredIndent : 'auto',
        };
      }
    } catch {
      return { ...defaults, document: makeTemplate(0), freshTemplate: true, warning: 'Your saved draft could not be loaded. The original is preserved in browser storage. A fresh example is open; import a JSON backup to recover.', recoveryRaw: raw };
    }
  }
  return { ...defaults, document: makeTemplate(0), freshTemplate: true };
}

/** Ignore regenerated text-import IDs when deciding whether a typing burst changed the tree. */
function sameStructure(first: DirectoryDocument, second: DirectoryDocument): boolean {
  return formatIndented(first) === formatIndented(second);
}

export function FolderEditor(props: FolderEditorProps) {
  const language = useLanguage(props.languageStorageKey ?? 'folderseed:language:v1');
  return <I18nProvider value={language}><FolderEditorContent {...props}/></I18nProvider>;
}

function FolderEditorContent({ initialDocument, onChange, storageKey = 'folderseed:draft:v1', themeStorageKey = 'folderseed:theme:v1', languageStorageKey = 'folderseed:language:v1' }: FolderEditorProps) {
  const { t, translateError, locale, direction } = useI18n();
  const theme = useTheme(themeStorageKey);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement | null>(null);
  const [initial] = useState(() => loadInitial(initialDocument, storageKey));
  const freshTemplateInitialized = useRef(!initial.freshTemplate);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initial.document, future: [] });
  const doc = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'visual' | 'text'>(initial.mode);
  const [textFormat, setTextFormat] = useState<TextFormat>(initial.textFormat);
  // Only unfinished legacy drafts retain an explicit parsing rule; new input is auto-detected.
  const [indent, setIndent] = useState<ParseIndent>(initial.indent);
  const [textDraft, setTextDraft] = useState(initial.draft ?? formatIndented(doc, OUTPUT_INDENT));
  const [textDirty, setTextDirty] = useState(initial.pending);
  const [composing, setComposing] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('zip');
  const [previewMode, setPreviewMode] = useState<'folders' | 'text'>('folders');
  const [modal, setModal] = useState<Modal | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null);
  const inlineRef = useRef<InlineEdit | null>(null);
  const inlineComposing = useRef(false);
  const inlineErrorId = useId();
  const [destination, setDestination] = useState('');
  const [destinationBefore, setDestinationBefore] = useState('end');
  const [modalError, setModalError] = useState('');
  const [notice, setNotice] = useState(initial.warning);
  const [noticeError, setNoticeError] = useState(!!initial.warning);
  const [deleteUndo, setDeleteUndo] = useState<DeleteUndo | null>(null);
  const deleteUndoRef = useRef<DeleteUndo | null>(null);
  const [saveState, setSaveState] = useState(storageKey ? 'Saved on this device' : 'Local-only workspace');
  const [exporting, setExporting] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; hoverId: string; placement: DropPlacement; invalid: boolean } | null>(null);
  const dragId = useRef<string | null>(null);
  const dragGesture = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragToolbarId, setDragToolbarId] = useState<string | null>(null);
  const dragDescendants = useRef(new Set<string>());
  const composingRef = useRef(false);
  const draftPersisted = useRef(false);
  const onChangeRef = useRef(onChange);
  const importTicket = useRef(0);
  const contentRevision = useRef(0);
  const recoveryBackedUp = useRef(initial.recoveryRaw === null);
  const appRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const historyFocusId = useRef<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const visualAreaRef = useRef<HTMLDivElement>(null);
  const [actionBounds, setActionBounds] = useState<{ left: number; top: number; width: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const inlineInput = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [commentBounds, setCommentBounds] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);
  const rows = useMemo(() => flatten(doc), [doc]);
  const lastVisibleFolder = useMemo(() => {
    let node = doc.root;
    while (!collapsed.has(node.id) && node.children.length) node = node.children[node.children.length - 1];
    return node;
  }, [doc, collapsed]);
  const bottomTargets = useMemo(() => draggingId ? bottomAncestorTargets(doc, draggingId, lastVisibleFolder.id) : [], [doc, draggingId, lastVisibleFolder]);
  const selected = rows.find(row => row.node.id === selectedId);
  const parent = rows.find(row => row.node.id === selected?.parentId)?.node;
  const siblingIndex = parent?.children.findIndex(node => node.id === selectedId) ?? -1;
  // Keep the controls' footprint fixed until a native drag finishes.
  const actionOwnerId = inlineEdit ? null : draggingId ? dragToolbarId : selectedId;
  const actionOwner = rows.find(row => row.node.id === actionOwnerId);
  useLayoutEffect(() => {
    const tree = treeRef.current;
    const area = visualAreaRef.current;
    const frame = tree && Array.from(tree.querySelectorAll<HTMLButtonElement>('.fs-folder-select'))
      .find(button => button.dataset.folderId === actionOwnerId)?.closest<HTMLElement>('.fs-folder-frame');
    if (mode !== 'visual' || !tree || !area || !frame) { setActionBounds(null); return; }
    let animation = 0;
    const update = () => {
      animation = 0;
      const anchor = frame.getBoundingClientRect();
      const viewport = tree.getBoundingClientRect();
      if (anchor.bottom <= viewport.top || anchor.top >= viewport.top + tree.clientHeight) {
        if (area.querySelector('.fs-floating-actions')?.contains(document.activeElement)) editorRef.current?.focus({ preventScroll: true });
        setActionBounds(null);
        return;
      }
      const origin = area.getBoundingClientRect();
      const next = { left: anchor.left - origin.left, top: anchor.top - origin.top + anchor.height / 2 - 34, width: anchor.width };
      setActionBounds(previous => previous && Math.abs(previous.left - next.left) < 0.1 && Math.abs(previous.top - next.top) < 0.1 && Math.abs(previous.width - next.width) < 0.1 ? previous : next);
    };
    const schedule = () => { if (!animation) animation = requestAnimationFrame(update); };
    update();
    tree.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(tree); observer?.observe(area); observer?.observe(frame);
    return () => {
      if (animation) cancelAnimationFrame(animation);
      tree.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [actionOwnerId, doc, collapsed, mode]);
  useLayoutEffect(() => {
    const tree = treeRef.current;
    const area = visualAreaRef.current;
    const anchor = tree && Array.from(tree.querySelectorAll<HTMLButtonElement>('.fs-folder-select'))
      .find(button => button.dataset.folderId === inlineEdit?.id)?.closest<HTMLElement>('.fs-tree-row');
    if (inlineEdit?.kind !== 'comment' || !tree || !area || !anchor) { setCommentBounds(null); return; }
    const update = () => {
      const row = anchor.getBoundingClientRect();
      const viewport = tree.getBoundingClientRect();
      const origin = area.getBoundingClientRect();
      const above = row.bottom + 46 > viewport.top + tree.clientHeight;
      const anchoredTop = above ? row.top - origin.top - 44 : row.bottom - origin.top + 4;
      const top = Math.max(viewport.top - origin.top + 4, Math.min(anchoredTop, viewport.top + tree.clientHeight - origin.top - 44));
      setCommentBounds({ top, left: viewport.left - origin.left + 8, width: Math.max(128, tree.clientWidth - 16), above });
    };
    update();
    tree.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(tree); observer?.observe(area);
    return () => { tree.removeEventListener('scroll', update); window.removeEventListener('resize', update); observer?.disconnect(); };
  }, [inlineEdit?.kind, inlineEdit?.id, doc, collapsed, mode]);
  const levelActions = useMemo(() => {
    const result = { outdent: '', indent: '' };
    if (!selected) return { outdent: 'Select a folder first.', indent: 'Select a folder first.' };
    for (const action of ['outdent', 'indent'] as const) {
      try { (action === 'outdent' ? outdentFolder : indentFolder)(doc, selected.node.id); }
      catch (error) { result[action] = errorMessage(error); }
    }
    return result;
  }, [doc, selectedId]);
  const parsed = useMemo(() => {
    if (!textDirty || composing) return { document: doc, error: '' };
    try { return { document: parseText(textDraft, textFormat, indent), error: '' }; }
    catch (error) { return { document: doc, error: errorMessage(error) }; }
  }, [doc, textDirty, textDraft, indent, textFormat, composing]);
  const invalidDraft = textDirty && !!parsed.error;
  const blockedDraft = invalidDraft || composing;
  const previewDoc = mode === 'text' && !composing ? parsed.document : doc;
  const previewRows = useMemo(() => flatten(previewDoc), [previewDoc]);
  const depth = Math.max(...previewRows.map(row => row.depth)) + 1;
  const activeExportCard = format === 'ascii' || format === 'unicode' ? 'txt' : format === 'md-tree' ? 'md' : format;
  const statusLabel = saveState.startsWith('Draft not') || saveState.startsWith('Autosave paused') ? saveState : inlineEdit ? inlineEdit.kind === 'comment' ? 'Editing folder comment…' : 'Editing folder name…' : composing ? 'Composing text…' : textDirty && !parsed.error ? 'Saving changes…' : invalidDraft ? `Draft invalid · ${saveState === 'Saving draft…' ? 'saving draft…' : storageKey ? 'saved on this device' : 'kept in this session'}` : saveState;

  useEffect(() => {
    if (!textDirty || parsed.error || composing) return;
    const revision = contentRevision.current;
    const timer = window.setTimeout(() => {
      if (revision !== contentRevision.current || composingRef.current) return;
      applyPendingText();
    }, AUTO_APPLY_MS);
    return () => window.clearTimeout(timer);
  }, [textDirty, textDraft, textFormat, indent, parsed, composing]);

  useLayoutEffect(() => {
    if (historyFocusId.current && mode === 'visual') {
      focusFolderNow(historyFocusId.current);
      historyFocusId.current = null;
    }
  }, [doc, selectedId, mode, collapsed]);
  useEffect(() => {
    if (freshTemplateInitialized.current) return;
    freshTemplateInitialized.current = true;
    if (contentRevision.current !== 0 || doc !== initial.document) return;
    // Defer browser preference reads until mount to keep SSR and hydration identical.
    // Saved/custom documents and subsequent language changes never rewrite comments.
    const { preference } = readLanguagePreference(languageStorageKey);
    const initialLocale = preference === 'auto' ? readBrowserLocale() : preference;
    const next = makeTemplate(0, createTranslator(initialLocale));
    if (sameStructure(doc, next)) return;
    dispatch({ type: 'initialize', document: next });
    setTextDraft(formatIndented(next, OUTPUT_INDENT));
  }, [initial, doc, languageStorageKey]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onChangeRef.current?.(doc); }, [doc]);
  useEffect(() => {
    if (selectedId && !rows.some(row => row.node.id === selectedId)) setSelectedId(null);
  }, [doc, rows, selectedId]);
  useEffect(() => {
    draftPersisted.current = false;
    if (!storageKey) { setSaveState('Kept in this session'); return; }
    try {
      // Preserve unreadable data before replacing the active key. If backup fails, keep the original untouched.
      if (!recoveryBackedUp.current && initial.recoveryRaw !== null) {
        try {
          localStorage.setItem(`${storageKey}:recovery:${new Date().toISOString()}`, initial.recoveryRaw);
          recoveryBackedUp.current = true;
        } catch { setSaveState('Autosave paused — unreadable draft preserved'); return; }
      }
      localStorage.setItem(storageKey, JSON.stringify({ document: JSON.parse(serializeJSON(doc)), draft: textDraft, pending: textDirty, mode, textFormat, indent }));
      draftPersisted.current = true;
      setSaveState('Saved on this device');
    } catch { setSaveState('Draft not saved — copy your text before leaving'); }
  }, [doc, textDirty, textDraft, storageKey, indent, textFormat, mode, initial.recoveryRaw]);
  useEffect(() => {
    if (!modal) return;
    dialog.current?.showModal();
  }, [modal]);
  useEffect(() => {
    const inlineDirty = inlineEdit && (inlineEdit.kind === 'add' ? !!inlineEdit.value : inlineEdit.value !== (inlineEdit.kind === 'comment' ? rows.find(row => row.node.id === inlineEdit.id)?.node.comment ?? '' : rows.find(row => row.node.id === inlineEdit.id)?.node.name));
    if (!textDirty && !inlineDirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (inlineDirty || !draftPersisted.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [textDirty, inlineEdit, doc]);

  function openSettings(trigger: HTMLButtonElement | null) { if (inlineRef.current && !finishInline()) return; settingsTrigger.current = trigger; setSettingsOpen(true); }
  function closeSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => {
      const origin = settingsTrigger.current;
      const target = origin?.getClientRects().length ? origin : [...(appRef.current?.querySelectorAll<HTMLButtonElement>('.fs-app-menu-trigger') ?? [])].find(button => button.getClientRects().length);
      target?.focus();
    });
  }
  function clearDeleteUndo() { deleteUndoRef.current = null; setDeleteUndo(null); }
  function notify(message: string, error = false) { clearDeleteUndo(); setNotice(message); setNoticeError(error); }
  function editorText(next: DirectoryDocument, chosenFormat = textFormat) {
    let outputFormat = chosenFormat;
    if (outputFormat === 'auto') {
      try { outputFormat = detectTextFormat(textDraft); } catch { outputFormat = 'plain'; }
    }
    return formatText(next, outputFormat, OUTPUT_INDENT);
  }
  function replaceEditorText(next: DirectoryDocument) {
    // Programmatic output has a known syntax; pin it rather than guessing from a new folder name.
    let outputFormat = textFormat;
    if (outputFormat === 'auto') {
      try { outputFormat = detectTextFormat(textDraft); } catch { outputFormat = 'plain'; }
      setTextFormat(outputFormat);
    }
    setTextDraft(editorText(next, outputFormat));
  }
  function commit(next: DirectoryDocument, message?: string) {
    clearDeleteUndo();
    contentRevision.current++;
    dispatch({ type: 'commit', document: next });
    replaceEditorText(next); setTextDirty(false); setIndent('auto');
    if (message !== undefined) notify(message);
  }
  function applyPendingText(): DirectoryDocument | null {
    if (composingRef.current || parsed.error) return null;
    if (!textDirty) return doc;
    clearDeleteUndo();
    contentRevision.current++;
    const next = sameStructure(doc, parsed.document) ? doc : parsed.document;
    if (next !== doc) dispatch({ type: 'commit', document: next });
    // Do not serialize here: preserve the user's spelling, spacing, selection, and caret.
    setTextDirty(false);
    if (textFormat === 'auto') setTextFormat(restoreTextFormat('auto', textDraft, next, false, indent));
    setIndent('auto');
    setCollapsed(new Set());
    return next;
  }
  function flushText(): DirectoryDocument | null {
    if (inlineRef.current) return finishInline();
    const next = applyPendingText();
    if (!next) notify(composingRef.current ? 'Finish composing text before continuing.' : 'Fix the text error or revert to the last valid structure before continuing.', true);
    return next;
  }
  function changeText(value: string) {
    clearDeleteUndo();
    contentRevision.current++;
    draftPersisted.current = false;
    setSaveState(storageKey ? 'Saving draft…' : 'Kept in this session');
    setTextDraft(value); setTextDirty(true);
  }
  function revertText() {
    contentRevision.current++;
    replaceEditorText(doc); setTextDirty(false); setIndent('auto'); notify('Restored the last valid structure.');
  }
  function changeTextFormat(nextFormat: ExplicitTextFormat) {
    if (composingRef.current) return;
    contentRevision.current++;
    if (invalidDraft) { setTextFormat(nextFormat); setMode('text'); return; }
    const next = flushText();
    if (!next) return;
    setTextFormat(nextFormat);
    if (nextFormat !== textFormat) setTextDraft(editorText(next, nextFormat));
    setMode('text');
  }
  function historyStep(type: 'undo' | 'redo') {
    clearDeleteUndo();
    const nextDocument = flushText();
    if (!nextDocument) return;
    const current = nextDocument === doc ? history : historyReducer(history, { type: 'commit', document: nextDocument });
    const next = historyReducer(current, { type });
    contentRevision.current++;
    if (mode === 'visual') {
      const nextRows = flatten(next.present);
      let nextSelected = nextRows.find(row => row.node.id === selectedId);
      // Keep a deliberate selection when possible, but never invent one on entry or reload.
      let ancestorId = selected?.parentId;
      while (!nextSelected && ancestorId) {
        nextSelected = nextRows.find(row => row.node.id === ancestorId);
        ancestorId = rows.find(row => row.node.id === ancestorId)?.parentId;
      }
      historyFocusId.current = nextSelected?.node.id ?? next.present.root.id;
      setSelectedId(nextSelected?.node.id ?? null);
      setCollapsed(previous => {
        const expanded = new Set(previous);
        let parentId = nextSelected?.parentId;
        while (parentId) { expanded.delete(parentId); parentId = nextRows.find(row => row.node.id === parentId)?.parentId ?? null; }
        return expanded;
      });
    }
    dispatch({ type }); replaceEditorText(next.present); setTextDirty(false); setIndent('auto'); notify(type === 'undo' ? 'Change undone.' : 'Change restored.');
  }
  function handleHistoryKey(event: KeyboardEvent<HTMLDivElement>) {
    if (modal || settingsOpen || blockedDraft || composingRef.current || event.defaultPrevented) return;
    if (inlineRef.current && event.key === 'Escape' && !inlineComposing.current && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); cancelInline(); return; }
    const target = event.target;
    if (target instanceof Element && (target.closest('input, textarea, select, [role="textbox"]') || (target instanceof HTMLElement && target.isContentEditable))) return;
    if (inlineRef.current) {
      if (historyShortcut(event.nativeEvent)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (event.key === 'Escape' && !draggingId && selectedId) {
      event.preventDefault(); event.stopPropagation(); clearSelection(true); return;
    }
    const action = historyShortcut(event.nativeEvent);
    if (!action || (action === 'undo' ? !history.past.length && !textDirty : !history.future.length || textDirty)) return;
    event.preventDefault(); event.stopPropagation(); historyStep(action);
  }
  function focusFolderNow(id: string) {
    const button = [...(appRef.current?.querySelectorAll<HTMLButtonElement>('.fs-folder-select') ?? [])].find(item => item.dataset.folderId === id);
    button?.focus({ preventScroll: true });
  }
  function focusFolder(id: string) { requestAnimationFrame(() => focusFolderNow(id)); }
  function selectFolder(id: string) { if (inlineRef.current && !finishInline()) return; setSelectedId(id); }
  function clearSelection(focusEditor = false) {
    if (inlineRef.current && !finishInline()) return;
    setSelectedId(null);
    if (focusEditor) editorRef.current?.focus({ preventScroll: true });
  }
  function handleEditorBackgroundClick(event: MouseEvent<HTMLElement>) {
    if (modal || settingsOpen || draggingId || dragId.current || dragGesture.current) return;
    const target = event.target;
    // Only the actual background owns this gesture, never a row, button, or dialog descendant.
    if (target instanceof Element && target.matches('.fs-editor, .fs-visual-area, .fs-tree, .fs-tree-tail, .fs-tree-item, .fs-panel-heading, .fs-editor-toolbar, .fs-tree-help, .fs-selection-summary')) clearSelection(true);
  }
  function updateInline(next: InlineEdit | null) { inlineRef.current = next; setInlineEdit(next); }
  function beginInline(kind: InlineEdit['kind'], id: string, afterId?: string) {
    const latest = flushText();
    if (!latest) return;
    clearDeleteUndo();
    const anchorId = afterId ?? id;
    const node = flatten(latest).find(row => row.node.id === id)!.node;
    const value = kind === 'rename' ? node.name : kind === 'comment' ? node.comment ?? '' : '';
    contentRevision.current++;
    updateInline({ kind, id, afterId, anchorId, value, error: '' });
    setSelectedId(anchorId);
    if (kind === 'add') setCollapsed(previous => { const next = new Set(previous); next.delete(id); return next; });
    requestAnimationFrame(() => { inlineInput.current?.focus(); inlineInput.current?.select(); });
  }
  function cancelInline() {
    const edit = inlineRef.current;
    if (!edit) return;
    inlineComposing.current = false;
    updateInline(null);
    focusFolder(edit.anchorId);
  }
  function finishInline(restoreFocus = true): DirectoryDocument | null {
    const edit = inlineRef.current;
    if (!edit) return doc;
    if (inlineComposing.current) return null;
    try {
      const next = edit.kind === 'rename' ? renameFolder(doc, edit.id, edit.value)
        : edit.kind === 'comment' ? setFolderComment(doc, edit.id, edit.value) : edit.afterId ? addSiblingFolder(doc, edit.afterId, edit.value) : addFolder(doc, edit.id, edit.value);
      const selected = edit.kind !== 'add' ? edit.id
        : flatten(next).find(row => row.parentId === edit.id && row.node.name === edit.value.normalize('NFC'))!.node.id;
      updateInline(null);
      if (!sameStructure(doc, next)) commit(next, edit.kind === 'comment' ? 'Comment saved.' : edit.kind === 'rename' ? 'Folder renamed.' : 'Folder added.');
      setSelectedId(selected); if (restoreFocus) focusFolder(selected);
      return next;
    } catch (error) {
      updateInline({ ...edit, error: errorMessage(error) });
      requestAnimationFrame(() => { if (inlineRef.current) inlineInput.current?.focus({ preventScroll: true }); });
      return null;
    }
  }
  function renderInlineName() {
    const edit = inlineEdit!;
    const isComment = edit.kind === 'comment';
    const fieldProps = {
      ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => { inlineInput.current = element; },
      className: `fs-inline-name ${isComment ? 'fs-inline-comment' : ''}`,
      'aria-label': t(isComment ? 'Folder comment' : 'Folder name'),
      title: isComment ? t('Edit comment for {name}', { name: rows.find(row => row.node.id === edit.id)?.node.name ?? '' }) : undefined,
      'aria-invalid': !!edit.error,
      'aria-describedby': edit.error ? inlineErrorId : undefined,
      value: edit.value,
      placeholder: t(isComment ? 'Add comment' : 'New folder'),
      maxLength: isComment ? LIMITS.commentLength * 2 : 200,
      autoComplete: 'off', spellCheck: false, dir: 'auto',
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const current = inlineRef.current;
        if (current) { contentRevision.current++; updateInline({ ...current, value: event.target.value, error: '' }); }
      },
      onCompositionStart: () => { inlineComposing.current = true; },
      onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        inlineComposing.current = false;
        const current = inlineRef.current;
        if (current) updateInline({ ...current, value: event.currentTarget.value });
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing || inlineComposing.current || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finishInline(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelInline(); }
      },
    };
    return <div className="fs-inline-editor" onClick={event => event.stopPropagation()} onBlur={event => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      if (inlineRef.current) finishInline(false);
    }}>
      {isComment ? <textarea {...fieldProps} rows={1}/> : <input {...fieldProps}/>}
      <button type="button" className="fs-inline-save" aria-label={t(isComment ? 'Save comment' : 'Save name')} title={t(isComment ? 'Save comment' : 'Save name')} onMouseDown={event => event.preventDefault()} onClick={() => finishInline()}><Icon name="check" size={16}/></button>
      <button type="button" className="fs-inline-cancel" aria-label={t(isComment ? 'Cancel comment' : 'Cancel editing')} title={t(isComment ? 'Cancel comment' : 'Cancel editing')} onMouseDown={event => event.preventDefault()} onClick={cancelInline}><Icon name="close" size={16}/></button>
      {edit.error && <span className="fs-inline-error" id={inlineErrorId} role="alert">{translateError(edit.error)}</span>}
    </div>;
  }
  function renderPlaceholder(level: number) {
    return <li className="fs-inline-placeholder" style={{ '--fs-action-inset': `${level * 22}px` } as CSSProperties}><div className="fs-folder-frame"><div className="fs-tree-row is-selected" style={{ paddingLeft: 12 + level * 22 }}>
      <span className="fs-drag-hint is-fixed" aria-hidden="true"/><span className="fs-disclosure-placeholder"/><div className="fs-folder-select"><span className="fs-folder-icon"><Icon name="folder" size={20}/></span>{renderInlineName()}</div>
    </div></div></li>;
  }
  function openModal(next: Modal) {
    if (!flushText()) return;
    setModalError(''); setModal(next);
    if (next.kind === 'move') { setDestination(rows.find(row => row.node.id === next.id)?.parentId ?? doc.root.id); setDestinationBefore('end'); }
  }
  function closeModal() { dialog.current?.close(); setModal(null); }
  function submitModal(event: FormEvent) {
    event.preventDefault(); if (!modal) return;
    try {
      if (modal.kind === 'move') {
        const children = rows.find(row => row.node.id === destination)!.node.children.filter(child => child.id !== modal.id);
        const index = destinationBefore === 'end' ? undefined : children.findIndex(child => child.id === destinationBefore);
        commit(moveFolder(doc, modal.id, destination, index), 'Folder moved.'); setCollapsed(new Set());
      } else if (modal.kind === 'template') {
        commit(makeTemplate(modal.index, t), 'Template opened. Your previous structure is available with Undo.'); clearSelection(); setCollapsed(new Set()); setMode('visual');
      }
      closeModal();
    } catch (error) { setModalError(errorMessage(error)); }
  }
  function deleteFolder(id: string) {
    if (id === doc.root.id || draggingId || modal || settingsOpen) return;
    const latest = flushText();
    if (!latest) return;
    try {
      // Unchanged inline names may produce an equivalent copy without a history entry.
      const before = sameStructure(doc, latest) ? doc : latest;
      const parentId = flatten(before).find(row => row.node.id === id)?.parentId;
      if (!parentId) return;
      const after = removeFolder(before, id);
      commit(after);
      const action = { before, after, folderId: id };
      deleteUndoRef.current = action; setDeleteUndo(action);
      setSelectedId(parentId); historyFocusId.current = parentId;
    } catch (error) { notify(errorMessage(error), true); }
  }
  function undoDeletion() {
    const action = deleteUndoRef.current;
    // Never turn a stale toast into an undo of a newer edit, including batched events.
    if (!action || doc !== action.after || history.past.at(-1) !== action.before) { clearDeleteUndo(); return; }
    if (inlineRef.current || textDirty || composingRef.current || modal || settingsOpen) return;
    clearDeleteUndo(); contentRevision.current++;
    dispatch({ type: 'undo' }); replaceEditorText(action.before); setTextDirty(false); setIndent('auto');
    setSelectedId(action.folderId);
    if (mode === 'visual') historyFocusId.current = action.folderId;
    const restoredRows = flatten(action.before);
    setCollapsed(previous => {
      const next = new Set(previous);
      let parentId = restoredRows.find(row => row.node.id === action.folderId)?.parentId;
      while (parentId) { next.delete(parentId); parentId = restoredRows.find(row => row.node.id === parentId)?.parentId; }
      return next;
    });
    notify('Change undone.');
  }
  function changeLevel(action: 'outdent' | 'indent') {
    if (!selected) return;
    try {
      const next = (action === 'outdent' ? outdentFolder : indentFolder)(doc, selected.node.id);
      commit(next, action === 'outdent' ? 'Moved to the parent level.' : siblingIndex === 0 ? 'Moved into the next sibling.' : 'Moved into the previous sibling.');
      setCollapsed(new Set()); focusFolder(selected.node.id);
    } catch (error) { notify(errorMessage(error), true); }
  }
  function reorder(delta: number) {
    if (!selected || !parent) return;
    try { commit(moveFolder(doc, selected.node.id, parent.id, siblingIndex + delta), 'Folder order updated.'); focusFolder(selected.node.id); }
    catch (error) { notify(errorMessage(error), true); }
  }
  function dragDestination(event: DragEvent<HTMLElement>, target: string, isRoot: boolean, behavior: 'row' | 'tail' | 'band' | 'frame' = 'row') {
    const row = behavior === 'frame' ? event.currentTarget.querySelector('.fs-tree-row') : null;
    const bounds = (row ?? event.currentTarget).getBoundingClientRect();
    const placement: DropPlacement = (behavior === 'tail' || behavior === 'band') && !isRoot ? 'after' : dropPlacement(event.clientY - bounds.top, bounds.height, isRoot);
    const tree = treeRef.current;
    const depth = tree ? dropDepth(event.clientX, tree.getBoundingClientRect().left - tree.scrollLeft) : Infinity;
    return { id: behavior === 'band' ? target : resolveDropTarget(doc, target, placement, depth), placement };
  }
  function dragOver(event: DragEvent<HTMLElement>, target: string, isRoot: boolean, behavior: 'row' | 'tail' | 'band' | 'frame' = 'row') {
    const source = dragId.current;
    if (!source) return;
    event.preventDefault(); event.stopPropagation();
    const destination = dragDestination(event, target, isRoot, behavior);
    if (source === destination.id) { event.dataTransfer.dropEffect = 'none'; setDropTarget(null); return; }
    const invalid = dragDescendants.current.has(destination.id);
    event.dataTransfer.dropEffect = invalid ? 'none' : 'move';
    setDropTarget(previous => previous?.id === destination.id && previous.hoverId === target && previous.placement === destination.placement && previous.invalid === invalid ? previous : { ...destination, hoverId: target, invalid });
  }
  function drop(event: DragEvent<HTMLElement>, target: string, isRoot: boolean, behavior: 'row' | 'tail' | 'band' | 'frame' = 'row') {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    const source = dragId.current; dragId.current = null; dragDescendants.current.clear(); setDraggingId(null);
    if (!source) return;
    try {
      const destination = dragDestination(event, target, isRoot, behavior);
      const next = moveByDrop(doc, source, destination.id, destination.placement);
      if (!sameStructure(doc, next)) { commit(next, 'Folder moved.'); setCollapsed(new Set()); }
    } catch (error) { notify(errorMessage(error), true); }
    finally { focusFolder(source); }
  }
  function isTrailingSpace(event: DragEvent<HTMLUListElement>) {
    const content = event.currentTarget.firstElementChild;
    const trailing = event.target === event.currentTarget || event.target instanceof HTMLElement && event.target.classList.contains('fs-tree-tail');
    return trailing && !!content && event.clientY >= content.getBoundingClientRect().bottom;
  }
  async function importFile(file: File) {
    clearDeleteUndo();
    if (!flushText()) return;
    const ticket = ++importTicket.current;
    const revision = contentRevision.current;
    try {
      if (file.size > LIMITS.textBytes) throw new Error('Please choose a text or JSON file smaller than 1 MB.');
      const text = await file.text();
      if (ticket !== importTicket.current) return;
      if (revision !== contentRevision.current) return notify('Import cancelled because your structure changed while the file was being read.', true);
      const lowerName = file.name.toLowerCase();
      const importedFormat: TextFormat = /\.ascii(?:\.txt)?$/.test(lowerName) ? 'ascii' : /\.tree(?:\.txt)?$/.test(lowerName) ? 'unicode' : /\.md$|\.markdown$/.test(lowerName) ? 'markdown' : lowerName.endsWith('.txt') ? 'plain' : 'auto';
      const isJSON = lowerName.endsWith('.json');
      const next = isJSON ? parseJSON(text) : parseText(text, importedFormat);
      commit(next, `Imported ${file.name}.`);
      if (!isJSON) { setTextDraft(text); setTextFormat(restoreTextFormat(importedFormat, text, next, false, 'auto')); setIndent('auto'); }
      clearSelection(); setCollapsed(new Set()); setMode('visual');
    } catch (error) { if (ticket === importTicket.current) notify(errorMessage(error), true); }
  }
  async function download() {
    if (exporting) return;
    const latest = flushText();
    if (!latest) return;
    setExporting(true);
    try {
      const result = await createExport(latest, format);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      notify(format === 'zip' ? 'Your ZIP is ready. Extract it to create the empty folders.' : `${format.toUpperCase()} exported. This describes your structure; ZIP creates real folders.`);
    } catch (error) { notify(errorMessage(error), true); }
    finally { setExporting(false); }
  }
  async function copyPreview() {
    const latest = flushText();
    if (!latest) return;
    try { await navigator.clipboard.writeText(formatTree(latest)); notify('Folder tree copied.'); }
    catch { notify('Clipboard access is unavailable. Download Plain text instead.', true); }
  }
  function renderFolder(node: FolderNode, level: number) {
    const isSelected = node.id === selectedId;
    const isCollapsed = collapsed.has(node.id);
    const target = dropTarget?.id === node.id ? dropTarget : null;
    const hasActions = actionOwnerId === node.id;
    const editing = inlineEdit?.kind === 'rename' && inlineEdit.id === node.id;
    const addingChild = inlineEdit?.kind === 'add' && inlineEdit.id === node.id && !inlineEdit.afterId;
    return <Fragment key={node.id}><li className={`fs-tree-item ${hasActions ? 'has-context-actions' : ''}`} style={{ '--fs-action-inset': `${level * 22}px` } as CSSProperties}
      onDragOver={event => { if (event.target === event.currentTarget) dragOver(event, node.id, level === 0, 'frame'); }}
      onDrop={event => { if (event.target === event.currentTarget) drop(event, node.id, level === 0, 'frame'); }}>
      <div className={`fs-folder-frame ${hasActions ? 'has-actions' : ''}`} style={{ '--fs-action-inset': `${level * 22}px` } as CSSProperties}
        onDragOver={event => dragOver(event, node.id, level === 0, 'frame')}
        onDrop={event => drop(event, node.id, level === 0, 'frame')}
        onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(previous => previous?.hoverId === node.id ? null : previous); }}>
      <div className={`fs-tree-row ${hasActions ? 'has-actions' : ''} ${isSelected ? 'is-selected' : ''} ${target ? target.invalid ? 'is-drop-invalid' : target.placement === 'inside' ? 'is-drop-target' : `is-drop-${target.placement}` : ''}`} style={hasActions ? undefined : { paddingLeft: 12 + level * 22 }}
        onClick={event => { if (!(event.target instanceof Element) || !event.target.closest('button, input, select, textarea, .fs-inline-editor')) selectFolder(node.id); }}
        draggable={level > 0 && !inlineEdit} onDragStart={event => { if (!level) { event.preventDefault(); return; } dragId.current = node.id; dragGesture.current = true; setDragToolbarId(actionOwnerId); setDraggingId(node.id); dragDescendants.current = new Set(flatten({ version: 1, root: node }).map(row => row.node.id)); setSelectedId(node.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', node.id); }}
        onDragEnd={() => { setDraggingId(null); dragId.current = null; dragDescendants.current.clear(); setDropTarget(null); focusFolder(node.id); }} onDragOver={event => dragOver(event, node.id, level === 0)}
        onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(previous => previous?.hoverId === node.id ? null : previous); }} onDrop={event => drop(event, node.id, level === 0)}>
        <span className={`fs-drag-hint ${level === 0 || inlineEdit ? 'is-fixed' : ''}`} aria-hidden="true">{level > 0 && !inlineEdit && <Icon name="grip" size={15}/>}</span>
        {node.children.length && !hasActions ? <button type="button" className="fs-disclosure" aria-label={t(isCollapsed ? "Expand {name}" : "Collapse {name}", { name: node.name })} aria-expanded={!isCollapsed} onClick={() => { if (inlineRef.current && !finishInline(false)) return; setCollapsed(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }}><Icon name={isCollapsed ? 'chevron' : 'down'} size={13}/></button> : <span className="fs-disclosure-placeholder"/>}
        {editing ? <div className="fs-folder-select"><span className={`fs-folder-icon ${level === 0 ? 'root' : ''}`}><Icon name="folder" size={20}/></span>{renderInlineName()}</div> : <button type="button" className="fs-folder-select" data-folder-id={node.id} aria-pressed={isSelected} onClick={() => selectFolder(node.id)} title={node.name}><span className={`fs-folder-icon ${level === 0 ? 'root' : ''}`}><Icon name="folder" size={20}/></span><span className="fs-folder-name">{node.name}</span>{level === 0 && <span className="fs-root-label">{t("ROOT")}</span>}</button>}
      </div>
      </div>
      <button type="button" className={`fs-folder-comment ${node.comment ? '' : 'is-empty'}`} data-comment-for={node.id} dir="auto"
        aria-label={t('Edit comment for {name}', { name: node.name })} title={node.comment || t('Add comment')} disabled={!!draggingId || !!inlineEdit && inlineEdit.kind !== 'comment'}
        onClick={() => beginInline('comment', node.id)} onDragStart={event => event.preventDefault()}
        onDragOver={event => dragOver(event, node.id, level === 0)} onDrop={event => drop(event, node.id, level === 0)}>{node.comment || t('Add comment')}</button>
      <span className="fs-row-count">{node.children.length || ''}</span>
      {!isCollapsed && (node.children.length > 0 || addingChild) && <ul>{node.children.map(child => renderFolder(child, level + 1))}{addingChild && renderPlaceholder(level + 1)}</ul>}
      {target && !target.invalid && target.placement !== 'inside' && <span className={`fs-drop-line is-${target.placement}`} style={{ left: 12 + level * 22 }} aria-hidden="true"/>}
    </li>{inlineEdit?.kind === 'add' && inlineEdit.afterId === node.id && renderPlaceholder(level)}</Fragment>;
  }
  function renderFloatingActions() {
    if (!actionOwner || !actionBounds) return null;
    const { node, depth: level } = actionOwner;
    const isCollapsed = collapsed.has(node.id);
    return <div className={`fs-floating-actions ${draggingId ? 'is-dragging' : ''}`} style={actionBounds}>
      {node.children.length > 0 && <button type="button" className="fs-disclosure fs-floating-disclosure" aria-label={t(isCollapsed ? "Expand {name}" : "Collapse {name}", { name: node.name })} aria-expanded={!isCollapsed} disabled={!!draggingId} onClick={() => { if (inlineRef.current && !finishInline(false)) return; setCollapsed(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }}><Icon name={isCollapsed ? 'chevron' : 'down'} size={13}/></button>}
      <div className={`fs-context-actions ${draggingId ? 'is-dragging' : ''}`} role="group" aria-label={t('Folder actions for {name}', { name: node.name })} aria-hidden={draggingId ? true : undefined}>
        <button type="button" data-action="up" aria-label={t("Move up")} title={t("Move up within this level")} disabled={!!draggingId || !parent || siblingIndex <= 0} onClick={() => reorder(-1)}><Icon name="arrow-up" size={16}/></button>
        <button type="button" data-action="down" aria-label={t("Move down")} title={t("Move down within this level")} disabled={!!draggingId || !parent || siblingIndex >= parent.children.length - 1} onClick={() => reorder(1)}><Icon name="arrow-down" size={16}/></button>
        <button type="button" data-action="outdent" aria-label={t("Move to parent level")} title={translateError(levelActions.outdent) || t("Move to parent level, immediately after the parent folder")} disabled={!!draggingId || !!levelActions.outdent} onClick={() => changeLevel('outdent')}><Icon name="arrow-left" size={16}/></button>
        <button type="button" data-action="indent" aria-label={t(siblingIndex === 0 && (parent?.children.length ?? 0) > 1 ? "Move into next sibling" : "Move into previous sibling")} title={translateError(levelActions.indent) || t(siblingIndex === 0 ? "Move inside the next sibling folder" : "Move inside the previous sibling folder")} disabled={!!draggingId || !!levelActions.indent} onClick={() => changeLevel('indent')}><Icon name="arrow-right" size={16}/></button>
        <button type="button" data-action="add-sibling" aria-label={t("Add sibling folder")} title={t("Add a folder at this level, immediately after this folder")} disabled={!!draggingId || !parent || rows.length >= LIMITS.nodes} onClick={() => beginInline('add', parent!.id, node.id)}><Icon name="add-sibling" size={16}/></button>
        <button type="button" data-action="add-child" aria-label={t("Add child folder")} title={t("Add a folder inside this folder")} disabled={!!draggingId || level >= LIMITS.depth || rows.length >= LIMITS.nodes} onClick={() => beginInline('add', node.id)}><Icon name="add-child" size={16}/></button>
        <button type="button" data-action="rename" aria-label={t("Rename")} title={t("Rename this folder")} disabled={!!draggingId} onClick={() => beginInline('rename', node.id)}><Icon name="edit" size={16}/></button>
        <button type="button" className="fs-context-delete" data-action="delete" aria-label={t("Delete folder")} title={t("Delete this folder and its contents")} disabled={!!draggingId || !parent} onClick={() => deleteFolder(node.id)}><Icon name="trash" size={16}/></button>
      </div>
    </div>;
  }
  const dropRow = dropTarget ? rows.find(row => row.node.id === dropTarget.id) : undefined;
  const dropHint = !dropTarget ? draggingId && bottomTargets.length ? t("Move down to a Move out band") : t("Edges reorder · Center nests") : dropTarget.invalid ? t("Cannot drop into a descendant") : dropTarget.placement === 'inside' ? `Release to nest inside ${dropRow?.node.name}` : `Release to insert ${dropTarget.placement} ${dropRow?.node.name}`;
  const modalRow = modal && modal.kind !== 'template' ? rows.find(row => row.node.id === modal.id) : undefined;
  const modalTitle = !modal ? '' : modal.kind === 'template' ? t('Start with {name}?', { name: t(templates[modal.index].name) }) : 'Find a new home.';
  const destinationChildren = rows.find(row => row.node.id === destination)?.node.children.filter(child => child.id !== modalRow?.node.id) ?? [];
  const descendants = modalRow ? new Set(flatten({ version: 1, root: modalRow.node }).map(row => row.node.id)) : new Set<string>();

  return <div className="fs-app" lang={locale} dir={direction} data-theme={theme.resolvedTheme} data-theme-preference={theme.preference} ref={appRef} onKeyDown={handleHistoryKey}>
    <aside className="fs-sidebar">
      <a className="fs-brand" href="#workspace" aria-label={t("FolderSeed workspace")}><span className="fs-brand-mark"><Icon name="seed" size={26}/></span><span><span className="fs-brand-name">FolderSeed</span><span className="fs-brand-subtitle">{t("A little structure goes a long way.")}</span></span></a>
      <div className="fs-sidebar-navigation">
      <div className="fs-sidebar-section"><span className="fs-eyebrow">{t("YOUR WORKSPACE")}</span><a className="fs-nav-active" href="#workspace"><Icon name="tree"/>{t("Folder builder")}<span className="fs-nav-dot"/></a></div>
      <div className="fs-sidebar-section fs-templates"><span className="fs-eyebrow">{t("A PLACE TO START")}</span><p>{t("Skip the blank canvas.")}</p>{templates.map((template, index) => <button key={template.id} type="button" className="fs-template" disabled={blockedDraft} onClick={() => openModal({ kind: 'template', index })}><span className={`fs-template-icon color-${index}`}><Icon name={template.icon}/></span><span><strong>{t(template.name)}</strong><small>{t(template.description)}</small></span><Icon name="chevron" size={13}/></button>)}</div>
      </div>
      <div className="fs-privacy-card"><span className="fs-privacy-icon"><Icon name="shield" size={22}/></span><strong>{t("Your folders. Your device.")}</strong><p>{t("Your folder drafts and exports stay in your browser. No accounts or app analytics.")}</p><span className="fs-local-badge"><span/>{t("LOCAL-FIRST BY DESIGN")}</span></div>
      <div className="fs-sidebar-footer">{t("Made for fresh starts.")}<AppMenu onSettings={openSettings}/></div>
      <AppMenu mobile onSettings={openSettings}/>
    </aside>
    <main className="fs-main" id="workspace">
      <header className="fs-topbar"><span className="fs-breadcrumb">{t("Workspace")} <Icon name="chevron" size={12}/> {t("Folder builder")}</span><span className="fs-save-state"><span className={blockedDraft || saveState.startsWith('Draft not') ? 'warning' : ''}/>{translateError(statusLabel)}</span></header>
      <section className="fs-heading"><div><span className="fs-eyebrow">{t("FROM A SMALL SEED, A CLEARER SPACE")}</span><h1>{t("A little structure.")}<br className="fs-mobile-break"/> {t("A fresh start.")}</h1><p>{t("Shape your folders, make them yours, and take them anywhere.")}</p></div><button type="button" className="fs-button fs-import" disabled={blockedDraft} onClick={() => fileInput.current?.click()}><Icon name="upload"/>{t("Import structure")}</button><input type="file" accept=".json,.txt,.md,.markdown,.ascii,.tree,text/plain,application/json" ref={fileInput} hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }}/></section>
      <div className="fs-mobile-templates"><span><Icon name="spark" size={15}/>{t("Need a starting point?")}</span><select aria-label={t("Choose a template")} value="" disabled={blockedDraft} onChange={event => { if (event.target.value !== '') openModal({ kind: 'template', index: Number(event.target.value) }); }}><option value="" disabled>{t("Choose a template")}</option>{templates.map((template, index) => <option key={template.id} value={index}>{t(template.name)}</option>)}</select></div>
      <div className="fs-workspace-grid">
        <section className="fs-panel fs-editor" aria-label={t("Folder editor")} ref={editorRef} tabIndex={-1} onPointerDownCapture={() => { dragGesture.current = false; }} onClick={handleEditorBackgroundClick}>
          <div className="fs-panel-heading"><div><span className="fs-step">01</span><h2>{t("Make it yours")}</h2></div><div className="fs-history"><button type="button" aria-label={t("Undo")} title={t("Undo (Ctrl/Cmd+Z)")} aria-keyshortcuts="Control+Z Meta+Z" disabled={(!history.past.length && !textDirty) || blockedDraft} onClick={() => historyStep('undo')}><Icon name="undo" size={17}/></button><button type="button" aria-label={t("Redo")} title={t("Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)")} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" disabled={!history.future.length || textDirty || blockedDraft} onClick={() => historyStep('redo')}><Icon name="redo" size={17}/></button></div></div>
          <div className="fs-editor-toolbar">
            <div className="fs-editor-tabs"><button type="button" aria-pressed={mode === 'visual'} aria-controls="visual-editor" onClick={() => { if (flushText()) setMode('visual'); }}><Icon name="tree" size={16}/>{t("Visual editor")}</button></div>
            <FormatSwitch value={textFormat === 'auto' ? 'plain' : textFormat} active={mode === 'text'} disabled={composing} onActivate={() => { if (flushText()) setMode('text'); }} onSelect={changeTextFormat}/>
          </div>
          {mode === 'visual' ? <div id="visual-editor" role="region" aria-label={t("Visual editor")} className="fs-visual-area" ref={visualAreaRef}>
            <div className="fs-tree-help"><span>{t(rows.length === 1 ? "{count} folder" : "{count} folders", { count: rows.length })}</span><span aria-live="polite" title={translateError(dropHint)}>{translateError(dropHint)}</span></div>
            <ul className="fs-tree" aria-label={t("Folder list")} ref={treeRef}
              onDragOver={event => { if (isTrailingSpace(event)) dragOver(event, lastVisibleFolder.id, lastVisibleFolder.id === doc.root.id, 'tail'); }}
              onDrop={event => { if (isTrailingSpace(event)) drop(event, lastVisibleFolder.id, lastVisibleFolder.id === doc.root.id, 'tail'); }}
              onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }}>
              {renderFolder(doc.root, 0)}<li className={`fs-tree-tail ${bottomTargets.length ? 'has-drop-bands' : ''}`} aria-hidden="true"/>
              {bottomTargets.length > 0 && <li className="fs-bottom-drop-zones" aria-label={t("Move out destinations")}>
                {bottomTargets.map(target => <div key={target.node.id} className={`fs-bottom-drop-band ${dropTarget?.id === target.node.id && dropTarget.placement === 'after' ? 'is-active' : ''}`}
                  data-drop-target-id={target.node.id} aria-label={t('Move out after {name}', { name: target.node.name })} title={t('Move out after {name}', { name: target.path })}
                  onDragOver={event => dragOver(event, target.node.id, false, 'band')}
                  onDrop={event => drop(event, target.node.id, false, 'band')}
                  onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(previous => previous?.hoverId === target.node.id ? null : previous); }}>
                  <span className="fs-bottom-drop-guide" style={{ marginLeft: `min(${12 + Math.min(target.depth, 6) * 22}px, 30%)` }}><Icon name="up" size={13}/><strong>{t("Move out")}</strong><span>{t('After {name}', { name: target.node.name })}</span></span>
                </div>)}
              </li>}
            </ul>
            {renderFloatingActions()}
            {inlineEdit?.kind === 'comment' && commentBounds && <div className={`fs-comment-editor ${commentBounds.above ? 'is-above' : ''}`} style={{ top: commentBounds.top, left: commentBounds.left, width: commentBounds.width }} title={t('Comments stay separate from folder names.')}>{renderInlineName()}</div>}
            {rows.length === 1 && <div className="fs-empty-hint"><Icon name="spark" size={23}/><p>{t("Every good structure starts somewhere.")}<br/>{t("Select the root, then add a child folder.")}</p></div>}
            <div className={`fs-selection-summary ${selected ? '' : 'is-empty'}`}>{selected && <><div className="fs-selected-path" title={selected.path}><Icon name="folder" size={14}/><span>{selected.path}</span></div><button type="button" className="fs-advanced-move" disabled={!parent} onClick={() => openModal({ kind: 'move', id: selected.node.id })}><Icon name="move" size={14}/>{t("Move")}</button></>}</div>
          </div> : <div id="text-editor" role="region" aria-label={t("Text editor")} className="fs-text-area">
            <textarea aria-label={t("Folder structure text")} spellCheck={false} value={textDraft}
              onChange={event => changeText(event.target.value)}
              onCompositionStart={() => { composingRef.current = true; setComposing(true); contentRevision.current++; }}
              onCompositionEnd={event => { composingRef.current = false; setComposing(false); changeText(event.currentTarget.value); }}
              onKeyDown={event => {
                if (event.key === 'Tab' && !event.nativeEvent.isComposing && !composingRef.current) {
                  event.preventDefault();
                  const input = event.currentTarget;
                  const position = input.selectionStart;
                  const insertion = ' '.repeat(OUTPUT_INDENT);
                  changeText(textDraft.slice(0, position) + insertion + textDraft.slice(input.selectionEnd));
                  requestAnimationFrame(() => { input.selectionStart = input.selectionEnd = position + insertion.length; });
                }
              }}/>
            <p className="fs-text-guide">{t("Changes apply automatically after a short pause. Plain text, Markdown lists, ASCII trees, and Unicode trees are supported. Choose Plain text to keep leading punctuation literal.")} {t("Use // after a folder name for a single-line comment.")}</p>
            {parsed.error ? <div className="fs-inline-error" role="alert">{translateError(parsed.error)}<span className="fs-error-detail">{t("Your draft is kept. The preview still shows the last valid structure.")}</span></div> : <div className="fs-text-valid"><Icon name={composing || textDirty ? 'edit' : 'check'} size={14}/>{composing ? t("Composing… your last valid structure is unchanged") : textDirty ? t("Saving changes…") : t("Automatically applied · no extra click needed")}</div>}
            {textDirty && <div className="fs-text-actions"><button type="button" className="fs-button" disabled={composing} onClick={revertText}>{t("Revert text")}</button></div>}
          </div>}

        </section>
        <section className="fs-panel fs-preview" aria-label={t("Live preview")}><div className="fs-panel-heading"><div><span className="fs-step">02</span><h2>{t("See it take shape")}</h2></div><span className={`fs-live-badge ${blockedDraft && mode === 'text' ? 'is-paused' : ''}`}><span/>{blockedDraft && mode === 'text' ? t('LAST VALID') : t('LIVE PREVIEW')}</span></div><div className="fs-preview-toolbar"><div className="fs-segmented"><button type="button" aria-pressed={previewMode === 'folders'} onClick={() => setPreviewMode('folders')}>{t("Folders")}</button><button type="button" aria-pressed={previewMode === 'text'} onClick={() => setPreviewMode('text')}>{t("Text tree")}</button></div><button type="button" className="fs-copy" disabled={blockedDraft} onClick={() => void copyPreview()}><Icon name="copy" size={15}/>{t("Copy tree")}</button></div><div className="fs-preview-canvas">{previewMode === 'text' ? <pre className="fs-text-preview">{formatTree(previewDoc)}</pre> : <div className="fs-preview-tree">{previewRows.map(({ node, depth }) => <div className={`fs-preview-row ${depth === 0 ? 'fs-preview-root' : ''}`} key={node.id} style={{ marginLeft: depth * 24 }}><span className="fs-preview-branch"/><span className="fs-preview-folder"><Icon name="folder" size={depth === 0 ? 23 : 20}/></span><span>{node.name}</span>{depth === 0 && <span className="fs-preview-root-badge">{t("YOUR ROOT FOLDER")}</span>}{node.comment && <span className="fs-preview-comment" title={node.comment} dir="auto">{node.comment}</span>}</div>)}</div>}</div><div className="fs-preview-stats"><span>{t(previewRows.length === 1 ? "{count} folder" : "{count} folders", { count: previewRows.length })}</span><span>{t(depth === 1 ? "{count} level" : "{count} levels", { count: depth })}</span><span><Icon name="check" size={14}/>{t("No files, just possibilities")}</span></div></section>
      </div>
      <section className="fs-panel fs-export" aria-label={t("Export structure")}><div className="fs-export-heading"><div><span className="fs-step">03</span><h2>{t("Take it with you")}</h2></div><p>{t("A real folder structure, or a picture of the plan. Your choice.")}</p></div><div className="fs-export-options" role="radiogroup" aria-label={t("Export format")}>{formats.map(item => <button key={item.id} type="button" role="radio" aria-checked={activeExportCard === item.id} onClick={() => setFormat(item.id)} className={activeExportCard === item.id ? 'is-active' : ''}><span className="fs-format-icon"><Icon name={item.icon} size={20}/></span><strong>{t(item.title)}</strong><small>{t(item.description)}</small><span className="fs-radio-dot"/></button>)}</div>
        {activeExportCard === 'txt' && <div className="fs-export-subtype"><label htmlFor="text-export-style">{t("Text export style")}</label><select id="text-export-style" value={format} onChange={event => setFormat(event.target.value as ExportFormat)}><option value="txt">{t("Indented text")}</option><option value="ascii">{t("ASCII tree")}</option><option value="unicode">{t("Unicode tree")}</option></select></div>}
        {activeExportCard === 'md' && <div className="fs-export-subtype"><label htmlFor="markdown-export-style">{t("Markdown export style")}</label><select id="markdown-export-style" value={format} onChange={event => setFormat(event.target.value as ExportFormat)}><option value="md">{t("Nested list")}</option><option value="md-tree">{t("Fenced tree")}</option></select></div>}
        <div className="fs-export-bottom"><p><Icon name="info" size={17}/>{blockedDraft ? t("Fix the text error or finish composing before exporting. Your last valid structure is safe.") : format === 'zip' ? <span><strong>{t("Real folders, ready to use.")}</strong> {t("Extract your ZIP to create this structure. No files or scripts included.")}</span> : format === 'json' ? <span><strong>{t("A reusable project backup.")}</strong> {t("Import this JSON into FolderSeed to keep editing later.")}</span> : <span><strong>{t("A description, not real folders.")}</strong> {t("Choose Folder ZIP if you want actual folders on your device.")}</span>}</p><button type="button" className="fs-button fs-primary fs-download" disabled={blockedDraft || exporting} onClick={() => void download()}><Icon name="download"/>{exporting ? t("Preparing…") : t('Download {format}', { format: format.toUpperCase() })}</button></div></section>
      {notice && <div className={`fs-notice ${noticeError ? 'is-error' : ''}`} role={noticeError ? 'alert' : 'status'}><Icon name={noticeError ? 'info' : 'check'} size={17}/><span>{translateError(notice)}</span><button type="button" aria-label={t("Dismiss message")} onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
      <footer className="fs-footer"><span>{t("Small beginnings. Well-organized possibilities.")}</span><span><Icon name="shield" size={13}/>{t("Your structure never leaves this browser.")}</span></footer>
    </main>
    {deleteUndo && <div className="fs-notice fs-delete-notice" role="status"><Icon name="check" size={17}/><span>{t('Folder removed. You can undo this.')}</span><button type="button" className="fs-notice-undo" onClick={undoDeletion}>{t('Undo')}</button><button type="button" className="fs-notice-dismiss" aria-label={t('Dismiss message')} onClick={clearDeleteUndo}><Icon name="close" size={16}/></button></div>}
    {settingsOpen && <SettingsDialog preference={theme.preference} storageWarning={theme.storageWarning} onPreferenceChange={theme.setPreference} onClose={closeSettings}/>}
    {modal && <dialog ref={dialog} className="fs-dialog" aria-labelledby="folderseed-dialog-title" onCancel={closeModal} onClick={event => { if (event.target === event.currentTarget) closeModal(); }}><form onSubmit={submitModal}><div className="fs-dialog-top"><span className="fs-dialog-icon"><Icon name={modal.kind === 'move' ? 'move' : 'folder'} size={25}/></span><button type="button" aria-label={t("Close dialog")} className="fs-icon-button" onClick={closeModal}><Icon name="close"/></button></div><h2 id="folderseed-dialog-title">{translateError(modalTitle)}</h2>{modal.kind === 'move' ? <><p>{t('Move {name} and everything inside it.', { name: modalRow?.node.name ?? '' })}</p><label htmlFor="destination">{t("New parent folder")}</label><select id="destination" value={destination} onChange={event => { setDestination(event.target.value); setDestinationBefore('end'); }}>{rows.filter(row => !descendants.has(row.node.id)).map(row => <option key={row.node.id} value={row.node.id}>{row.path}</option>)}</select><label htmlFor="destination-position">{t("Position")}</label><select id="destination-position" value={destinationBefore} onChange={event => setDestinationBefore(event.target.value)}><option value="end">{t("At the end")}</option>{destinationChildren.map(child => <option key={child.id} value={child.id}>{t('Before {name}', { name: child.name })}</option>)}</select></> : <p>{t("This will replace the current plan with a fresh template. You can use Undo to bring your previous structure back.")}</p>}{modalError && <div className="fs-inline-error" role="alert">{translateError(modalError)}</div>}<div className="fs-dialog-actions"><button type="button" className="fs-button" onClick={closeModal}>{t("Cancel")}</button><button type="submit" className="fs-button fs-primary">{modal.kind === 'move' ? t("Move folder") : t("Use template")}</button></div></form></dialog>}
  </div>;
}
