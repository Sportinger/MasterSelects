import type { HistoryListEntry, HistoryTimelineEvent } from '../../types/history';
import type { HistoryNode } from './historyStoreTypes';

const childrenOf = (nodes: Record<string, HistoryNode>, parentId: string) =>
  Object.values(nodes).filter((node) => node.parentId === parentId);

export function getRedoChild(
  nodes: Record<string, HistoryNode>,
  nodeId: string,
  lastVisited: Record<string, string>
): HistoryNode | null {
  const preferred = lastVisited[nodeId];
  if (preferred && nodes[preferred]?.parentId === nodeId) return nodes[preferred];
  return childrenOf(nodes, nodeId).sort((a, b) => b.snapshot.timestamp - a.snapshot.timestamp)[0] ?? null;
}

export function createHistoryEntries(
  nodes: Record<string, HistoryNode>,
  activeNodeId: string | null,
  lastVisited: Record<string, string>,
  eventLog: HistoryTimelineEvent[]
): HistoryListEntry[] {
  const activePath = new Set<string>();
  const depths = new Map<string, number>();
  let cursor = activeNodeId ? nodes[activeNodeId] : undefined;
  while (cursor) {
    activePath.add(cursor.id);
    cursor = cursor.parentId ? nodes[cursor.parentId] : undefined;
  }
  const path = [...activePath].reverse();
  path.forEach((id, index) => depths.set(id, index));

  const redo = new Map<string, number>();
  cursor = activeNodeId ? getRedoChild(nodes, activeNodeId, lastVisited) ?? undefined : undefined;
  let distance = 0;
  while (cursor) {
    redo.set(cursor.id, distance++);
    cursor = getRedoChild(nodes, cursor.id, lastVisited) ?? undefined;
  }

  const entries: HistoryListEntry[] = Object.values(nodes).map((node) => {
    const active = node.id === activeNodeId;
    const onActivePath = activePath.has(node.id);
    const kind = active ? 'current' : onActivePath ? 'undoable' : redo.has(node.id) ? 'redoable' : 'branch';
    return {
      id: node.id,
      nodeId: node.id,
      parentNodeId: node.parentId,
      label: node.snapshot.label,
      timestamp: node.snapshot.timestamp,
      kind,
      onActivePath,
      ...(kind === 'undoable' ? { stackIndex: depths.get(node.id) } : {}),
      ...(kind === 'redoable' ? { stackIndex: redo.get(node.id) } : {}),
      ...(active ? { active: true } : {}),
    };
  });
  entries.push(...eventLog.filter((event) => event.type !== 'autosave').map((event) => ({
    id: event.id, kind: 'event' as const, label: event.label, timestamp: event.timestamp,
    eventType: event.type, highlighted: event.type === 'manual-save',
  })));
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}
