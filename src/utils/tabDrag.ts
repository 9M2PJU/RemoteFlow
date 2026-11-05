/**
 * Dragging a tab with the pointer (TabBar) to a workspace pane or split edge (Workspace).
 *
 * Tabs are moved with pointer events instead of HTML drag & drop: on Windows the WebView2 window
 * handles file drops natively (Tauri `dragDropEnabled`, needed for dropping local files into SFTP),
 * which disables HTML drag & drop between page elements; in WebKitGTK it depends on the X11/Wayland
 * drag protocol. The tab bar reports the pointer position with this window event.
 */
export const TAB_DRAG_EVENT = 'remoteflow-tab-drag';

export interface TabDragDetail {
  sessionId: string;
  x: number;
  y: number;
  phase: 'move' | 'drop' | 'cancel';
}

export function emitTabDrag(detail: TabDragDetail): void {
  window.dispatchEvent(new CustomEvent<TabDragDetail>(TAB_DRAG_EVENT, { detail }));
}

/**
 * Where a tab dropped at `x` lands: insertion index 0..n among `rects` (tab rectangles in order).
 * Returns null when the tab would stay where it is.
 */
export function tabInsertIndex(rects: { left: number; width: number }[], sourceIndex: number, x: number): number | null {
  let index = rects.length;
  for (let i = 0; i < rects.length; i++) {
    if (x < rects[i].left + rects[i].width / 2) {
      index = i;
      break;
    }
  }
  return index === sourceIndex || index === sourceIndex + 1 ? null : index;
}

