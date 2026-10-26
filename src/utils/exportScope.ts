import { Connection, Group } from '../types';

export function expandExportGroups(groups: Group[], groupIds: readonly string[]): Set<string> {
  const included = new Set(groupIds);
  let previousSize = -1;
  while (previousSize !== included.size) {
    previousSize = included.size;
    for (const group of groups) if (group.parentId && included.has(group.parentId)) included.add(group.id);
  }
  return included;
}

/** The ancestors preserve folder paths; their own connections remain excluded. */
export function selectExportData(groups: Group[], connections: Connection[], groupIds: string[] | null, includeUngrouped: boolean) {
  if (groupIds === null) return { groups, connections };
  const byId = new Map(groups.map((group) => [group.id, group]));
  const included = expandExportGroups(groups, groupIds);
  const selected = connections.filter((connection) => connection.groupId && byId.has(connection.groupId)
    ? included.has(connection.groupId) : includeUngrouped);
  const folders = new Set(included);
  for (const id of included) {
    let parent = byId.get(id)?.parentId;
    while (parent && byId.has(parent) && !folders.has(parent)) {
      folders.add(parent);
      parent = byId.get(parent)?.parentId;
    }
  }
  return { groups: groups.filter((group) => folders.has(group.id)), connections: selected };
}
