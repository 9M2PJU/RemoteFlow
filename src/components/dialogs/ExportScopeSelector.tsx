import { useEffect, useMemo } from 'react';
import { Connection, Group } from '../../types';
import { tn, useT } from '../../i18n';
import { expandExportGroups, selectExportData } from '../../utils/exportScope';

export interface ExportScope {
  groupIds: string[] | null;
  includeUngrouped: boolean;
}

interface Props {
  groups: Group[];
  connections: Connection[];
  value: ExportScope;
  onChange: (scope: ExportScope) => void;
  disabled: boolean;
}

export function ExportScopeSelector({ groups, connections, value, onChange, disabled }: Props) {
  const t = useT();
  const byId = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const selectedIds = useMemo(() => new Set(value.groupIds ?? []), [value.groupIds]);
  const included = useMemo(() => expandExportGroups(groups, value.groupIds ?? []), [groups, value.groupIds]);
  const preview = useMemo(() => selectExportData(groups, connections, value.groupIds, value.includeUngrouped), [groups, connections, value]);
  const rootCount = connections.filter((connection) => !connection.groupId || !byId.has(connection.groupId)).length;
  const options = useMemo(() => groups.map((group) => {
    const path: string[] = [];
    const visited = new Set<string>();
    let current: Group | undefined = group;
    while (current && !visited.has(current.id)) {
      visited.add(current.id); path.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const descendants = expandExportGroups(groups, [group.id]);
    return { id: group.id, path: path.join(' / '), count: connections.filter((connection) => connection.groupId && descendants.has(connection.groupId)).length };
  }).sort((a, b) => a.path.localeCompare(b.path)), [groups, byId, connections]);

  useEffect(() => {
    if (value.groupIds === null) return;
    const valid = value.groupIds.filter((id) => byId.has(id));
    if (valid.length !== value.groupIds.length) onChange({ ...value, groupIds: valid });
  }, [byId, value, onChange]);

  const inherited = (id: string) => {
    const visited = new Set([id]);
    let parent = byId.get(id)?.parentId;
    while (parent && !visited.has(parent)) {
      if (selectedIds.has(parent)) return true;
      visited.add(parent); parent = byId.get(parent)?.parentId;
    }
    return false;
  };

  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
    <legend className="px-1 text-xs font-bold uppercase tracking-wider text-white">{t('Zakres eksportu')}</legend>
    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
      <input type="radio" name="export-scope" checked={value.groupIds === null}
        onChange={() => onChange({ groupIds: null, includeUngrouped: false })} />
      {t('Wszystkie połączenia')}
    </label>
    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
      <input type="radio" name="export-scope" checked={value.groupIds !== null}
        onChange={() => onChange({ groupIds: [], includeUngrouped: false })} />
      {t('Wybrane grupy połączeń')}
    </label>
    {value.groupIds === null ? <p className="text-[11px] text-slate-400">
      {t('Pełny eksport obejmuje również połączenia bez grupy i wszystkie profile poświadczeń.')}
    </p> : <>
      <p className="text-[11px] text-slate-400">{t('Wybrana grupa obejmuje podgrupy. Foldery nadrzędne zachowają strukturę, bez ich pozostałych połączeń.')}</p>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2">
        {options.length === 0 && <p className="p-2 text-xs text-slate-500">{t('Brak zdefiniowanych grup')}</p>}
        {options.map((group) => {
          const covered = inherited(group.id);
          return <label key={group.id} title={covered ? t('Uwzględniono z grupą nadrzędną') : group.path}
            className={`flex items-start gap-2 rounded px-2 py-1.5 text-xs ${covered ? 'text-slate-500' : 'cursor-pointer text-slate-200 hover:bg-slate-800'}`}>
            <input type="checkbox" checked={included.has(group.id)} disabled={covered}
              aria-label={t('Eksportuj grupę: {name}', { name: group.path })} className="mt-0.5 shrink-0"
              onChange={(event) => {
                const ids = new Set(value.groupIds ?? []);
                if (event.target.checked) ids.add(group.id); else ids.delete(group.id);
                onChange({ ...value, groupIds: [...ids] });
              }} />
            <span className="min-w-0 flex-1 break-words">{group.path}</span>
            <span className="shrink-0 text-slate-500">{tn(group.count, ['{n} połączenie', '{n} połączenia', '{n} połączeń'], { n: group.count })}</span>
          </label>;
        })}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
        <input type="checkbox" checked={value.includeUngrouped} onChange={(event) => onChange({ ...value, includeUngrouped: event.target.checked })} />
        {t('Połączenia bez grupy')} <span className="text-slate-500">({rootCount})</span>
      </label>
      <p className="text-[11px] text-slate-400">{t('Dołączane są tylko profile poświadczeń używane przez wybrane połączenia.')}</p>
    </>}
    <p role="status" className="text-xs font-medium text-cyan-300">
      {t('Do eksportu: {connections} połączeń, {groups} grup', { connections: preview.connections.length, groups: preview.groups.length })}
    </p>
  </fieldset>;
}
