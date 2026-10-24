import { describe, expect, it } from 'vitest';
import { createMobileHeaderState, nextMobileHeaderState } from '../src/ui/mobileHeader';

describe('mobile page header hysteresis', () => {
  it('starts visible even when mounting at a restored scroll position', () => {
    expect(createMobileHeaderState(300)).toEqual({ y: 300, direction: null, distance: 0, hidden: false });
  });
  it('hides only after 24 pixels of downward page movement', () => {
    let state = createMobileHeaderState(100);
    for (const y of [108, 115, 123]) {
      state = nextMobileHeaderState(state, y);
      expect(state.hidden).toBe(false);
    }
    expect(nextMobileHeaderState(state, 124).hidden).toBe(true);
  });
  it('reveals only after 12 pixels upward while away from the top', () => {
    let state = nextMobileHeaderState(createMobileHeaderState(100), 200);
    for (const y of [196, 192, 189]) {
      state = nextMobileHeaderState(state, y);
      expect(state.hidden).toBe(true);
    }
    expect(nextMobileHeaderState(state, 188).hidden).toBe(false);
  });
  it('does not combine distance across opposite directions', () => {
    let state = createMobileHeaderState(100);
    for (const y of [120, 116, 136, 132, 152]) {
      state = nextMobileHeaderState(state, y);
      expect(state.hidden).toBe(false);
    }
  });
  it('remains visible at the top despite small scroll jitter', () => {
    let state = createMobileHeaderState();
    for (const y of [4, 0, 10, 7, 16, 12]) {
      state = nextMobileHeaderState(state, y);
      expect(state.hidden).toBe(false);
      expect(state.distance).toBe(0);
    }
  });
  it('reveals at the top even after a large downward move', () => {
    const hidden = nextMobileHeaderState(createMobileHeaderState(100), 600);
    expect(hidden.hidden).toBe(true);
    expect(nextMobileHeaderState(hidden, 16).hidden).toBe(false);
  });
  it('pins navigation for keyboard focus, an expanded menu, or Settings and resets momentum', () => {
    const hidden = nextMobileHeaderState(createMobileHeaderState(100), 200);
    const pinned = nextMobileHeaderState(hidden, 500, true);
    expect(pinned).toEqual(createMobileHeaderState(500));
    expect(nextMobileHeaderState(pinned, 520).hidden).toBe(false);
    expect(nextMobileHeaderState(pinned, 524).hidden).toBe(true);
  });
  it('ignores unchanged positions and bounds accumulated distance', () => {
    const hidden = nextMobileHeaderState(createMobileHeaderState(100), 5000);
    expect(hidden.distance).toBe(24);
    expect(nextMobileHeaderState(hidden, 5000)).toBe(hidden);
    expect(nextMobileHeaderState(hidden, 2000).distance).toBe(12);
  });
  it('treats overscroll above the page as the top and rejects nonfinite coordinates', () => {
    expect(createMobileHeaderState(-20).y).toBe(0);
    expect(createMobileHeaderState(Infinity).y).toBe(0);
    const state = createMobileHeaderState(100);
    expect(nextMobileHeaderState(state, NaN)).toBe(state);
    expect(nextMobileHeaderState(state, -30)).toEqual(createMobileHeaderState());
  });
});
