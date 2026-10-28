import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  Terminal,
  Monitor,
  Shield,
  Zap,
  Activity,
  ArrowRight,
  Plus,
  GripVertical,
  Maximize2,
  X,
  RotateCcw,
  ArrowRightLeft,
  LayoutGrid,
  Columns2,
  Rows2,
} from 'lucide-react';
import { Connection, Group, SessionInfo, WorkspaceLayout } from '../../types';
import { SessionSwitcher } from './SessionSwitcher';
import { useT } from '../../i18n';
import { useEmbeddedFreeRdp } from '../../utils/rdpClientMode';
import { anchorFromElement, DialogAnchor } from '../dialogs/ConfirmDialog';

// Session viewers are loaded on demand. The RDP viewer embeds the IronRDP WebAssembly engine
// (~6 MB of JavaScript); bundling it into the main chunk made every app start parse it, which
// was especially slow on Windows (WebView2). Now it is only loaded for the first RDP session
// (and preloaded in the background a few seconds after start-up).
const loadSshTerminal = () => import('./SshTerminal');
const loadRdpViewer = () => import('./RdpViewer');
const SshTerminal = lazy(() => loadSshTerminal().then((m) => ({ default: m.SshTerminal })));
const RdpViewer = lazy(() => loadRdpViewer().then((m) => ({ default: m.RdpViewer })));
const FreeRdpEmbedViewer = lazy(() =>
  import('./FreeRdpEmbedViewer').then((m) => ({ default: m.FreeRdpEmbedViewer }))
);

const ViewerLoading: React.FC<{ label: string }> = ({ label }) => (
  <div role="status" className="flex h-full w-full items-center justify-center bg-rdp-bg text-xs text-slate-400">
    {label}
  </div>
);

interface Props {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  connections: Connection[];
  groups: Group[];
  layout: WorkspaceLayout;
  paneSlots: string[];
  onChangeLayout: (layout: WorkspaceLayout) => void;
  onUpdatePaneSlot: (paneIndex: number, sessionId: string) => void;
  onSwapPaneSlots: (sourceIndex: number, targetIndex: number) => void;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string, anchor?: DialogAnchor | null) => void;
  onReconnectSession: (sessionId: string) => void;
  onConnect: (connection: Connection) => void;
  onNewConnection: () => void;
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

const getGridTemplate = (layout: WorkspaceLayout): { columns: string; rows: string } => {
  switch (layout) {
    case 'single':
      return { columns: '1fr', rows: '1fr' };
    case 'split-horizontal':
      return { columns: '1fr 1fr', rows: '1fr' };
    case 'split-vertical':
      return { columns: '1fr', rows: '1fr 1fr' };
    case 'columns-3':
      return { columns: '1fr 1fr 1fr', rows: '1fr' };
    case 'grid-4':
      return { columns: '1fr 1fr', rows: '1fr 1fr' };
  }
};

const getPaneGridStyle = (layout: WorkspaceLayout, paneIndex: number): React.CSSProperties => {
  switch (layout) {
    case 'single':
      return { gridColumn: '1 / 2', gridRow: '1 / 2' };
    case 'split-horizontal':
      return { gridColumn: `${paneIndex + 1} / ${paneIndex + 2}`, gridRow: '1 / 2' };
    case 'split-vertical':
      return { gridColumn: '1 / 2', gridRow: `${paneIndex + 1} / ${paneIndex + 2}` };
    case 'columns-3':
      return { gridColumn: `${paneIndex + 1} / ${paneIndex + 2}`, gridRow: '1 / 2' };
    case 'grid-4': {
      const col = (paneIndex % 2) + 1;
      const row = Math.floor(paneIndex / 2) + 1;
      return { gridColumn: `${col} / ${col + 1}`, gridRow: `${row} / ${row + 1}` };
    }
  }
};

export const Workspace: React.FC<Props> = ({
  sessions,
  activeSessionId,
  connections,
  groups,
  layout,
  paneSlots,
  onChangeLayout,
  onUpdatePaneSlot,
  onSwapPaneSlots,
  onSelectSession,
  onCloseSession,
  onReconnectSession,
  onConnect,
  onNewConnection,
}) => {
  const t = useT();
  const embeddedFreeRdp = useEmbeddedFreeRdp();
  const [dragOverPaneIndex, setDragOverPaneIndex] = useState<number | null>(null);
  const [splitHoverZone, setSplitHoverZone] = useState<'right' | 'bottom' | null>(null);

  // Preload the session viewers in the background once the UI is up, so the first connection
  // does not wait for them, without slowing down application start-up.
  useEffect(() => {
    const t = setTimeout(() => {
      loadSshTerminal().catch(() => {});
      loadRdpViewer().catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  const slotCount = getSlotCount(layout);
  const gridTemplate = getGridTemplate(layout);

  // Trigger resize event whenever layout or active slots change so terminals & RDP canvases adapt smoothly
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
    return () => clearTimeout(timer);
  }, [layout, paneSlots]);

  // Drag and Drop handlers
  const handlePaneDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData('text/remoteflow-session-id', sessionId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, paneIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPaneIndex !== paneIndex) {
      setDragOverPaneIndex(paneIndex);
    }
  };

  const handleDragLeave = (e: React.DragEvent, paneIndex: number) => {
    e.preventDefault();
    if (dragOverPaneIndex === paneIndex) {
      setDragOverPaneIndex(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetPaneIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPaneIndex(null);
    setSplitHoverZone(null);
    const draggedSessionId = e.dataTransfer.getData('text/remoteflow-session-id');
    if (!draggedSessionId) return;

    const sourcePaneIndex = paneSlots.slice(0, slotCount).indexOf(draggedSessionId);
    if (sourcePaneIndex !== -1 && sourcePaneIndex !== targetPaneIndex) {
      onSwapPaneSlots(sourcePaneIndex, targetPaneIndex);
    } else {
      onUpdatePaneSlot(targetPaneIndex, draggedSessionId);
    }
    onSelectSession(draggedSessionId);
  };

  const handleWorkspaceDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (layout === 'single') {
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;

      if (relX > 0.65) {
        setSplitHoverZone('right');
      } else if (relY > 0.65) {
        setSplitHoverZone('bottom');
      } else {
        setSplitHoverZone(null);
      }
    }
  };

  const handleWorkspaceDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setSplitHoverZone(null);
    }
  };

  const handleWorkspaceDrop = (e: React.DragEvent) => {
    if (layout === 'single' && splitHoverZone) {
      e.preventDefault();
      const zone = splitHoverZone;
      setSplitHoverZone(null);
      const draggedSessionId = e.dataTransfer.getData('text/remoteflow-session-id');
      if (!draggedSessionId) return;

      if (zone === 'right') {
        onChangeLayout('split-horizontal');
        onUpdatePaneSlot(1, draggedSessionId);
        onSelectSession(draggedSessionId);
      } else if (zone === 'bottom') {
        onChangeLayout('split-vertical');
        onUpdatePaneSlot(1, draggedSessionId);
        onSelectSession(draggedSessionId);
      }
    }
  };

  // Welcome Screen when no sessions are open
  if (sessions.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8 select-none bg-slate-950 overflow-y-auto">
        <div className="max-w-2xl text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 text-cyan-400 shadow-xl shadow-cyan-500/10">
            <Zap className="h-8 w-8" />
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-white">
            {t('Witaj w RemoteFlow')}
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            {t('Nowoczesny menedżer SSH & RDP inspirowany mRemoteNG — zoptymalizowany pod kątem wieloplatformowości, szyfrowania Master Password, dzielenia okien i obsługi ponad 100 sesji jednocześnie.')}
          </p>

          {/* Quick Metrics */}
          <div className="my-8 grid grid-cols-3 gap-4 text-left">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400">
                <Shield className="h-4 w-4" />
                {t('Kryptografia')}
              </div>
              <div className="mt-2 text-lg font-bold text-white">{t('Argon2id + AES')}</div>
              <div className="mt-1 text-xs text-slate-500">
                {t('Lokalne szyfrowanie bazy, Master Password i opcjonalny PIN')}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                <Activity className="h-4 w-4" />
                {t('Wydajność')}
              </div>
              <div className="mt-2 text-lg font-bold text-white">{t('100+ Sesji')}</div>
              <div className="mt-1 text-xs text-slate-500">
                {t('Lekki runtime Rust Tokio + wirtualizacja kart terminala')}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
                <LayoutGrid className="h-4 w-4" />
                {t('Podział Okien')}
              </div>
              <div className="mt-2 text-lg font-bold text-white">{t('Split Screen')}</div>
              <div className="mt-1 text-xs text-slate-500">
                {t('Dynamiczne przeciąganie, podział poziomy, pionowy i siatka 2x2')}
              </div>
            </div>
          </div>

          {/* Quick Connect List */}
          {connections.length > 0 ? (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left">
              <div className="mb-3 flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <span>{t('Zdefiniowane połączenia')}</span>
                <span className="text-slate-500">{t('{n} dostępnych', { n: connections.length })}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {connections.slice(0, 6).map((conn) => (
                  <button
                    key={conn.id}
                    onClick={() => onConnect(conn)}
                    className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-900/90 p-3 text-left transition-all hover:border-cyan-500/40 hover:bg-slate-800/80 group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          conn.protocol === 'ssh'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-blue-500/10 text-blue-400'
                        }`}
                      >
                        {conn.protocol === 'ssh' ? (
                          <Terminal className="h-4 w-4" />
                        ) : (
                          <Monitor className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-200 truncate">
                          {conn.name}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono truncate">
                          {conn.username}@{conn.host}:{conn.port}
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-600 opacity-0 group-hover:opacity-100 group-hover:text-cyan-400 transition-all shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              onClick={onNewConnection}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-600/25 transition-all hover:opacity-95"
            >
              <Plus className="h-4 w-4" />
              {t('Dodaj swoje pierwsze połączenie')}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Active sessions in grid / split layout
  const visiblePaneSessionIds: string[] =
    layout === 'single'
      ? (activeSessionId ? [activeSessionId] : (sessions[0] ? [sessions[0].sessionId] : []))
      : (paneSlots.length >= slotCount
          ? paneSlots.slice(0, slotCount)
          : [...paneSlots, ...sessions.map((s) => s.sessionId).filter((id) => !paneSlots.includes(id))].slice(0, slotCount));

  return (
    <div
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
      className="relative h-full w-full bg-slate-950 grid gap-1.5 p-1.5 overflow-hidden min-w-0 min-h-0"
      style={{
        gridTemplateColumns: gridTemplate.columns,
        gridTemplateRows: gridTemplate.rows,
      }}
    >
      {/* Interactive Split Screen Hover Overlays when dragging a tab in single layout */}
      {layout === 'single' && splitHoverZone === 'right' && (
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-cyan-950/85 border-2 border-dashed border-cyan-400 backdrop-blur-xs flex flex-col items-center justify-center z-50 pointer-events-none text-center p-6 shadow-2xl">
          <Columns2 className="h-10 w-10 text-cyan-400 mb-2 animate-bounce" />
          <span className="text-base font-bold text-white">{t('Upuść tutaj, aby podzielić pionowo (2 okna obok siebie)')}</span>
          <span className="text-xs text-cyan-300/80 mt-1">{t('Sesja zostanie otwarta w nowym oknie obok')}</span>
        </div>
      )}

      {layout === 'single' && splitHoverZone === 'bottom' && (
        <div className="absolute left-0 right-0 bottom-0 h-1/2 bg-cyan-950/85 border-2 border-dashed border-cyan-400 backdrop-blur-xs flex flex-col items-center justify-center z-50 pointer-events-none text-center p-6 shadow-2xl">
          <Rows2 className="h-10 w-10 text-cyan-400 mb-2 animate-bounce" />
          <span className="text-base font-bold text-white">{t('Upuść tutaj, aby podzielić poziomo (2 okna jedno pod drugim)')}</span>
          <span className="text-xs text-cyan-300/80 mt-1">{t('Sesja zostanie otwarta w nowym oknie na dole')}</span>
        </div>
      )}

      {/* 1. Empty Pane Placeholders (ONLY when in split view and slotCount > open visible sessions) */}
      {layout !== 'single' && Array.from({ length: slotCount }).map((_, paneIndex) => {
        const assignedSessionId = visiblePaneSessionIds[paneIndex];
        const hasSession = assignedSessionId && sessions.some((s) => s.sessionId === assignedSessionId);
        if (hasSession) return null;

        const isDragOver = dragOverPaneIndex === paneIndex;

        return (
          <div
            key={`empty-slot-${paneIndex}`}
            style={getPaneGridStyle(layout, paneIndex)}
            onDragOver={(e) => handleDragOver(e, paneIndex)}
            onDragLeave={(e) => handleDragLeave(e, paneIndex)}
            onDrop={(e) => handleDrop(e, paneIndex)}
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all bg-slate-900/30 overflow-hidden select-none min-w-0 min-h-0 ${
              isDragOver
                ? 'border-cyan-400 bg-cyan-950/40 shadow-xl shadow-cyan-950/50'
                : 'border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/80 border border-slate-700/60 text-slate-400 mb-3">
              <LayoutGrid className="h-6 w-6 text-cyan-400" />
            </div>
            <h4 className="text-sm font-semibold text-white">{t('Okno podziału #{n}', { n: paneIndex + 1 })}</h4>
            <p className="mt-1 text-xs text-slate-400 max-w-xs leading-relaxed">
              {t('Przeciągnij tutaj kartę sesji lub wybierz z dostępnych połączeń poniżej')}
            </p>

            {/* Quick picker from open sessions not currently visible */}
            {sessions.filter((s) => !visiblePaneSessionIds.includes(s.sessionId)).length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {sessions
                  .filter((s) => !visiblePaneSessionIds.includes(s.sessionId))
                  .map((s) => (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => onUpdatePaneSlot(paneIndex, s.sessionId)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1 text-xs text-slate-200 hover:border-cyan-500/50 hover:bg-slate-700 transition-all"
                    >
                      {s.protocol === 'ssh' ? (
                        <Terminal className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Monitor className="h-3 w-3 text-blue-400" />
                      )}
                      <span>{s.title}</span>
                    </button>
                  ))}
              </div>
            ) : (
              connections.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 max-w-sm">
                  {connections.slice(0, 4).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onConnect(c)}
                      className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-500/40 hover:text-white transition-colors"
                    >
                      <span>{t('Połącz: {name}', { name: c.name })}</span>
                    </button>
                  ))}
                </div>
              )
            )}

            {isDragOver && (
              <div className="absolute inset-0 bg-cyan-950/80 border-2 border-cyan-400 backdrop-blur-xs flex flex-col items-center justify-center z-50 pointer-events-none">
                <ArrowRightLeft className="h-8 w-8 text-cyan-400 mb-2 animate-bounce" />
                <span className="text-sm font-bold text-white">{t('Upuść tutaj, aby otworzyć w tym oknie')}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* 2. Persistent Session Windows (Mapped once to preserve DOM & avoid unmounting) */}
      {sessions.map((session) => {
        const paneIndex = visiblePaneSessionIds.indexOf(session.sessionId);
        const isVisible = paneIndex !== -1;
        const isPaneActive = session.sessionId === activeSessionId;
        const isDragOver = dragOverPaneIndex === paneIndex;

        // Hidden RDP sessions are NOT removed from layout (display:none). On Linux (WebKitGTK)
        // display:none dropped the canvas contents and changed the viewer size to 0, so every tab
        // switch showed a black screen for a few seconds. They stay laid out in the first grid cell
        // (same size as the visible pane in single layout), just invisible and non-interactive.
        const keepRdpRendered = !isVisible && session.protocol === 'rdp';
        const paneStyle: React.CSSProperties = isVisible
          ? { ...getPaneGridStyle(layout, paneIndex), zIndex: 1 }
          : keepRdpRendered
            ? { gridColumn: '1 / 2', gridRow: '1 / 2', visibility: 'hidden', pointerEvents: 'none', zIndex: 0 }
            : { display: 'none' };

        return (
          <div
            key={session.sessionId}
            aria-hidden={!isVisible}
            style={paneStyle}
            onClick={() => onSelectSession(session.sessionId)}
            onDragOver={(e) => handleDragOver(e, paneIndex)}
            onDragLeave={(e) => handleDragLeave(e, paneIndex)}
            onDrop={(e) => handleDrop(e, paneIndex)}
            className={`relative flex flex-col rounded-xl border overflow-hidden transition-colors bg-slate-950 min-w-0 min-h-0 ${
              isPaneActive
                ? 'border-cyan-500/60 shadow-xl shadow-cyan-950/40 ring-1 ring-cyan-500/40'
                : 'border-slate-800/90 hover:border-slate-700'
            }`}
          >
            {/* Split Pane Header (displayed when layout is not single) */}
            {layout !== 'single' && (
              <div
                draggable={true}
                onDragStart={(e) => handlePaneDragStart(e, session.sessionId)}
                title={t('Przeciągnij ten pasek na inne okno, aby zamienić miejscami lub przenieść sesję')}
                className={`flex h-8 items-center justify-between border-b px-2.5 text-xs select-none cursor-grab active:cursor-grabbing transition-colors shrink-0 z-20 ${
                  isPaneActive
                    ? 'bg-slate-900/95 border-cyan-500/30 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-900/70 hover:text-slate-200'
                }`}
              >
                {/* Drag Handle & Session Label */}
                <div className="flex items-center gap-2 min-w-0">
                  <GripVertical className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        session.status === 'connected'
                          ? 'bg-emerald-400'
                          : session.status === 'connecting'
                          ? 'bg-amber-400'
                          : session.status === 'disconnected'
                          ? 'bg-slate-500'
                          : 'bg-red-400'
                      }`}
                    />
                    <span className="font-semibold text-xs truncate max-w-[140px] text-slate-200">
                      {session.title}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      #{paneIndex + 1}
                    </span>
                  </div>
                </div>

                {/* Pane Controls */}
                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Session Switcher Dropdown */}
                  <SessionSwitcher compact sessions={sessions} connections={connections} groups={groups}
                    activeSessionId={session.sessionId}
                    onSelectSession={(id) => onUpdatePaneSlot(paneIndex, id)} />

                  {/* Reconnect / Reload */}
                  <button
                    type="button"
                    onClick={() => onReconnectSession(session.sessionId)}
                    title={t('Połącz ponownie (Reload)')}
                    className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                  </button>

                  {/* Maximize to Single Layout */}
                  <button
                    type="button"
                    onClick={() => {
                      onSelectSession(session.sessionId);
                      onChangeLayout('single');
                    }}
                    title={t('Rozwiń to okno na pełny ekran')}
                    className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
                  >
                    <Maximize2 className="h-3 w-3" />
                  </button>

                  {/* Close Session */}
                  <button
                    type="button"
                    onClick={(event) => onCloseSession(session.sessionId, anchorFromElement(event.currentTarget, 'below'))}
                    title={t('Zamknij to połączenie')}
                    className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Session Terminal / RDP Canvas Content */}
            <div className={`relative flex-1 w-full h-full overflow-hidden min-w-0 min-h-0 ${session.protocol === 'rdp' ? 'bg-rdp-bg' : ''}`}>
              {session.protocol === 'ssh' ? (
                <Suspense fallback={<ViewerLoading label={t('Ładowanie terminala...')} />}>
                  <SshTerminal session={session} isActive={isVisible} splitLayout={layout !== 'single'} />
                </Suspense>
              ) : (
                <Suspense fallback={<ViewerLoading label={t('Ładowanie silnika RDP...')} />}>
                  {embeddedFreeRdp === null ? (
                    <ViewerLoading label={t('Ładowanie silnika RDP...')} />
                  ) : embeddedFreeRdp ? (
                    <FreeRdpEmbedViewer session={session} isActive={isVisible} />
                  ) : (
                    <RdpViewer session={session} isActive={isVisible} />
                  )}
                </Suspense>
              )}
            </div>

            {/* Drag Hover Swap Overlay */}
            {isDragOver && (
              <div className="absolute inset-0 bg-cyan-950/80 border-2 border-dashed border-cyan-400 backdrop-blur-xs flex flex-col items-center justify-center z-50 pointer-events-none text-center p-4">
                <ArrowRightLeft className="h-8 w-8 text-cyan-400 mb-2 animate-bounce" />
                <span className="text-sm font-bold text-white">{t('Upuść tutaj, aby zamienić lub przenieść sesję')}</span>
                <span className="text-xs text-cyan-300/80 mt-1">{t('Pozycje okien zostaną zaktualizowane dynamicznie')}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
