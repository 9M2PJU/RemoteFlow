import { CSSProperties, RefObject, useLayoutEffect, useState } from 'react';

const MARGIN = 6;

/**
 * Position for a context menu opened at the mouse pointer (`position: fixed`).
 * The menu is measured before it is shown: when it would not fit below the pointer it opens
 * above it, when it would not fit on the right it opens to the left – and it is always kept
 * inside the window (e.g. right-click on a connection at the very bottom of the tree).
 */
export const useMenuPosition = (
  ref: RefObject<HTMLElement | null>,
  anchor: { x: number; y: number } | null
): CSSProperties => {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const x = anchor?.x;
  const y = anchor?.y;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || x === undefined || y === undefined) {
      setPos(null);
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    if (left + w > vw - MARGIN) left = x - w >= MARGIN ? x - w : vw - w - MARGIN;
    let top = y;
    if (top + h > vh - MARGIN) top = y - h >= MARGIN ? y - h : vh - h - MARGIN;

    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) });
  }, [ref, x, y]);

  if (x === undefined || y === undefined) return { visibility: 'hidden' };
  return {
    left: pos?.left ?? x,
    top: pos?.top ?? y,
    // Hidden for the first (measuring) render, so the menu never flashes in the wrong place
    visibility: pos ? 'visible' : 'hidden',
    maxHeight: `calc(100vh - ${2 * MARGIN}px)`,
    overflowY: 'auto',
  };
};
