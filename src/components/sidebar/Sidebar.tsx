import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Terminal,
  Monitor,
  Play,
  Edit2,
  Trash2,
  Plus,
  ArrowRightLeft,
  ChevronRight,
  ChevronDown,
  Layers,
  Search,
  X,
  Copy,
  KeyRound,
  User,
} from 'lucide-react';
import { api } from '../../services/api';
import { anchorFromElement, DialogAnchor } from '../dialogs/ConfirmDialog';
import { Connection, Group } from '../../types';

interface Props {
  groups: Group[];
  connections: Connection[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onConnect: (connection: Connection, allowDuplicate?: boolean) => void;
  onConnectAllInGroup: (group: Group, conns: Connection[]) => void;
  onEditConnection: (connection: Connection) => void;
  onDeleteConnection: (connectionId: string, anchor?: DialogAnchor | null) => void;
  onEditGroup: (group: Group) => void;
  onDeleteGroup: (groupId: string, anchor?: DialogAnchor | null) => void;
  onAddConnectionToGroup: (groupId: string | null) => void;
  onAddSubgroup: (parentId: string) => void;
  onMoveConnection: (connectionId: string, targetGroupId: string | null) => void;
  onNewConnection?: () => void;
  onNewGroup?: () => void;
}

export const Sidebar: React.FC<Props> = ({
  groups,
  connections,
  searchQuery,
  onSearchChange,
  onConnect,
  onConnectAllInGroup,
  onEditConnection,
  onDeleteConnection,
  onEditGroup,
  onDeleteGroup,
  onAddConnectionToGroup,
  onAddSubgroup,
  onMoveConnection,
  onNewConnection,
  onNewGroup,
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null | 'root'>(null);
  const [draggingConnectionId, setDraggingConnectionId] = useState<string | null>(null);

  // Resizable sidebar width with localStorage persistence
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('remoteflow-sidebar-width');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 180 && parsed <= 700) {
        return parsed;
      }
    }
    return 280;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(650, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem('remoteflow-sidebar-width', sidebarWidth.toString());
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, sidebarWidth]);

  // While searching, groups start expanded but can still be collapsed independently of the
  // normal (non-search) collapse state, which is restored when the search is cleared.
  const [searchCollapsedGroups, setSearchCollapsedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setSearchCollapsedGroups({});
  }, [searchQuery]);

  const toggleGroupCollapse = (groupId: string) => {
    const setter = searchQuery.trim() ? setSearchCollapsedGroups : setCollapsedGroups;
    setter((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const query = searchQuery.trim().toLowerCase();
  const isSearching = query.length > 0;

  // Groups whose own name (or an ancestor's name) matches the query: all their connections are shown.
  const matchedGroupIds = new Set<string>();
  if (isSearching) {
    const addWithDescendants = (groupId: string) => {
      if (matchedGroupIds.has(groupId)) return; // also guards against parent cycles
      matchedGroupIds.add(groupId);
      groups.filter((g) => g.parentId === groupId).forEach((g) => addWithDescendants(g.id));
    };
    groups.filter((g) => g.name.toLowerCase().includes(query)).forEach((g) => addWithDescendants(g.id));
  }

  const filteredConnections = connections.filter((c) => {
    if (!isSearching) return true;
    return (
      c.name.toLowerCase().includes(query) ||
      c.host.toLowerCase().includes(query) ||
      c.username.toLowerCase().includes(query) ||
      c.protocol.toLowerCase().includes(query) ||
      c.tags.some((t) => t.toLowerCase().includes(query)) ||
      (!!c.groupId && matchedGroupIds.has(c.groupId))
    );
  });

  const getChildGroupsAll = (parentId: string) => {
    return groups.filter((g) => g.parentId === parentId);
  };

  // Number of matching connections in a group and all its subgroups (memoised per render)
  const groupResultCount = new Map<string, number>();
  const countGroupResults = (groupId: string, visiting: Set<string> = new Set()): number => {
    const cached = groupResultCount.get(groupId);
    if (cached !== undefined) return cached;
    if (visiting.has(groupId)) return 0;
    visiting.add(groupId);
    const direct = filteredConnections.filter((c) => c.groupId === groupId).length;
    const nested = getChildGroupsAll(groupId).reduce((sum, g) => sum + countGroupResults(g.id, visiting), 0);
    groupResultCount.set(groupId, direct + nested);
    return direct + nested;
  };

  // While searching, groups without any matching connection (incl. subgroups) are hidden,
  // unless the group name itself matches the query.
  const isGroupVisible = (groupId: string) =>
    !isSearching || matchedGroupIds.has(groupId) || countGroupResults(groupId) > 0;

  const getChildGroups = (parentId: string) => {
    return getChildGroupsAll(parentId).filter((g) => isGroupVisible(g.id));
  };

  const getRootGroups = () => {
    return groups.filter(
      (g) => (!g.parentId || !groups.some((p) => p.id === g.parentId)) && isGroupVisible(g.id)
    );
  };

  // Recursively collect all connections in a group and its descendants (Założenie 3)
  const getAllGroupConnectionsRecursive = (groupId: string): Connection[] => {
    const direct = filteredConnections.filter((c) => c.groupId === groupId);
    const children = getChildGroups(groupId);
    const childConns = children.flatMap((child) => getAllGroupConnectionsRecursive(child.id));
    return [...direct, ...childConns];
  };

  const uncategorizedConnections = filteredConnections.filter(
    (c) => !c.groupId || !groups.some((g) => g.id === c.groupId)
  );

  // Tree layout: every row spans the full sidebar width (headers and counters line up on the
  // right edge); nesting is shown only by indentation and thin guide lines, not by boxes inside
  // boxes, so deeply nested groups stay readable.
  const TREE_INDENT = 12;
  const rowPadding = (depth: number) => 4 + depth * TREE_INDENT;

  const renderConnectionRow = (conn: Connection, depth: number) => (
    <div key={conn.id} style={{ paddingLeft: rowPadding(depth) }} className="pr-0.5">
      <ConnectionItem
        connection={conn}
        isDragging={draggingConnectionId === conn.id}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', conn.id);
          e.dataTransfer.effectAllowed = 'move';
          setDraggingConnectionId(conn.id);
        }}
        onDragEnd={() => {
          setDraggingConnectionId(null);
          setDragOverGroupId(null);
        }}
        onConnect={onConnect}
        onEdit={onEditConnection}
        onDelete={onDeleteConnection}
      />
    </div>
  );

  const renderGroupNode = (group: Group, depth: number = 0) => {
    const directConns = filteredConnections.filter((c) => c.groupId === group.id);
    const childGroups = getChildGroups(group.id);
    const allGroupConns = getAllGroupConnectionsRecursive(group.id);
    const isCollapsed = isSearching ? !!searchCollapsedGroups[group.id] : !!collapsedGroups[group.id];
    const isDragOver = dragOverGroupId === group.id;
    const groupColor = group.color || '#38bdf8';

    return (
      <div
        key={group.id}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          setDragOverGroupId(group.id);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          if (dragOverGroupId === group.id) setDragOverGroupId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const connId = e.dataTransfer.getData('text/plain') || draggingConnectionId;
          if (connId) {
            onMoveConnection(connId, group.id);
          }
          setDragOverGroupId(null);
          setDraggingConnectionId(null);
        }}
        className={`transition-colors ${
          isDragOver ? 'outline-2 outline-dashed outline-cyan-400 -outline-offset-2 bg-cyan-950/30' : ''
        } ${depth === 0 ? 'mb-1' : ''}`}
      >
        {/* Group header – full width, counter aligned to the right edge */}
        <div
          style={{ paddingLeft: rowPadding(depth) }}
          title={`Folder: ${group.name} (${allGroupConns.length} połączeń)`}
          onClick={() => toggleGroupCollapse(group.id)}
          className={`group relative flex items-center gap-1 pr-1.5 h-6 cursor-pointer select-none transition-colors ${
            depth === 0
              ? 'bg-[#16223a] hover:bg-[#1d2d4a] border-y border-slate-800/80'
              : 'hover:bg-[#16223a]'
          }`}
        >
          <span className="w-3 shrink-0 text-slate-500 group-hover:text-cyan-400 transition-colors">
            {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
          {isCollapsed ? (
            <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: groupColor }} />
          ) : (
            <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: groupColor }} />
          )}
          <span
            className={`min-w-0 flex-1 truncate text-[11px] leading-tight ${
              depth === 0 ? 'font-semibold text-slate-100' : 'font-medium text-slate-300'
            }`}
          >
            {group.name}
          </span>
          <span className="ml-1 shrink-0 font-mono text-[9px] text-slate-500 group-hover:opacity-0 transition-opacity">
            {allGroupConns.length}
          </span>

          {/* Actions appear over the counter on hover */}
          <div
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded bg-[#1d2d4a] pl-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onConnectAllInGroup(group, allGroupConns)}
              title={`Połącz ze wszystkimi w '${group.name}' (${allGroupConns.length})`}
              disabled={allGroupConns.length === 0}
              className="flex h-4.5 w-4.5 items-center justify-center rounded text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-30"
            >
              <Play className="h-2.5 w-2.5 fill-current" />
            </button>
            <button
              onClick={() => onAddConnectionToGroup(group.id)}
              title="Dodaj połączenie do tego folderu"
              className="flex h-4.5 w-4.5 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              onClick={() => onAddSubgroup(group.id)}
              title="Dodaj podfolder (zagnieżdżona grupa)"
              className="flex h-4.5 w-4.5 items-center justify-center rounded text-amber-400/80 hover:bg-amber-500/20 hover:text-amber-300"
            >
              <FolderPlus className="h-3 w-3" />
            </button>
            <button
              onClick={() => onEditGroup(group)}
              title="Edytuj folder"
              className="flex h-4.5 w-4.5 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
            >
              <Edit2 className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={(e) => onDeleteGroup(group.id, anchorFromElement(e.currentTarget))}
              title="Usuń folder"
              className="flex h-4.5 w-4.5 items-center justify-center rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Children: subgroups first, then connections – with a guide line in the group colour */}
        {!isCollapsed && (
          <div className="relative py-0.5">
            <span
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-1 w-px opacity-40"
              style={{ left: rowPadding(depth) + 5, backgroundColor: groupColor }}
            />
            {childGroups.map((child) => renderGroupNode(child, depth + 1))}
            {directConns.map((conn) => renderConnectionRow(conn, depth + 1))}
            {directConns.length === 0 && childGroups.length === 0 && (
              <div
                style={{ marginLeft: rowPadding(depth + 1) }}
                className="my-0.5 mr-1 rounded border border-dashed border-slate-800 py-1 px-2 text-[10px] italic text-slate-500"
              >
                Pusty folder – przeciągnij tutaj połączenie
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      style={{ width: `${sidebarWidth}px` }}
      className="relative flex h-full shrink-0 flex-col border-r border-slate-800/90 bg-[#0c1222] select-none overflow-hidden"
    >
      {/* Search Bar directly above Connection Tree */}
      <div className="p-2.5 border-b border-slate-800/80 bg-[#090e1c]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Szukaj (host, nazwa, IP, tagi)..."
            className="w-full rounded-md border border-slate-800 bg-[#121c2e] py-1.5 pl-8 pr-7 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              title="Wyczyść wyszukiwanie"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Sidebar Header / Quick Action with Nowy Folder & Nowe Połączenie */}
      <div className="border-b border-slate-800/80 bg-[#0e162a]/95 px-2.5 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px] font-bold text-slate-300 min-w-0">
            <Layers className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">Struktura Połączeń</span>
          </span>
          <span className="text-[10px] text-cyan-300/90 font-mono bg-cyan-950/70 border border-cyan-800/50 px-1.5 py-0.2 rounded-full font-medium shrink-0">
            {filteredConnections.length} hostów
          </span>
        </div>

        {/* Action Buttons: Nowy Folder and Nowe Połączenie */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => (onNewGroup ? onNewGroup() : onAddSubgroup(''))}
            title="Utwórz nowy folder / grupę połączeń"
            className="flex-1 flex items-center justify-center gap-1 rounded-sm border border-slate-700/80 bg-slate-800/80 hover:bg-slate-700 hover:text-white px-2 py-1 text-[11px] font-medium text-slate-200 transition-colors shadow-2xs cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="truncate">Nowy Folder</span>
          </button>

          <button
            onClick={() => (onNewConnection ? onNewConnection() : onAddConnectionToGroup(null))}
            title="Dodaj nowe połączenie (SSH, SFTP, RDP)"
            className="flex-1 flex items-center justify-center gap-1 rounded-sm bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 px-2 py-1 text-[11px] font-semibold text-white transition-all shadow-xs shadow-cyan-600/20 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Nowe Połączenie</span>
          </button>
        </div>
      </div>

      {/* Tree View Scroll Area */}
      {/* mr-2: keeps the scrollbar clear of the width-resize handle on the right edge, which used to
          sit exactly on top of it (grabbing the scrollbar resized the sidebar instead of scrolling). */}
      <div className="sidebar-scroll flex-1 overflow-y-auto py-1.5 pl-1 pr-0.5 mr-2">
        {/* Render hierarchical groups */}
        {getRootGroups().map((group) => renderGroupNode(group, 0))}

        {/* Uncategorized Connections (Drop target for moving to root) – hidden when a search has no results here */}
        {(!isSearching || uncategorizedConnections.length > 0) && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOverGroupId('root');
          }}
          onDragLeave={() => {
            if (dragOverGroupId === 'root') setDragOverGroupId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const connId = e.dataTransfer.getData('text/plain') || draggingConnectionId;
            if (connId) {
              onMoveConnection(connId, null);
            }
            setDragOverGroupId(null);
            setDraggingConnectionId(null);
          }}
          className={`rounded-none transition-all p-2 mb-2 ${
            dragOverGroupId === 'root'
              ? 'border-2 border-dashed border-cyan-400 bg-cyan-950/40 shadow-lg shadow-cyan-500/20'
              : 'bg-[#111929] border border-slate-800/80'
          }`}
        >
          <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800/80 mb-1.5">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3 w-3 text-slate-500" />
              Połączenia bez folderu
            </span>
            <span className="font-mono text-[9px] text-slate-400 bg-slate-900 px-1.5 py-0.2 rounded-full border border-slate-700/60 font-medium">
              {uncategorizedConnections.length}
            </span>
          </div>

          <div className="space-y-1 mt-1">
            {uncategorizedConnections.length === 0 ? (
              <div className="py-2 px-2 text-[10px] text-slate-500 italic text-center rounded-none bg-slate-950/40 border border-dashed border-slate-800">
                Przeciągnij tutaj, aby przenieść do poziomu głównego
              </div>
            ) : (
              uncategorizedConnections.map((conn) => (
                <ConnectionItem
                  key={conn.id}
                  connection={conn}
                  isDragging={draggingConnectionId === conn.id}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', conn.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingConnectionId(conn.id);
                  }}
                  onDragEnd={() => {
                    setDraggingConnectionId(null);
                    setDragOverGroupId(null);
                  }}
                  onConnect={onConnect}
                  onEdit={onEditConnection}
                  onDelete={onDeleteConnection}
                />
              ))
            )}
          </div>
        </div>
        )}

        {filteredConnections.length === 0 && (!isSearching || matchedGroupIds.size === 0) && (
          <div className="p-6 text-center text-xs text-slate-500">
            {searchQuery ? 'Brak wyników wyszukiwania' : 'Brak zdefiniowanych połączeń'}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="border-t border-slate-800/80 bg-[#080d1a] p-2 text-center text-[10px] text-slate-500">
        Przeciągaj myszką, aby przenieść • Dwuklik: połącz
      </div>

      {/* Resizer Handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
        title="Przeciągnij, aby zmienić szerokość paska połączeń"
        className={`absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize z-30 transition-colors ${
          isResizing
            ? 'bg-cyan-500 shadow-md shadow-cyan-500/50'
            : 'bg-transparent hover:bg-cyan-500/50 active:bg-cyan-400'
        }`}
      />
    </aside>
  );
};

interface ConnectionItemProps {
  connection: Connection;
  isDragging?: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onConnect: (connection: Connection, allowDuplicate?: boolean) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (id: string, anchor?: DialogAnchor | null) => void;
}

const ConnectionItem: React.FC<ConnectionItemProps> = ({
  connection,
  isDragging,
  onDragStart,
  onDragEnd,
  onConnect,
  onEdit,
  onDelete,
}) => {
  const isSSH = connection.protocol === 'ssh';
  const activeTunnelsCount = connection.portForwarding.filter((p) => p.enabled).length;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  return (
    <>
      <div
        draggable={true}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDoubleClick={() => onConnect(connection)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({
            x: Math.min(e.clientX, window.innerWidth - 220),
            y: e.clientY + 5,
          });
        }}
        className={`group relative flex items-center justify-between rounded-md px-1.5 py-[3px] transition-colors cursor-grab active:cursor-grabbing border ${
          isDragging
            ? 'opacity-40 border-cyan-500 bg-cyan-950/40'
            : 'border-transparent hover:border-slate-700/80 hover:bg-[#16223a]'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
              isSSH
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
            }`}
          >
            {isSSH ? <Terminal className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[11px] font-medium leading-tight text-slate-100 group-hover:text-cyan-300 transition-colors">
                {connection.name}
              </span>
              {activeTunnelsCount > 0 && (
                <span
                  title={`${activeTunnelsCount} aktywnych przekierowań portów`}
                  className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.2 text-[9px] font-mono text-amber-400 border border-amber-500/20"
                >
                  <ArrowRightLeft className="h-2.5 w-2.5" />
                  {activeTunnelsCount}
                </span>
              )}
            </div>
            <div className="truncate text-[9.5px] leading-tight text-slate-500 font-mono">
              {connection.username}@{connection.host}:{connection.port}
            </div>
          </div>
        </div>

        {/* Action buttons – overlay on hover, so they do not take width from the name */}
        <div
          className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded bg-[#16223a] pl-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Direct Connect */}
          <button
            onClick={() => onConnect(connection, false)}
            title="Połącz natychmiast"
            className="flex h-5 w-5 items-center justify-center rounded text-cyan-400 hover:bg-cyan-500/20"
          >
            <Play className="h-2.5 w-2.5 fill-current" />
          </button>

          {/* Open in new tab (Duplicate) */}
          <button
            onClick={() => onConnect(connection, true)}
            title="Otwórz w nowej karcie (duplikat sesji)"
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-cyan-400"
          >
            <Copy className="h-2.5 w-2.5" />
          </button>

          {/* Edit */}
          <button
            onClick={() => onEdit(connection)}
            title="Edytuj połączenie"
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <Edit2 className="h-2.5 w-2.5" />
          </button>

          {/* Delete */}
          <button
            onClick={(e) => onDelete(connection.id, anchorFromElement(e.currentTarget))}
            title="Usuń połączenie"
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-red-500/20 hover:text-red-400"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>

      {/* Connection Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 w-56 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-2xl backdrop-blur-md"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-800">
            {connection.name}
          </div>
          <div className="py-1 space-y-0.5 text-xs text-slate-200">
            <button
              onClick={() => {
                onConnect(connection, false);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-cyan-600 hover:text-white transition-colors"
            >
              <Play className="h-3.5 w-3.5 text-cyan-400 group-hover:text-white fill-current" />
              <span>Połącz</span>
            </button>

            <button
              onClick={() => {
                onConnect(connection, true);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <Copy className="h-3.5 w-3.5 text-cyan-400" />
              <span>Otwórz w nowej karcie</span>
            </button>

            <div className="my-1 border-t border-slate-800" />

            {/* Copy Password */}
            <button
              onClick={async () => {
                setContextMenu(null);
                try {
                  const pwd = await api.revealPassword(connection.id);
                  if (pwd) {
                    await api.clipboardWriteText(pwd);
                  }
                } catch (e) {
                  console.warn('Error copying password:', e);
                }
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
            >
              <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
              <span>Kopiuj hasło do schowka</span>
            </button>

            {/* Copy Username */}
            {connection.username && (
              <button
                onClick={async () => {
                  setContextMenu(null);
                  try {
                    await api.clipboardWriteText(connection.username);
                  } catch (e) {
                    console.warn('Error copying username:', e);
                  }
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-cyan-400 transition-colors"
              >
                <User className="h-3.5 w-3.5 text-slate-400" />
                <span>Kopiuj login ({connection.username})</span>
              </button>
            )}

            <div className="my-1 border-t border-slate-800" />

            <button
              onClick={() => {
                onEdit(connection);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <Edit2 className="h-3.5 w-3.5 text-slate-400" />
              <span>Edytuj konfigurację</span>
            </button>

            <button
              onClick={(e) => {
                onDelete(connection.id, anchorFromElement(e.currentTarget));
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-red-500/20 hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
              <span>Usuń połączenie</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};
