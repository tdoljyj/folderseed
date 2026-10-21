import { describe, expect, it } from 'vitest';
import { createDocument } from '../src/core';
import { historyReducer, type HistoryState } from '../src/ui/history';
describe('immutable history', () => {
  const start = (): HistoryState => ({ past: [], present: createDocument('Start'), future: [] });
  it('undoes and redoes without changing earlier snapshots', () => {
    const first = start();
    const second = historyReducer(first, { type: 'commit', document: createDocument('Next') });
    const undone = historyReducer(second, { type: 'undo' });
    expect(undone.present).toEqual(first.present);
    expect(historyReducer(undone, { type: 'redo' }).present.root.name).toBe('Next');
    expect(first.past).toHaveLength(0);
  });
  it('drops redo after a new edit and handles empty stacks', () => {
    const state = start();
    expect(historyReducer(state, { type: 'undo' })).toBe(state);
    expect(historyReducer(state, { type: 'redo' })).toBe(state);
    const edited = historyReducer(state, { type: 'commit', document: createDocument('Second') });
    const undone = historyReducer(edited, { type: 'undo' });
    expect(historyReducer(undone, { type: 'commit', document: createDocument('Third') }).future).toEqual([]);
  });
  it('retains at most 50 undo steps', () => {
    let state = start();
    for (let i = 0; i < 60; i++) state = historyReducer(state, { type: 'commit', document: createDocument(`Step ${i}`) });
    expect(state.past).toHaveLength(50);
  });
});
