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
  // The position remembers which anchor it was computed for: when the menu is re-opened at
  // another point, the old position is not used even for one frame (no flash at the old place).
  const [pos, setPos] = useState<{ left: number; top: number; x: number; y: number } | null>(null);
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

    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top), x, y });
  }, [ref, x, y]);

  if (x === undefined || y === undefined) return { visibility: 'hidden' };
  const current = pos && pos.x === x && pos.y === y ? pos : null;
  return {
    left: current?.left ?? x,
    top: current?.top ?? y,
    // Hidden for the first (measuring) render, so the menu never flashes in the wrong place
    visibility: current ? 'visible' : 'hidden',
    maxHeight: `calc(100vh - ${2 * MARGIN}px)`,
    overflowY: 'auto',
  };
};
