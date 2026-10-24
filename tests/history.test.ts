import { describe, expect, it } from 'vitest';
import { createDocument } from '../src/core';
import { historyReducer, historyShortcut, type HistoryState } from '../src/ui/history';
describe('immutable history', () => {
  const start = (): HistoryState => ({ past: [], present: createDocument('Start'), future: [] });
  it('initializes fresh translated data without creating an undo step', () => {
    const first = start();
    const initialized = historyReducer(first, { type: 'initialize', document: createDocument('Localized start') });
    expect(initialized.present.root.name).toBe('Localized start');
    expect(initialized.past).toEqual([]);
    expect(initialized.future).toEqual([]);
    expect(historyReducer(initialized, { type: 'undo' })).toBe(initialized);
  });
  it('never initializes over an existing edit or its redo history', () => {
    const first = start();
    const edited = historyReducer(first, { type: 'commit', document: createDocument('User work') });
    const action = { type: 'initialize' as const, document: createDocument('Late locale') };
    expect(historyReducer(edited, action)).toBe(edited);
    const undone = historyReducer(edited, { type: 'undo' });
    expect(historyReducer(undone, action)).toBe(undone);
  });
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


describe('document history shortcuts', () => {
  const keyEvent = { key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false };
  it.each([
    [{ ctrlKey: true }, 'undo'],
    [{ metaKey: true }, 'undo'],
    [{ ctrlKey: true, shiftKey: true, key: 'Z' }, 'redo'],
    [{ metaKey: true, shiftKey: true }, 'redo'],
    [{ ctrlKey: true, key: 'y' }, 'redo'],
    [{}, null],
    [{ ctrlKey: true, altKey: true }, null],
    [{ metaKey: true, isComposing: true }, null],
    [{ metaKey: true, key: 'y' }, null],
    [{ ctrlKey: true, shiftKey: true, key: 'y' }, null],
    [{ ctrlKey: true, key: 'a' }, null],
  ] as const)('recognizes only supported unambiguous chords: %j', (overrides, expected) => {
    expect(historyShortcut({ ...keyEvent, ...overrides })).toBe(expected);
  });
});
