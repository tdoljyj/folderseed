import type { DirectoryDocument } from '../core';
export interface HistoryState { past: DirectoryDocument[]; present: DirectoryDocument; future: DirectoryDocument[] }
export type HistoryAction = { type: 'commit'; document: DirectoryDocument } | { type: 'undo' } | { type: 'redo' };
export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === 'commit') return { past: [...state.past, state.present].slice(-50), present: action.document, future: [] };
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.present].slice(-50), present: state.future[0], future: state.future.slice(1) };
  return state;
}
