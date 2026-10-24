import type { DirectoryDocument } from '../core';
export interface HistoryState { past: DirectoryDocument[]; present: DirectoryDocument; future: DirectoryDocument[] }
export type HistoryAction = { type: 'initialize' | 'commit'; document: DirectoryDocument } | { type: 'undo' } | { type: 'redo' };
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === 'initialize') return state.past.length || state.future.length ? state : { ...state, present: action.document };
  if (action.type === 'commit') return { past: [...state.past, state.present].slice(-50), present: action.document, future: [] };
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.present].slice(-50), present: state.future[0], future: state.future.slice(1) };
  return state;
}


interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

/** Recognize document-history chords; editable targets and focus scope are checked by the UI. */
export function historyShortcut(event: ShortcutEvent): 'undo' | 'redo' | null {
  if (event.isComposing || event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) return 'redo';
  return null;
}
