import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Terminal,
  Monitor,
  X,
  RotateCcw,
  Copy,
  XCircle,
  PanelLeftOpen,
  Maximize2,
  Minimize2,
  Square,
  Columns2,
  Rows2,
  LayoutGrid,
  Columns3,
  KeyRound,
  User,
  Check,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api } from '../../services/api';
import { Connection, Group, SessionInfo, WorkspaceLayout } from '../../types';
import { useT } from '../../i18n';
import { useMenuPosition } from '../../utils/useMenuPosition';
import { SessionSwitcher } from './SessionSwitcher';

interface Props {
  sessions: SessionInfo[];
  connections: Connection[];
  groups: Group[];
  activeSessionId: string | null;
  layout: WorkspaceLayout;
  paneSlots: string[];
  onChangeLayout: (layout: WorkspaceLayout) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onReconnectSession: (sessionId: string) => void;
  onDuplicateSession: (sessionId: string) => void;
  onCloseOtherSessions: (sessionId: string) => void;
  onCloseAll: () => void;
  onReorderSessions?: (sourceSessionId: string, targetSessionId: string, position: 'left' | 'right') => void;
}

const getSlotCount = (layout: WorkspaceLayout): number => {
  switch (layout) {
    case 'single':
      return 1;
    case 'split-horizontal':
    case 'split-vertical':
      return 2;
    case 'columns-3':
      return 3;
    case 'grid-4':
      return 4;
  }
};

export const TabBar: React.FC<Props> = ({
  sessions,
  connections,
  groups,
  activeSessionId,
  layout,
  paneSlots,
  onChangeLayout,
  isSidebarCollapsed,
  onToggleSidebar,
  onSelectSession,
  onCloseSession,
  onReconnectSession,
  onDuplicateSession,
  onCloseOtherSessions,
  onCloseAll,
  onReorderSessions,
}) => {
  const t = useT();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    session: SessionInfo;
  } | null>(null);

  const [copyToast, setCopyToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);

  // Tab drag & drop reordering state
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [dragOverSessionId, setDragOverSessionId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'left' | 'right' | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const menuStyle = useMenuPosition(menuRef, contextMenu);
  const isDraggingRef = useRef(false);
  const slotCount = getSlotCount(layout);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const [scrollable, setScrollable] = useState({ left: false, right: false });
  const sessionOrder = sessions.map((session) => session.sessionId).join('\0');

  useLayoutEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const update = () => {
      const left = strip.scrollLeft > 1;
      const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setScrollable((previous) => previous.left === left && previous.right === right ? previous : { left, right });
    };
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    for (const child of strip.children) observer.observe(child);
    strip.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer.disconnect(); strip.removeEventListener('scroll', update); };
  }, [sessionOrder]);

  const revealTab = (sessionId: string | null) => {
    const strip = tabsRef.current;
    const selected = sessionId ? tabRefs.current.get(sessionId) : null;
    if (!strip || !selected) return;
    const viewport = strip.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < viewport.left) strip.scrollLeft += tab.left - viewport.left;
    else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
  };

  useLayoutEffect(() => { revealTab(activeSessionId); }, [activeSessionId, sessionOrder]);

  const scrollTabs = (direction: number) => {
    const strip = tabsRef.current;
    if (strip) strip.scrollBy({ left: direction * Math.max(160, strip.clientWidth * 0.75), behavior: 'smooth' });
  };

  const handleCopyPassword = async (session: SessionInfo) => {
    try {
      const password = session.connectionId ? await api.revealPassword(session.connectionId) : '';

      if (!password) {
        setCopyToast({
          message: t('Brak zapisanego hasła dla „{title}”', { title: session.title }),
          type: 'error',
        });
        setTimeout(() => setCopyToast(null), 3000);
        return;
      }

      await api.clipboardWriteText(password);
      setCopiedSessionId(session.sessionId);
      setCopyToast({
        message: t('Hasło sesji „{title}” zostało skopiowane do schowka!', { title: session.title }),
        type: 'success',
      });
      setTimeout(() => setCopiedSessionId(null), 2500);
      setTimeout(() => setCopyToast(null), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCopyToast({
        message: t('Błąd podczas pobierania hasła: {msg}', { msg }),
        type: 'error',
      });
      setTimeout(() => setCopyToast(null), 4000);
    }
  };

  const handleCopyUsername = async (session: SessionInfo) => {
    try {
      if (!session.username) {
        setCopyToast({
          message: t('Brak nazwy użytkownika dla „{title}”', { title: session.title }),
          type: 'error',
        });
        setTimeout(() => setCopyToast(null), 3000);
        return;
      }

      await api.clipboardWriteText(session.username);
      setCopyToast({
        message: t('Login ({username}) skopiowany do schowka!', { username: session.username }),
        type: 'success',
      });
      setTimeout(() => setCopyToast(null), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCopyToast({
        message: t('Błąd: {msg}', { msg }),
        type: 'error',
      });
      setTimeout(() => setCopyToast(null), 3000);
    }
  };

  // Close context menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="relative z-30 flex h-10 min-w-0 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/90 px-2 select-none"
    >
      {/* If sidebar is collapsed, show quick restore button */}
      {isSidebarCollapsed && onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          title={t('Pokaż panel połączeń (drzewo hostów) [Ctrl+B]')}
          className="flex h-7 items-center gap-1.5 rounded-md bg-slate-900 border border-slate-800 px-2 text-xs text-slate-300 hover:border-cyan-500/40 hover:bg-slate-800 hover:text-cyan-400 transition-colors shrink-0 mr-1.5"
        >
          <PanelLeftOpen className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-[11px] font-medium hidden sm:inline">{t('Połączenia')}</span>
        </button>
      )}

      {/* Scrollable Tabs Container */}
      <button type="button" aria-label={t('Przewiń zakładki w lewo')} title={t('Przewiń zakładki w lewo')}
        disabled={!scrollable.left} onClick={() => scrollTabs(-1)}
        className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-300 hover:bg-slate-800 disabled:cursor-default disabled:opacity-25">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div
        ref={tabsRef} aria-label={t('Zakładki połączeń')}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar py-1"
        onDragOver={(e) => {
          if (draggedSessionId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(e) => {
          const sourceId = e.dataTransfer.getData('text/remoteflow-tab-reorder') || draggedSessionId;
          if (sourceId && sessions.length > 0 && onReorderSessions) {
            const lastSession = sessions[sessions.length - 1];
            if (lastSession.sessionId !== sourceId) {
              onReorderSessions(sourceId, lastSession.sessionId, 'right');
            }
          }
          setDraggedSessionId(null);
          setDragOverSessionId(null);
          setDropPosition(null);
        }}
      >
        {sessions.map((session) => {
          const isActive = session.sessionId === activeSessionId;
          const isSSH = session.protocol === 'ssh';
          const isBeingDragged = draggedSessionId === session.sessionId;
          const isHoveredTarget = dragOverSessionId === session.sessionId;

          // Check if session is assigned to one of the visible split panes
          const visibleSlotIndex = paneSlots.slice(0, slotCount).indexOf(session.sessionId);
          const isSlotAssigned = visibleSlotIndex !== -1 && layout !== 'single';

          return (
            <div
              key={session.sessionId}
              ref={(element) => {
                if (element) tabRefs.current.set(session.sessionId, element); else tabRefs.current.delete(session.sessionId);
              }}
              data-session-id={session.sessionId}
              aria-current={isActive ? 'true' : undefined}
              draggable={true}
              onDragStart={(e) => {
                isDraggingRef.current = true;
                setDraggedSessionId(session.sessionId);
                e.dataTransfer.setData('text/remoteflow-session-id', session.sessionId);
                e.dataTransfer.setData('text/remoteflow-tab-reorder', session.sessionId);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDraggedSessionId(null);
                setDragOverSessionId(null);
                setDropPosition(null);
                setTimeout(() => {
                  isDraggingRef.current = false;
                }, 100);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!draggedSessionId || draggedSessionId === session.sessionId) {
                  if (dragOverSessionId) {
                    setDragOverSessionId(null);
                    setDropPosition(null);
                  }
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;
                const pos = e.clientX < midpoint ? 'left' : 'right';
                if (dragOverSessionId !== session.sessionId || dropPosition !== pos) {
                  setDragOverSessionId(session.sessionId);
                  setDropPosition(pos);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dragOverSessionId === session.sessionId) {
                    setDragOverSessionId(null);
                    setDropPosition(null);
                  }
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const sourceId = e.dataTransfer.getData('text/remoteflow-tab-reorder') || draggedSessionId;
                const targetId = session.sessionId;

                if (sourceId && targetId && sourceId !== targetId && onReorderSessions) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const midpoint = rect.left + rect.width / 2;
                  const pos = e.clientX < midpoint ? 'left' : 'right';
                  onReorderSessions(sourceId, targetId, pos);
                }

                setDraggedSessionId(null);
                setDragOverSessionId(null);
                setDropPosition(null);
              }}
              onClick={() => {
                if (isDraggingRef.current) return;
                onSelectSession(session.sessionId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY + 2, session });
              }}
              title={t('Przeciągnij zakładkę w inne miejsce, lub na pulpit roboczy aby podzielić ekran')}
              className={`group relative flex h-8 items-center gap-2 rounded-t-md border-t-2 px-3 text-xs font-medium transition-all cursor-grab active:cursor-grabbing max-w-[240px] shrink-0 select-none ${
                isBeingDragged
                  ? 'opacity-35 scale-[0.98] border-cyan-500/40 bg-slate-900/60 ring-1 ring-cyan-500/30'
                  : isActive
                  ? 'border-cyan-400 bg-slate-900 text-white shadow-sm'
                  : 'border-transparent bg-slate-950 text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
              }`}
            >
              {/* Drag Drop Insertion Indicator on the Left */}
              {isHoveredTarget && dropPosition === 'left' && (
                <div className="absolute -left-1 top-1 bottom-1 w-1 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.9)] z-50 pointer-events-none" />
              )}

              {/* Drag Drop Insertion Indicator on the Right */}
              {isHoveredTarget && dropPosition === 'right' && (
                <div className="absolute -right-1 top-1 bottom-1 w-1 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.9)] z-50 pointer-events-none" />
              )}
              {/* Protocol Icon */}
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${
                  isSSH ? 'text-emerald-400' : 'text-blue-400'
                }`}
              >
                {isSSH ? <Terminal className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
              </div>

              {/* Status Indicator Dot */}
              <span
                title={
                  session.status === 'connected'
                    ? t('Połączono pomyślnie')
                    : session.status === 'connecting'
                    ? t('Nawiązywanie połączenia...')
                    : session.status === 'disconnected'
                    ? t('Rozłączono: {p0}', { p0: session.statusMessage || '' })
                    : t('Błąd połączenia: {p0}', { p0: session.statusMessage || '' })
                }
                className={`h-2 w-2 shrink-0 rounded-full ${
                  session.status === 'connected'
                    ? 'bg-emerald-400 shadow-xs shadow-emerald-400/50'
                    : session.status === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : session.status === 'disconnected'
                    ? 'bg-slate-500'
                    : 'bg-red-400 animate-bounce'
                }`}
              />

              {/* Tab Title */}
              <span className="truncate max-w-[110px]" title={session.title}>
                {session.title}
              </span>

              {copiedSessionId === session.sessionId && (
                <span title={t('Hasło skopiowane!')} className="flex items-center text-emerald-400">
                  <Check className="h-3 w-3 animate-pulse" />
                </span>
              )}

              {/* Pane Number Badge when in split view */}
              {isSlotAssigned && (
                <span className="rounded bg-cyan-950 border border-cyan-500/40 px-1 py-0.2 text-[9px] font-mono text-cyan-300 font-bold shrink-0">
                  #{visibleSlotIndex + 1}
                </span>
              )}

              {/* Action Buttons: Split, Reload, Duplicate & Close */}
              <div className="ml-auto flex items-center gap-0.5 shrink-0">
                {/* Quick Split / Divide window button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSession(session.sessionId);
                    onChangeLayout(layout === 'single' ? 'split-horizontal' : layout);
                  }}
                  title={t('Podziel ekran obok siebie (Split Screen)')}
                  className="flex h-4.5 w-4.5 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-800 hover:text-cyan-400 transition-all"
                >
                  <Columns2 className="h-2.5 w-2.5" />
                </button>

                {/* Reload / Reconnect button (Nawiąż połączenie ponownie) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReconnectSession(session.sessionId);
                  }}
                  title={t('Połącz ponownie (Reload)')}
                  className="flex h-4.5 w-4.5 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-800 hover:text-cyan-400 transition-all"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                </button>

                {/* Duplicate / Open in new tab button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicateSession(session.sessionId);
                  }}
                  title={t('Duplikuj zakładkę (Otwórz w nowej karcie)')}
                  className="flex h-4.5 w-4.5 items-center justify-center rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-800 hover:text-cyan-400 transition-all"
                >
                  <Copy className="h-2.5 w-2.5" />
                </button>

                {/* Close Tab Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseSession(session.sessionId);
                  }}
                  title={t('Zamknij kartę')}
                  className="flex h-4.5 w-4.5 items-center justify-center rounded text-slate-400 opacity-60 group-hover:opacity-100 hover:bg-slate-800 hover:text-red-400 transition-all"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" aria-label={t('Przewiń zakładki w prawo')} title={t('Przewiń zakładki w prawo')}
        disabled={!scrollable.right} onClick={() => scrollTabs(1)}
        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-300 hover:bg-slate-800 disabled:cursor-default disabled:opacity-25">
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* Right Controls: Split Layout Switcher, Fullscreen Toggle, Close All */}
      <div className="flex items-center gap-2 pl-2 shrink-0">
        <SessionSwitcher sessions={sessions} connections={connections} groups={groups} activeSessionId={activeSessionId} onSelectSession={(id) => {
          onSelectSession(id);
          revealTab(id);
        }} />
        {/* Layout Switcher Buttons */}
        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
          <button
            type="button"
            onClick={() => onChangeLayout('single')}
            title={t('Pojedyncza karta (1 pełne okno)')}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              layout === 'single'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChangeLayout('split-horizontal')}
            title={t('Podział pionowy (2 okna obok siebie)')}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              layout === 'split-horizontal'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChangeLayout('split-vertical')}
            title={t('Podział poziomy (2 okna jedno pod drugim)')}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              layout === 'split-vertical'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Rows2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChangeLayout('grid-4')}
            title={t('Siatka 2x2 (4 okna równocześnie)')}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              layout === 'grid-4'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChangeLayout('columns-3')}
            title={t('3 kolumny obok siebie')}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              layout === 'columns-3'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Columns3 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Toggle Fullscreen / Sidebar Collapse */}
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title={
              isSidebarCollapsed
                ? t('Pokaż panel połączeń [Ctrl+B]')
                : t('Schowaj panel połączeń (pełny ekran) [Ctrl+B]')
            }
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
          >
            {isSidebarCollapsed ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        <button
          onClick={onCloseAll}
          title={t('Zamknij wszystkie karty')}
          className="rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-red-400 transition-colors"
        >
          {t('Zamknij wszystkie')}
        </button>
      </div>

      {/* Tab Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={menuStyle}
          className="fixed z-50 w-52 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-800">
            {contextMenu.session.title}
          </div>

          <div className="py-1 space-y-0.5 text-xs text-slate-200">
            {/* Copy Password */}
            <button
              onClick={() => {
                const s = contextMenu.session;
                setContextMenu(null);
                handleCopyPassword(s);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
            >
              <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
              <span>{t('Kopiuj hasło do schowka')}</span>
            </button>

            {/* Copy Username */}
            {contextMenu.session.username && (
              <button
                onClick={() => {
                  const s = contextMenu.session;
                  setContextMenu(null);
                  handleCopyUsername(s);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
              >
                <User className="h-3.5 w-3.5 text-slate-400" />
                <span>{t('Kopiuj login ({user})', { user: contextMenu.session.username })}</span>
              </button>
            )}

            <div className="my-1 border-t border-slate-800" />

            {/* Reconnect / Reload */}
            <button
              onClick={() => {
                onReconnectSession(contextMenu.session.sessionId);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-cyan-600 hover:text-white transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white" />
              <span>{t('Połącz ponownie (Reload)')}</span>
            </button>

            {/* Duplicate */}
            <button
              onClick={() => {
                onDuplicateSession(contextMenu.session.sessionId);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <Copy className="h-3.5 w-3.5 text-slate-400" />
              <span>{t('Otwórz w nowej karcie')}</span>
            </button>

            <div className="my-1 border-t border-slate-800" />

            {/* Split right */}
            <button
              onClick={() => {
                onSelectSession(contextMenu.session.sessionId);
                onChangeLayout('split-horizontal');
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
            >
              <Columns2 className="h-3.5 w-3.5 text-cyan-400" />
              <span>{t('Podziel w prawo (2 okna obok siebie)')}</span>
            </button>

            {/* Split down */}
            <button
              onClick={() => {
                onSelectSession(contextMenu.session.sessionId);
                onChangeLayout('split-vertical');
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
            >
              <Rows2 className="h-3.5 w-3.5 text-cyan-400" />
              <span>{t('Podziel w dół (2 okna pod spodem)')}</span>
            </button>

            {/* Single full screen */}
            {layout !== 'single' && (
              <button
                onClick={() => {
                  onSelectSession(contextMenu.session.sessionId);
                  onChangeLayout('single');
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <Square className="h-3.5 w-3.5 text-slate-400" />
                <span>{t('Pojedyncza karta (pełne okno)')}</span>
              </button>
            )}

            <div className="my-1 border-t border-slate-800" />

            {/* Close */}
            <button
              onClick={() => {
                onCloseSession(contextMenu.session.sessionId);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              <X className="h-3.5 w-3.5 text-slate-400" />
              <span>{t('Zamknij kartę')}</span>
            </button>

            {/* Close others */}
            <button
              onClick={() => {
                onCloseOtherSessions(contextMenu.session.sessionId);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <XCircle className="h-3.5 w-3.5 text-slate-400" />
              <span>{t('Zamknij pozostałe karty')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating feedback toast */}
      {copyToast && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-2 text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
          {copyToast.type === 'success' ? (
            <Check className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
          )}
          <span className={copyToast.type === 'success' ? 'text-emerald-300 font-medium' : 'text-amber-300 font-medium'}>
            {copyToast.message}
          </span>
        </div>
      )}
    </div>
  );
};
