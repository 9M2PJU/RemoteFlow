import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { LANGUAGES, Lang, setLang, useLang, useT } from './index';

/**
 * Language selector styled like the other header buttons and context menus
 * (a native <select> opens an OS-styled list that does not match the dark UI).
 */
export const LanguageSwitcher: React.FC<{ className?: string }> = ({ className = '' }) => {
  const lang = useLang();
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const choose = (code: Lang) => {
    setLang(code);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('Język interfejsu')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
          open
            ? 'border-cyan-500/50 bg-slate-800 text-white'
            : 'border-slate-800 bg-slate-800/60 text-slate-200 hover:bg-slate-800 hover:text-white'
        }`}
      >
        <Languages className="h-3 w-3 text-cyan-400" />
        <span className="font-mono tracking-wide">{current.short}</span>
        <ChevronDown className={`h-3 w-3 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('Język interfejsu')}
          className="absolute right-0 top-full z-[80] mt-1 w-40 rounded-lg border border-slate-700 bg-slate-900/95 py-1 text-xs text-slate-200 shadow-xl shadow-black/50 backdrop-blur-md"
        >
          <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t('Język interfejsu')}
          </div>
          {LANGUAGES.map((l) => {
            const active = l.code === lang;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(l.code)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-800 ${
                  active ? 'text-white' : 'text-slate-300'
                }`}
              >
                <span
                  className={`w-6 rounded px-1 py-px text-center font-mono text-[10px] ${
                    active ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {l.short}
                </span>
                <span className="flex-1">{l.label}</span>
                {active && <Check className="h-3.5 w-3.5 text-cyan-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Two-button language choice for forms (Settings). */
export const LanguageSegmented: React.FC = () => {
  const lang = useLang();
  return (
    <div className="flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            l.code === lang ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
          }`}
        >
          <span className="font-mono text-[10px] opacity-80">{l.short}</span>
          {l.label}
        </button>
      ))}
    </div>
  );
};
