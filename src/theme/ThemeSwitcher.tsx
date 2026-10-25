import React, { useEffect, useState } from 'react';
import { Cpu, ExternalLink, Gauge, Monitor, Moon, Sun } from 'lucide-react';
import { api } from '../services/api';
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

/**
 * Linux only: GPU (DMA-BUF) rendering of WebKitGTK – fast, the default – or the compatible
 * (slower) mode for systems where the GPU path fails (`KMS: DRM_IOCTL_MODE_CREATE_DUMB failed`).
 * Applied at the next start; renders nothing on other systems.
 */
export const LinuxRenderingSetting: React.FC = () => {
  const t = useT();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.getDisplaySettings>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDisplaySettings().then(setInfo).catch(() => {});
  }, []);

  if (!info?.supported) return null;

  const choose = async (safe: boolean) => {
    if (safe === info.safeRendering) return;
    try {
      await api.setSafeRendering(safe);
      setInfo({ ...info, safeRendering: safe });
      setError(null);
    } catch (err: any) {
      setError(String(err?.message || err));
    }
  };

  const options = [
    { safe: false, label: t('Szybkie (GPU)'), icon: <Gauge className="h-3.5 w-3.5" /> },
    { safe: true, label: t('Zgodne (wolniejsze)'), icon: <Cpu className="h-3.5 w-3.5" /> },
  ];
  const restartNeeded = info.safeRendering !== info.activeSafeRendering && !info.forcedByEnv;

  return (
    <div className="pt-3 border-t border-slate-800/80 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-300">{t('Renderowanie okna (Linux)')}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {t('Tryb zgodny pomaga, gdy pojawia się błąd „DRM_IOCTL_MODE_CREATE_DUMB” / „GBM buffer” albo okno miga lub jest puste. Zmiana działa po ponownym uruchomieniu programu.')}
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
          {options.map((o) => (
            <button
              key={String(o.safe)}
              type="button"
              onClick={() => choose(o.safe)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                o.safe === info.safeRendering
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {restartNeeded && (
        <p className="text-[11px] text-amber-300">{t('Uruchom program ponownie, aby zastosować zmianę.')}</p>
      )}
      {info.forcedByEnv && (
        <p className="text-[11px] text-slate-500">
          {t('Tryb zgodny jest teraz wymuszony zmienną środowiskową REMOTEFLOW_SAFE_RENDERING=1.')}
        </p>
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
};

/** Linux: RDP client – embedded IronRDP (WebAssembly) or FreeRDP drawn inside the window. */
export const LinuxRdpClientSetting: React.FC = () => {
  const t = useT();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.getDisplaySettings>> | null>(null);
  const [startValue, setStartValue] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDisplaySettings()
      .then((i) => {
        setInfo(i);
        setStartValue(i.rdpFreerdpEmbedded);
      })
      .catch(() => {});
  }, []);

  if (!info?.supported) return null;

  const choose = async (embedded: boolean) => {
    if (embedded === info.rdpFreerdpEmbedded) return;
    try {
      await api.setRdpFreerdpEmbedded(embedded);
      setInfo({ ...info, rdpFreerdpEmbedded: embedded });
      setError(null);
    } catch (err: any) {
      setError(String(err?.message || err));
    }
  };

  const options = [
    { embedded: false, label: t('Wbudowany'), icon: <Monitor className="h-3.5 w-3.5" /> },
    { embedded: true, label: t('FreeRDP w oknie'), icon: <ExternalLink className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="pt-3 border-t border-slate-800/80 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-300">{t('Klient RDP (Linux)')}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {t('FreeRDP rysuje sesję w zakładce RemoteFlow jako natywny klient (wiele wątków, H.264) – szybszy przy zmianie okien, wideo i przewijaniu. Wymaga X11; w sesji Wayland program uruchamia się wtedy przez XWayland. Zmiana działa po ponownym uruchomieniu programu.')}
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-slate-700 bg-slate-800/60 p-0.5">
          {options.map((o) => (
            <button
              key={String(o.embedded)}
              type="button"
              onClick={() => choose(o.embedded)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                o.embedded === info.rdpFreerdpEmbedded
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {info.rdpFreerdpEmbedded && !info.xfreerdpInstalled && (
        <p className="text-[11px] text-amber-300">
          {t('Nie znaleziono klienta xfreerdp3 / xfreerdp. Zainstaluj go, np.: sudo apt install freerdp3-x11')}
        </p>
      )}
      {startValue !== null && info.rdpFreerdpEmbedded !== startValue && (
        <p className="text-[11px] text-amber-300">{t('Uruchom program ponownie, aby zastosować zmianę.')}</p>
      )}
      {startValue && info.rdpFreerdpEmbedded && !info.x11 && (
        <p className="text-[11px] text-amber-300">
          {t('Okno nie działa w trybie X11 (brak XWayland lub ustawiona zmienna GDK_BACKEND) – sesje RDP używają wbudowanego klienta.')}
        </p>
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
};
