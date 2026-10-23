import { useSyncExternalStore } from 'react';

/**
 * Colour theme (dark / light). The whole UI is written with Tailwind's dark palette; the light
 * theme re-maps the palette CSS variables under `html.light` (see `index.css`), so components do
 * not need separate light classes. The choice is kept in localStorage (like the language), so it
 * applies to the login screen as well.
 */
export type Theme = 'dark' | 'light';

const THEME_KEY = 'remoteflow-theme';
const TERMINAL_DARK_KEY = 'remoteflow-terminal-dark';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
};

interface ThemeState {
  theme: Theme;
  /** Keep the SSH terminal dark even in the light theme. */
  terminalDark: boolean;
}

let state: ThemeState = {
  theme: read(THEME_KEY) === 'light' ? 'light' : 'dark',
  terminalDark: read(TERMINAL_DARK_KEY) === '1',
};
const listeners = new Set<() => void>();

const syncWindow = (theme: Theme) => {
  // Title bar of the native window (Windows / Linux) follows the theme
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme))
      .catch(() => {});
  }
};

/** Applies the theme to <html>; called on startup (main.tsx) and on every change. */
export const applyTheme = () => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('light', state.theme === 'light');
  root.style.colorScheme = state.theme;
  syncWindow(state.theme);
};

const emit = () => {
  applyTheme();
  listeners.forEach((l) => l());
};

export const getThemeState = (): ThemeState => state;

export const setTheme = (theme: Theme) => {
  if (theme === state.theme) return;
  state = { ...state, theme };
  write(THEME_KEY, theme);
  emit();
};

export const setTerminalDark = (terminalDark: boolean) => {
  if (terminalDark === state.terminalDark) return;
  state = { ...state, terminalDark };
  write(TERMINAL_DARK_KEY, terminalDark ? '1' : '0');
  emit();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const useThemeState = (): ThemeState => useSyncExternalStore(subscribe, getThemeState, getThemeState);
export const useTheme = (): Theme => useThemeState().theme;

/** true when the SSH terminal should use its light colours. */
export const useLightTerminal = (): boolean => {
  const s = useThemeState();
  return s.theme === 'light' && !s.terminalDark;
};
