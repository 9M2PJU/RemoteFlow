import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, List, Monitor, Search, Terminal, X } from 'lucide-react';
import { Connection, Group, SessionInfo } from '../../types';
import { OverflowText } from '../common/OverflowText';
import { useT } from '../../i18n';
import { useMenuPosition } from '../../utils/useMenuPosition';

interface Props {
  sessions: SessionInfo[];
  connections: Connection[];
  groups: Group[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  compact?: boolean;
}

export function SessionSwitcher({ sessions, connections, groups, activeSessionId, onSelectSession, compact = false }: Props) {
  const t = useT();
  const menuId = useId();
  const label = compact ? t('Przełącz sesję w tym oknie') : t('Lista otwartych połączeń');
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(activeSessionId);
  const style = useMenuPosition(menu, anchor);
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const groupPaths = new Map(connections.map((connection) => {
    const path: string[] = [];
    const visited = new Set<string>();
    let id = connection.groupId;
    while (id && !visited.has(id)) {
      visited.add(id);
      const group = groupsById.get(id);
      if (!group) break;
      path.unshift(group.name);
      id = group.parentId;
    }
    return [connection.id, path.join(' / ')] as const;
  }));
  const groupFor = (session: SessionInfo) => groupPaths.get(session.connectionId) || t('Bez grupy');
  const filter = query.trim().toLocaleLowerCase();
  const matches = sessions.filter((session) =>
    `${session.title} ${groupFor(session)} ${session.host} ${session.port} ${session.username} ${session.protocol}`.toLocaleLowerCase().includes(filter));
  const selectedId = matches.some((session) => session.sessionId === highlightedId) ? highlightedId : matches[0]?.sessionId;

  const close = () => { setAnchor(null); trigger.current?.focus(); };
  const select = (id: string) => { onSelectSession(id); close(); };

  useEffect(() => {
    if (!anchor) return;
    search.current?.focus();
    window.dispatchEvent(new Event('remoteflow-session-switcher'));
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setAnchor(null);
    };
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setAnchor({ x: rect.right, y: rect.bottom + 6 });
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.dispatchEvent(new Event('remoteflow-session-switcher'));
    };
  }, [!!anchor]);

  useEffect(() => {
    if (anchor && selectedId) rows.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, !!anchor]);

  return <>
    <button ref={trigger} type="button" title={label} aria-label={label}
      aria-expanded={!!anchor} aria-haspopup="dialog" aria-controls={anchor ? menuId : undefined}
      onClick={() => {
        if (anchor) { close(); return; }
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) { setQuery(''); setHighlightedId(activeSessionId); setAnchor({ x: rect.right, y: rect.bottom + 6 }); }
      }}
      className={`flex shrink-0 items-center gap-1 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-300 ${compact ? 'h-5 px-1 text-[10px]' : 'h-7 px-2 text-xs'}`}>
      <List className="h-3.5 w-3.5" />{!compact && <span>{sessions.length}</span>}<ChevronDown className="h-3 w-3" />
    </button>
    {anchor && createPortal(<div ref={menu} id={menuId} data-session-switcher role="dialog" aria-label={compact ? label : t('Otwarte połączenia')}
      style={{ ...style, maxHeight: compact ? 'min(300px, calc(100vh - 16px))' : 'min(440px, calc(100vh - 16px))' }}
      className={`fixed z-[80] flex flex-col rounded-xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl ${compact ? 'w-[min(300px,calc(100vw-16px))]' : 'w-[min(420px,calc(100vw-16px))]'}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation();
          if (!matches.length) return;
          const index = matches.findIndex((session) => session.sessionId === selectedId);
          const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
          setHighlightedId(matches[next].sessionId);
          search.current?.focus();
        }
      }}>
      <div className="flex shrink-0 items-center justify-between px-3 pt-3 text-xs font-semibold">
        <span>{t('Otwarte połączenia')} <span className="text-slate-400">({matches.length}/{sessions.length})</span></span>
        <button type="button" aria-label={t('Zamknij listę połączeń')} title={t('Zamknij listę połączeń')}
          onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="relative m-3 shrink-0">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
        <input ref={search} value={query} aria-label={t('Szukaj otwartego połączenia')}
          placeholder={t('Szukaj nazwy, grupy, hosta lub użytkownika...')}
          onChange={(event) => { setQuery(event.target.value); setHighlightedId(null); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && selectedId) { event.preventDefault(); event.stopPropagation(); select(selectedId); }
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-8 pr-3 text-xs text-white outline-hidden focus:border-cyan-500" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {matches.length === 0 && <p className="px-3 py-5 text-center text-xs text-slate-400">{t('Brak pasujących połączeń')}</p>}
        {matches.map((session) => {
          const active = session.sessionId === activeSessionId;
          const groupLabel = t('Grupa: {name}', { name: groupFor(session) });
          const status = session.status === 'connected' ? t('Połączono pomyślnie') : session.status === 'connecting'
            ? t('Nawiązywanie połączenia...') : session.status === 'disconnected' ? t('Rozłączono') : t('Błąd połączenia');
          return <button key={session.sessionId} type="button" ref={(element) => {
            if (element) rows.current.set(session.sessionId, element); else rows.current.delete(session.sessionId);
          }} aria-current={active ? 'true' : undefined} onClick={() => select(session.sessionId)}
            onFocus={() => setHighlightedId(session.sessionId)}
            title={`${session.title} · ${groupLabel} · ${session.username}@${session.host}:${session.port} · ${status} · ${session.startedAt}`}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-800 focus:bg-slate-800 focus:outline-hidden ${
              selectedId === session.sessionId ? 'bg-slate-800' : ''} ${active ? 'text-cyan-300' : 'text-slate-200'}`}>
            {session.protocol === 'ssh' ? <Terminal className="h-4 w-4 shrink-0 text-emerald-400" /> : <Monitor className="h-4 w-4 shrink-0 text-blue-400" />}
            <span className="min-w-0 flex-1">
              <OverflowText text={session.title} className="font-semibold" />
              <OverflowText text={`${session.username}@${session.host}:${session.port} · ${session.protocol.toUpperCase()}`} className="text-[11px] text-slate-400" />
              <OverflowText text={groupLabel} className="text-[11px] text-slate-400" />
            </span>
            <span title={status} aria-label={status} className={`h-2 w-2 shrink-0 rounded-full ${session.status === 'connected' ? 'bg-emerald-400' : session.status === 'connecting' ? 'bg-amber-400' : session.status === 'error' ? 'bg-red-400' : 'bg-slate-500'}`} />
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{active && <Check className="h-3.5 w-3.5" />}</span>
          </button>;
        })}
      </div>
    </div>, document.body)}
  </>;
}
