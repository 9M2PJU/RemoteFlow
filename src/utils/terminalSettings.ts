/**
 * SSH terminal settings shared by all open terminals (Settings → Terminal).
 * The value is stored in the vault (`UiSettings.terminalScrollback`); App.tsx loads it and
 * updates it after the settings are saved, open terminals apply a change immediately.
 */
export const DEFAULT_TERMINAL_SCROLLBACK = 10_000;
export const MIN_TERMINAL_SCROLLBACK = 100;
export const MAX_TERMINAL_SCROLLBACK = 200_000;

export function clampScrollback(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_TERMINAL_SCROLLBACK;
  return Math.min(MAX_TERMINAL_SCROLLBACK, Math.max(MIN_TERMINAL_SCROLLBACK, n));
}

let scrollback = DEFAULT_TERMINAL_SCROLLBACK;
const listeners = new Set<(lines: number) => void>();

export function terminalScrollback(): number {
  return scrollback;
}

export function setTerminalScrollback(value: unknown): void {
  const next = value === undefined || value === null ? DEFAULT_TERMINAL_SCROLLBACK : clampScrollback(value);
  if (next === scrollback) return;
  scrollback = next;
  listeners.forEach((fn) => fn(next));
}

export function onTerminalScrollbackChange(fn: (lines: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Sequences that return the terminal to its normal state after the connection ended while a
 * full-screen program was running (mc, vim, less, htop, tmux…): leave the alternate screen (it has
 * no history – the scrollback is in the normal screen), stop mouse reporting (otherwise the mouse
 * wheel is sent to the dead session instead of scrolling), application cursor keys and bracketed
 * paste off, cursor visible, colours reset.
 */
export const TERMINAL_RESTORE_AFTER_DISCONNECT =
  '\x1b[?9l\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l' +
  '\x1b[?1l\x1b[?2004l\x1b[?25h\x1b[0m';
export const TERMINAL_LEAVE_ALTERNATE_SCREEN = '\x1b[?1049l';
