import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';

interface Props {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Render inside the nearest positioned parent (e.g. the SFTP window) instead of over the whole app. */
  contained?: boolean;
  /** 'info' = neutral message with a single OK button. */
  variant?: 'danger' | 'info';
  hideCancel?: boolean;
  /**
   * Screen point (e.g. the clicked button) next to which the dialog is shown instead of the
   * centre – used for deleting items in the sidebar so the prompt appears right next to them.
   */
  anchor?: DialogAnchor | null;
}

export interface DialogAnchor {
  /** Left edge for the dialog (usually the right edge of the clicked element). */
  x: number;
  /** Vertical centre of the clicked element. */
  y: number;
}

/** Anchor to the right of the element that triggered an action. */
export const anchorFromElement = (el: Element | null | undefined): DialogAnchor | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.right, y: r.top + r.height / 2 };
};

const ANCHOR_GAP = 10;
const EDGE = 8;

/** Small in-app confirmation dialog (Enter = confirm, Esc = cancel). */
export const ConfirmDialog: React.FC<Props> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Zamknij',
  cancelLabel = 'Anuluj',
  onConfirm,
  onCancel,
  contained = false,
  variant = 'danger',
  hideCancel = false,
  anchor = null,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrowTop: number | null } | null>(null);

  // Place the anchored dialog next to the anchor, kept inside the window
  useLayoutEffect(() => {
    if (!isOpen || !anchor) {
      setPos(null);
      return;
    }
    const place = () => {
      const box = boxRef.current;
      if (!box) return;
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = anchor.x + ANCHOR_GAP;
      let arrow = true;
      if (left + w > vw - EDGE) {
        left = Math.max(EDGE, vw - w - EDGE);
        arrow = false;
      }
      const top = Math.min(Math.max(EDGE, anchor.y - h / 2), Math.max(EDGE, vh - h - EDGE));
      const arrowTop = Math.min(Math.max(14, anchor.y - top), h - 14);
      setPos({ left, top, arrowTop: arrow ? arrowTop : null });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [isOpen, anchor]);

  useEffect(() => {
    if (!isOpen) return;
    // Focus the confirm button so Enter works immediately and keystrokes do not reach the terminal
    const t = setTimeout(() => confirmRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className={
        anchor
          ? 'fixed inset-0 z-[70] bg-slate-950/40'
          : `${contained ? 'absolute z-[60]' : 'fixed z-[70]'} inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4`
      }
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        className={`rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl ${
          anchor ? 'fixed w-[340px] max-w-[calc(100vw-16px)] shadow-black/60' : 'w-full max-w-sm'
        }`}
        style={
          anchor
            ? { left: pos?.left ?? anchor.x + ANCHOR_GAP, top: pos?.top ?? anchor.y, visibility: pos ? 'visible' : 'hidden' }
            : undefined
        }
      >
        {anchor && pos?.arrowTop != null && (
          <span
            aria-hidden
            className="absolute -left-[7px] h-3 w-3 -translate-y-1/2 rotate-45 border-b border-l border-slate-700 bg-slate-900"
            style={{ top: pos.arrowTop }}
          />
        )}
        <div
          className={`mb-2 flex items-center gap-2 text-sm font-bold ${variant === 'info' ? 'text-cyan-300' : 'text-amber-300'}`}
        >
          {variant === 'info' ? <Info className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {title}
        </div>
        <div className="text-xs leading-relaxed text-slate-300">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          {!hideCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-700 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={
              variant === 'info'
                ? 'rounded-lg bg-cyan-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/60'
                : 'rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-400/60'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
