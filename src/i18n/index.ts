import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import enDict from './en.json';

const en: Record<string, string> = enDict;

/**
 * Minimal i18n: the Polish text is the key (and the Polish translation), `en.ts` maps it to English.
 * A missing English entry falls back to Polish, so nothing ever renders empty.
 * Placeholders in braces, e.g. {n}, are filled from the second argument of t().
 */
export type Lang = 'pl' | 'en';

export const LANGUAGES: { code: Lang; label: string; short: string }[] = [
  { code: 'pl', label: 'Polski', short: 'PL' },
  { code: 'en', label: 'English', short: 'EN' },
];

const STORAGE_KEY = 'remoteflow-lang';

const detect = (): Lang => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'pl' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'pl';
  return nav.toLowerCase().startsWith('pl') ? 'pl' : 'en';
};

let current: Lang = detect();
const listeners = new Set<() => void>();

const syncBackend = (lang: Lang) => {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    invoke('app_set_language', { lang }).catch(() => {});
  }
};

if (typeof document !== 'undefined') document.documentElement.lang = current;
syncBackend(current);

export const getLang = (): Lang => current;

export const setLang = (lang: Lang) => {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  syncBackend(lang);
  listeners.forEach((l) => l());
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export type TParams = Record<string, string | number | null | undefined>;

const interpolate = (text: string, params?: TParams) =>
  params ? text.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k]))) : text;

/** Translates a Polish source text into the current language. */
export const t = (text: string, params?: TParams): string =>
  interpolate(current === 'en' ? en[text] ?? text : text, params);

/**
 * Polish plural form for a count: 0 = one (1), 1 = few (2–4, 22–24…, but not 12–14), 2 = many (0, 5–21, 25…).
 */
export const plForm = (n: number): 0 | 1 | 2 => {
  const a = Math.abs(n);
  if (a === 1) return 0;
  const d = a % 10;
  const h = a % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? 1 : 2;
};

/**
 * Text with a count: picks the Polish form [one, few, many] for `n` and translates it. In en.json the
 * "one" form maps to the English singular, "few" and "many" to the plural (Polish "one" is only n = 1).
 */
export const tn = (n: number, forms: [string, string, string], params?: TParams): string => t(forms[plForm(n)], params);

/** Subscribes the component to language changes and returns `t`. */
export const useT = () => {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
};

export const useLang = (): Lang => useSyncExternalStore(subscribe, getLang, getLang);

/** Locale for dates and numbers. */
export const locale = (): string => (current === 'en' ? 'en-GB' : 'pl-PL');
