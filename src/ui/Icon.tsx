import type { CSSProperties } from 'react';
const paths: Record<string, React.ReactNode> = {
  folder: <path d="M3 7V5h7l2 2h9v13H3Z" />,
  seed: <><path d="M3 10V7h7l3 4h8v10H3Z"/><path d="M12 11C10 4 15 2 20 3c0 5-3 8-8 8Z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  down: <path d="m5 9 7 7 7-7"/>,
  up: <path d="m5 15 7-7 7 7"/>,
  edit: <><path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14Z"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  move: <path d="M12 3v18M3 12h18m-6-6-3-3-3 3m6 12-3 3-3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>,
  undo: <><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/></>,
  redo: <><path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  upload: <><path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 11 3 3 5-5"/></>,
  code: <path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16"/>,
  tree: <><path d="M6 3v14h12M6 9h12"/><rect x="15" y="6" width="6" height="6" rx="1"/><rect x="15" y="14" width="6" height="6" rx="1"/></>,
  spark: <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>,
  home: <><path d="m3 10 9-7 9 7v11H3Z"/><path d="M9 21v-8h6v8"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-5 4 3 4-5 4 4"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  grip: <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/>,
};
export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name] ?? paths.folder}</svg>;
}
