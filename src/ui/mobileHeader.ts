import { useEffect, useRef, useState, type RefObject } from 'react';

export interface MobileHeaderState {
  y: number;
  direction: 'up' | 'down' | null;
  distance: number;
  hidden: boolean;
}

export function createMobileHeaderState(y = 0): MobileHeaderState {
  return { y: Number.isFinite(y) ? Math.max(0, y) : 0, direction: null, distance: 0, hidden: false };
}

/** Directional hysteresis prevents small page-scroll corrections from flashing the header. */
export function nextMobileHeaderState(state: MobileHeaderState, nextY: number, pinned = false): MobileHeaderState {
  const y = Number.isFinite(nextY) ? Math.max(0, nextY) : state.y;
  if (pinned || y <= 16) return createMobileHeaderState(y);
  const delta = y - state.y;
  if (delta === 0) return state;
  const direction = delta > 0 ? 'down' : 'up';
  const threshold = direction === 'down' ? 24 : 12;
  const distance = Math.min(threshold, (state.direction === direction ? state.distance : 0) + Math.abs(delta));
  return { y, direction, distance, hidden: distance >= threshold ? direction === 'down' : state.hidden };
}

/** Listen to the page only: scrolling a tree, textarea, or modal never hides navigation. */
export function useMobileHeader(headerRef: RefObject<HTMLElement | null>, settingsOpen: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  const state = useRef(createMobileHeaderState());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const header = headerRef.current;
    const reveal = () => { state.current = createMobileHeaderState(window.scrollY); setHidden(false); };
    const scroll = (event: Event) => {
      if (event.target !== window && event.target !== document) return;
      const active = document.activeElement;
      const keyboardFocus = active instanceof Element && !!header?.contains(active) && active.matches(':focus-visible');
      // Pointer menu dismissal restores focus too; only visible keyboard focus pins later scrolling.
      const pinned = window.innerWidth > 800 || settingsOpen || keyboardFocus
        || !!header?.querySelector('[aria-expanded="true"]');
      state.current = nextMobileHeaderState(state.current, window.scrollY, pinned);
      setHidden(state.current.hidden);
    };
    reveal();
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', reveal, { passive: true });
    header?.addEventListener('focusin', reveal);
    return () => {
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', reveal);
      header?.removeEventListener('focusin', reveal);
    };
  }, [headerRef, settingsOpen]);
  return hidden;
}
