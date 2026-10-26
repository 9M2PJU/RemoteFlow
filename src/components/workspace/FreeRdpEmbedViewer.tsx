import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Monitor, RefreshCw } from 'lucide-react';
import { SessionInfo } from '../../types';
import { api, EmbedRect } from '../../services/api';
import { useT } from '../../i18n';

/**
 * RDP session drawn by the native FreeRDP client inside the RemoteFlow window (Linux, X11/XWayland).
 *
 * The backend places a native child window over `areaRef` (session/rdp_embed.rs). Native windows
 * always stay above the web content, so the container is moved/resized with the area and hidden
 * while the tab is not visible or something (a dialog) covers the area.
 */

type Status = 'starting' | 'connected' | 'disconnected' | 'error';

/** Part of the area (0..1) covered by other page elements, sampled on a grid. */
function coveredFraction(area: HTMLElement, r: DOMRect): number {
  const cols = 5;
  const rows = 4;
  let covered = 0;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = r.left + ((i + 0.5) / cols) * r.width;
      const y = r.top + ((j + 0.5) / rows) * r.height;
      const el = document.elementFromPoint(x, y);
      if (!el || !area.contains(el)) covered++;
    }
  }
  return covered / (cols * rows);
}

export const FreeRdpEmbedViewer: React.FC<{ session: SessionInfo; isActive: boolean }> = ({ session, isActive }) => {
  const t = useT();
  const sid = session.sessionId;
  const areaRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lastSent = useRef('');
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const statusRef = useRef(status);
  statusRef.current = status;

  const rectOf = useCallback((): EmbedRect | null => {
    const el = areaRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, []);

  // Process output and state (shared events of spawn_rdp_session)
  useEffect(() => {
    const unData = listen<string>(`rdp-data-${sid}`, (e) => {
      setLogs((l) => [...l.slice(-60), String(e.payload)]);
    });
    const unStatus = listen<string>(`rdp-status-${sid}`, (e) => {
      if (e.payload === 'connected') setStatus('connected');
      else if (e.payload === 'error') setStatus('error');
      else if (e.payload === 'disconnected') setStatus('disconnected');
    });
    return () => {
      unData.then((f) => f());
      unStatus.then((f) => f());
    };
  }, [sid]);

  // Start when the tab is first shown (the area must have a size), restart on "Reconnect"
  useEffect(() => {
    if (started || !isActive) return;
    let cancelled = false;
    const tryStart = () => {
      if (cancelled) return;
      const rect = rectOf();
      if (!rect) {
        setTimeout(tryStart, 100);
        return;
      }
      setStarted(true);
      setStatus('starting');
      setStartError(null);
      lastSent.current = '';
      api.rdpEmbedStart(session, rect).catch((err: any) => {
        setStartError(String(err?.message || err));
        setStatus('error');
      });
    };
    tryStart();
    return () => {
      cancelled = true;
    };
  }, [started, isActive, attempt, rectOf, session]);

  // Keep the native window over the area
  useEffect(() => {
    if (!started) return;
    const sync = () => {
      const el = areaRef.current;
      const rect = rectOf();
      const running = statusRef.current === 'starting' || statusRef.current === 'connected';
      let visible = !!el && !!rect && running && isActiveRef.current && document.visibilityState === 'visible'
        && !document.querySelector('[data-session-switcher]');
      if (visible && el && rect) {
        visible = coveredFraction(el, el.getBoundingClientRect()) < 0.25;
      }
      const r = rect ?? { x: 0, y: 0, width: 0, height: 0 };
      const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)},${visible}`;
      if (key === lastSent.current) return;
      lastSent.current = key;
      api.rdpEmbedUpdate(sid, r, visible).catch(() => {});
    };
    const id = setInterval(sync, 150);
    const ro = new ResizeObserver(sync);
    if (areaRef.current) ro.observe(areaRef.current);
    window.addEventListener('resize', sync);
    window.addEventListener('remoteflow-session-switcher', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      clearInterval(id);
      ro.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('remoteflow-session-switcher', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [started, sid, rectOf]);

  // Re-sync immediately on tab/status changes
  useEffect(() => {
    lastSent.current = '';
  }, [isActive, status]);

  // FreeRDP takes the keyboard when the pointer enters the session; a click on the web content
  // (outside the native window) gives it back to RemoteFlow.
  useEffect(() => {
    const onDown = () => {
      api.rdpEmbedReleaseFocus().catch(() => {});
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  // Closing the tab / unmounting ends the process
  useEffect(() => {
    return () => {
      api.rdpEmbedStop(sid).catch(() => {});
    };
  }, [sid]);

  const reconnect = useCallback(() => {
    api
      .rdpEmbedStop(sid)
      .catch(() => {})
      .finally(() => {
        setLogs([]);
        setStarted(false);
        setAttempt((a) => a + 1);
      });
  }, [sid]);

  useEffect(() => {
    const trusted = (event: Event) => {
      if ((event as CustomEvent<string>).detail === sid) reconnect();
    };
    window.addEventListener('remoteflow-rdp-certificate-trusted', trusted);
    return () => window.removeEventListener('remoteflow-rdp-certificate-trusted', trusted);
  }, [sid, reconnect]);

  const openSeparate = () => {
    api.launchExternalRdp(session).catch(() => {});
  };

  const failed = status === 'error' || status === 'disconnected';
  const errorText = startError || logs.filter((l) => /ERROR|error|❌|ERRCONNECT/.test(l)).slice(-6).join('\n') || logs.slice(-6).join('\n');

  return (
    <div className="flex h-full w-full flex-col bg-rdp-bg">
      <div className="rf-dark flex min-w-0 items-center gap-2 whitespace-nowrap border-b border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300">
        <Monitor className="h-3.5 w-3.5 shrink-0 text-purple-400" />
        <span className="min-w-0 truncate font-medium text-white">{session.title}</span>
        <span className="hidden truncate font-mono text-[11px] text-slate-500 md:inline">
          {session.host}:{session.port}
        </span>
        <span className="hidden shrink-0 rounded border border-purple-500/40 bg-purple-950/40 px-1.5 py-0.5 text-[10px] text-purple-200 sm:inline">
          {t('FreeRDP w oknie')}
        </span>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            status === 'connected' ? 'bg-emerald-400' : status === 'starting' ? 'bg-amber-400 animate-pulse' : 'bg-red-400'
          }`}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={reconnect}
            title={t('Połącz ponownie')}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={openSeparate}
            title={t('Otwórz to połączenie w osobnym oknie FreeRDP')}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
          >
            <ExternalLink className="h-3 w-3 text-purple-400" />
            <span className="hidden sm:inline">{t('Osobne okno')}</span>
          </button>
        </div>
      </div>

      {/* The native FreeRDP window is placed exactly over this element */}
      <div ref={areaRef} className="relative min-h-0 flex-1">
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
            {t('Uruchamianie FreeRDP...')}
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle className="h-7 w-7 text-red-400" />
            <div className="text-sm font-semibold text-white">
              {status === 'error' ? t('Błąd połączenia z sesją RDP') : t('Sesja RDP zakończona')}
            </div>
            {errorText && (
              <div className="relative w-full max-w-2xl">
                <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 pr-8 text-left font-mono text-[10px] text-slate-400">
                  {errorText}
                </pre>
                <button
                  type="button"
                  title={t('Kopiuj treść błędu')}
                  onClick={() => {
                    api.clipboardWriteText(logs.join('\n') || errorText).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="absolute right-1.5 top-1.5 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={reconnect}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('Połącz ponownie')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
