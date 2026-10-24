import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { flatten, getTextLayout, type DirectoryDocument } from '../core';

/** One measured text grid, shared by every generated presentation. */
export function useSharedCommentLayout(document: DirectoryDocument, root: RefObject<HTMLDivElement | null>) {
  const [metrics, setMetrics] = useState({ width: 728, cell: 7.2, name: 53, indent: 22, narrow: false });
  useLayoutEffect(() => {
    const app = root.current;
    const panel = app?.querySelector<HTMLElement>('.fs-editor');
    const ruler = app?.querySelector<HTMLElement>('.fs-layout-ruler');
    if (!app || !panel || !ruler) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const style = getComputedStyle(app);
      const next = {
        width: panel.clientWidth,
        cell: ruler.getBoundingClientRect().width / 100 || 7.2,
        name: 25 + (parseFloat(style.getPropertyValue('--fs-tree-glyph-track')) || 28),
        indent: parseFloat(style.getPropertyValue('--fs-tree-indent')) || 22,
        narrow: typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 800px)').matches : window.innerWidth <= 800,
      };
      setMetrics(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(panel); observer?.observe(ruler);
    window.addEventListener('resize', measure);
    documentOwner(app).fonts?.addEventListener('loadingdone', measure);
    void documentOwner(app).fonts?.ready.then(measure);
    return () => { active = false; observer?.disconnect(); window.removeEventListener('resize', measure); documentOwner(app).fonts?.removeEventListener('loadingdone', measure); };
  }, [root]);
  return useMemo(() => {
    const rows = flatten(document);
    const depth = Math.max(...rows.map(row => row.depth));
    const hasComments = rows.some(({ node }) => !!node.comment);
    const target = Math.max(Math.min((metrics.width - 26) * .55, 288) + 5, 197 + Math.max(0, depth - 1) * metrics.indent);
    const nameX = metrics.name - (document.root.children.length ? 0 : 24);
    const minimumCommentColumn = Math.max(0, Math.ceil((target - nameX) / metrics.cell));
    const layout = getTextLayout(document, 4, minimumCommentColumn);
    const commentX = nameX + layout.commentColumn * metrics.cell;
    return { ...layout, minimumCommentColumn, commentX, visualCommentX: metrics.narrow || !hasComments ? target : commentX, nameX, cell: metrics.cell, narrow: metrics.narrow };
  }, [document, metrics]);
}
function documentOwner(element: Element) { return element.ownerDocument; }
