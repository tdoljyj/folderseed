import { describe, expect, it } from 'vitest';
import { BACKGROUND_TAP_DISTANCE, BACKGROUND_TAP_DURATION, BackgroundTapTracker, type BackgroundTapPointer } from '../src/ui/backgroundTap';

const point = (changes: Partial<BackgroundTapPointer> = {}): BackgroundTapPointer => ({ pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 30, clientY: 40, timeStamp: 100, ...changes });
const scroll = [0, 200, 0, 40];

function started() {
  const tracker = new BackgroundTapTracker();
  tracker.start(point(), true, scroll);
  return tracker;
}

describe('touch background tap recognition', () => {
  it('accepts a short stationary primary touch only once', () => {
    const tracker = started();
    expect(tracker.end(point({ timeStamp: 150 }), true, scroll)).toBe(true);
    expect(tracker.end(point({ timeStamp: 151 }), true, scroll)).toBe(false);
  });
  it('copies inherited native pointer properties explicitly', () => {
    const tracker = new BackgroundTapTracker();
    tracker.start(Object.create(point()) as BackgroundTapPointer, true, scroll);
    expect(tracker.end(point({ timeStamp: 150 }), true, scroll)).toBe(true);
  });
  it.each(['mouse', 'pen', ''])('leaves %s pointers to the ordinary click path', pointerType => {
    const tracker = new BackgroundTapTracker();
    tracker.start(point({ pointerType }), true, scroll);
    expect(tracker.end(point({ pointerType, timeStamp: 150 }), true, scroll)).toBe(false);
  });
  it.each([{ isPrimary: false }, { button: 2 }, { clientX: NaN }, { pointerId: Infinity }, { timeStamp: NaN }])('rejects an invalid start %j', changes => {
    const tracker = new BackgroundTapTracker();
    tracker.start(point(changes), true, scroll);
    expect(tracker.end(point({ timeStamp: 150 }), true, scroll)).toBe(false);
  });
  it('requires genuine background at both ends', () => {
    const tracker = new BackgroundTapTracker();
    tracker.start(point(), false, scroll);
    expect(tracker.end(point({ timeStamp: 150 }), true, scroll)).toBe(false);
    tracker.start(point(), true, scroll);
    expect(tracker.end(point({ timeStamp: 150 }), false, scroll)).toBe(false);
  });
  it('accepts small jitter within the inclusive distance and duration bounds', () => {
    expect(started().end(point({ clientX: 30 + BACKGROUND_TAP_DISTANCE, timeStamp: 100 + BACKGROUND_TAP_DURATION }), true, scroll)).toBe(true);
  });
  it('uses radial distance instead of allowing a large diagonal move', () => {
    expect(started().end(point({ clientX: 36, clientY: 46, timeStamp: 150 }), true, scroll)).toBe(false);
  });
  it('rejects a long press or a timestamp that moved backwards', () => {
    expect(started().end(point({ timeStamp: 101 + BACKGROUND_TAP_DURATION }), true, scroll)).toBe(false);
    expect(started().end(point({ timeStamp: 99 }), true, scroll)).toBe(false);
  });
  it('remembers movement even if the finger returns to the start', () => {
    const tracker = started();
    tracker.move(point({ clientX: 30 + BACKGROUND_TAP_DISTANCE + 1, timeStamp: 110 }));
    tracker.move(point({ timeStamp: 120 }));
    expect(tracker.end(point({ timeStamp: 150 }), true, scroll)).toBe(false);
  });
  it('rejects a moved release even without a delivered pointermove', () => {
    expect(started().end(point({ clientY: 60, timeStamp: 150 }), true, scroll)).toBe(false);
  });
  it('does not let a different pointer release the candidate', () => {
    const tracker = started();
    expect(tracker.end(point({ pointerId: 9, timeStamp: 150 }), true, scroll)).toBe(false);
    expect(tracker.end(point({ timeStamp: 151 }), true, scroll)).toBe(false);
  });
  it('cancels when a second touch starts', () => {
    const tracker = started();
    tracker.start(point({ pointerId: 8, isPrimary: false, timeStamp: 110 }), true, scroll);
    expect(tracker.end(point({ timeStamp: 150 }), true, scroll)).toBe(false);
  });
  it('cancels on pointercancel, captured scroll, or native drag through the same cancellation hook', () => {
    const tracker = started();
    tracker.cancel();
    expect(tracker.end(point({ timeStamp: 150 }), true, scroll)).toBe(false);
  });
  it.each([0, 1, 2, 3])('rejects a changed scroll snapshot component %i', index => {
    const moved = [...scroll]; moved[index] += 0.25;
    expect(started().end(point({ timeStamp: 150 }), true, moved)).toBe(false);
  });
  it('copies the initial scroll snapshot instead of retaining mutable input', () => {
    const tracker = new BackgroundTapTracker();
    const positions = [...scroll];
    tracker.start(point(), true, positions);
    positions[1] += 20;
    expect(tracker.end(point({ timeStamp: 150 }), true, positions)).toBe(false);
  });
  it('rejects missing or non-finite scroll coordinates', () => {
    expect(started().end(point({ timeStamp: 150 }), true, scroll.slice(1))).toBe(false);
    expect(started().end(point({ timeStamp: 150 }), true, [0, NaN, 0, 40])).toBe(false);
    const tracker = new BackgroundTapTracker();
    tracker.start(point(), true, [0, NaN]);
    expect(tracker.end(point({ timeStamp: 150 }), true, [0, 0])).toBe(false);
  });
  it('rejects an invalid or changed pointer at release', () => {
    for (const changes of [{ clientY: Infinity }, { isPrimary: false }, { button: 1 }, { pointerType: 'mouse' }]) {
      expect(started().end(point({ timeStamp: 150, ...changes }), true, scroll)).toBe(false);
    }
  });
  it('suppresses touch compatibility clicks after accepted or canceled gestures', () => {
    const accepted = started();
    accepted.end(point({ timeStamp: 150 }), true, scroll);
    expect(accepted.ignoreCompatibilityClick({ detail: 1 })).toBe(true);
    const canceled = started(); canceled.cancel();
    expect(canceled.ignoreCompatibilityClick({ detail: 1 })).toBe(true);
  });
  it('retains keyboard clicks and resets suppression on a real mouse pointerdown', () => {
    const tracker = started();
    expect(tracker.ignoreCompatibilityClick({ detail: 0 })).toBe(false);
    expect(tracker.ignoreCompatibilityClick({ detail: 1, pointerType: 'mouse' })).toBe(false);
    tracker.start(point({ pointerType: 'mouse' }), true, scroll);
    expect(tracker.ignoreCompatibilityClick({ detail: 1 })).toBe(false);
  });
  it('uses an explicit touch click type even when no pointer candidate was accepted', () => {
    expect(new BackgroundTapTracker().ignoreCompatibilityClick({ detail: 1, pointerType: 'touch' })).toBe(true);
  });
});
