import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { setTerminalDark, setTheme, Theme, useThemeState } from './index';
import { useT } from '../i18n';

/** Two-button theme choice (Settings), styled like the language switch. */
export const ThemeSegmented: React.FC = () => {
  const t = useT();
  const { theme } = useThemeState();
  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: 'dark', label: t('Ciemny'), icon: <Moon className="h-3.5 w-3.5" /> },
    { value: 'light', label: t('Jasny'), icon: <Sun className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="flex rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setTheme(o.value)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            o.value === theme ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-700 hover:text-white'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
};

/** "Keep the SSH terminal dark" option – only meaningful in the light theme. */
export const TerminalDarkToggle: React.FC = () => {
  const t = useT();
  const { theme, terminalDark } = useThemeState();
  return (
    <label
      className={`flex items-center justify-between gap-3 pt-3 border-t border-slate-800/80 ${
        theme === 'light' ? 'cursor-pointer' : 'opacity-50'
      }`}
    >
      <div>
        <div className="text-xs text-slate-300">{t('Ciemny terminal SSH w jasnym motywie')}</div>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {t('Terminal zostaje ciemny, a reszta aplikacji jest jasna.')}
        </p>
      </div>
      <input
        type="checkbox"
        checked={terminalDark}
        disabled={theme !== 'light'}
        onChange={(e) => setTerminalDark(e.target.checked)}
        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
      />
    </label>
  );
};
