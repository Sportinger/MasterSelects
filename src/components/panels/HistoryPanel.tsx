import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useHistoryStore } from '../../stores/historyStore';
import type { HistoryListEntry } from '../../types/history';
import './HistoryPanel.css';

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const chunkTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const HISTORY_CHUNK_MS = 10 * 60 * 1000;
const ROW_HEIGHT = 34;
const GROUP_HEADER_HEIGHT = 26;
const MAX_BRANCH_LANES = 6;
const RAIL_WIDTH_RATIO = 0.28;

interface GraphGeometry { railPadding: number; laneGap: number; }
interface HistoryNode { id: string; parentId: string | null; snapshot: { label: string; timestamp: number }; }
interface HistoryGraphEntry extends HistoryListEntry { lane: number; walked: boolean; }
interface HistoryGraphRow { id: string; timestamp: number; entry: HistoryGraphEntry; centerY: number; }
interface HistoryEntryGroup { id: string; title: string; rows: HistoryGraphRow[]; }
interface HistoryGraphLine { id: string; d: string; walked: boolean; main: boolean; }
interface HistoryGraphLines { height: number; railWidth: number; lines: HistoryGraphLine[]; }

const NARROW_GEOMETRY: GraphGeometry = { railPadding: 11, laneGap: 13 };

function clamp(min: number, value: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function laneX(lane: number, geometry: GraphGeometry): number { return geometry.railPadding + lane * geometry.laneGap; }
function getRowCenterY(rowIndex: number): number { return rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2; }

function createGeometry(panelWidth: number, maxLane: number): GraphGeometry {
  if (panelWidth <= 0) return NARROW_GEOMETRY;
  const railPadding = Math.round(clamp(10, panelWidth / 40, 15));
  const idealGap = clamp(12, panelWidth / 45, 19);
  if (maxLane <= 0) return { railPadding, laneGap: Math.round(idealGap) };
  const budget = Math.max(0, panelWidth * RAIL_WIDTH_RATIO - railPadding * 2);
  return { railPadding, laneGap: Math.round(Math.max(9, Math.min(idealGap, budget / maxLane))) };
}

function formatHistoryLabel(label: string): string { return label.trim() || 'History change'; }
function getDayKey(timestamp: number): string { const date = new Date(timestamp); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function formatDayLabel(timestamp: number): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (getDayKey(timestamp) === getDayKey(today.getTime())) return 'Today';
  if (getDayKey(timestamp) === getDayKey(yesterday.getTime())) return 'Yesterday';
  return dateFormatter.format(new Date(timestamp));
}
function formatChunkTitle(timestamp: number): string {
  const chunkStart = Math.floor(timestamp / HISTORY_CHUNK_MS) * HISTORY_CHUNK_MS;
  return `${formatDayLabel(timestamp)} · ${chunkTimeFormatter.format(new Date(chunkStart))}–${chunkTimeFormatter.format(new Date(chunkStart + HISTORY_CHUNK_MS - 1))}`;
}

/** Assign side lanes to leaf-to-trunk chains. Intersecting vertical ranges never
 * share a lane; overflow deliberately reuses the outermost lane. */
function createLaneMap(entries: HistoryListEntry[], nodes: Record<string, HistoryNode>): Map<string, number> {
  const laneZero = new Set(entries.filter((entry) => entry.onActivePath || entry.kind === 'redoable').map((entry) => entry.nodeId).filter(Boolean) as string[]);
  const children = new Map<string, string[]>();
  Object.values(nodes).forEach((node) => {
    if (!node.parentId) return;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  });
  const rowIndex = new Map(entries
    .filter((entry) => entry.nodeId)
    .toSorted((left, right) => right.timestamp - left.timestamp || Number(Boolean(right.onActivePath)) - Number(Boolean(left.onActivePath)) || left.id.localeCompare(right.id))
    .map((entry, index) => [entry.nodeId!, index]));
  const assigned = new Set<string>();
  const chains: Array<{ ids: string[]; start: number; end: number }> = [];
  Object.values(nodes).filter((node) => !laneZero.has(node.id) && !(children.get(node.id) ?? []).some((child) => !laneZero.has(child))).forEach((leaf) => {
    const ids: string[] = [];
    let cursor: string | null = leaf.id;
    while (cursor && !laneZero.has(cursor) && !assigned.has(cursor)) {
      ids.push(cursor);
      assigned.add(cursor);
      cursor = nodes[cursor]?.parentId ?? null;
    }
    const positions = ids.map((id) => rowIndex.get(id)).filter((index): index is number => index !== undefined);
    if (positions.length) chains.push({ ids, start: Math.min(...positions), end: Math.max(...positions) });
  });
  chains.sort((left, right) => left.start - right.start || left.end - right.end);
  const laneEnd: number[] = [];
  const lanes = new Map<string, number>();
  chains.forEach((chain) => {
    let lane = laneEnd.findIndex((end) => end < chain.start);
    if (lane === -1) lane = laneEnd.length < MAX_BRANCH_LANES ? laneEnd.length : MAX_BRANCH_LANES - 1;
    laneEnd[lane] = Math.max(laneEnd[lane] ?? -1, chain.end);
    chain.ids.forEach((id) => lanes.set(id, lane + 1));
  });
  return lanes;
}

function createGraphEntries(entries: HistoryListEntry[], nodes: Record<string, HistoryNode>): HistoryGraphEntry[] {
  const lanes = createLaneMap(entries, nodes);
  return entries.map((entry) => ({ ...entry, lane: entry.nodeId && (entry.onActivePath || entry.kind === 'redoable') ? 0 : lanes.get(entry.nodeId ?? '') ?? 0, walked: Boolean(entry.onActivePath) }));
}

function createGraphRows(entries: HistoryGraphEntry[]): HistoryGraphRow[] {
  return entries.map((entry) => ({ id: entry.id, timestamp: entry.timestamp, entry, centerY: 0 })).toSorted((left, right) =>
    right.timestamp - left.timestamp || Number(Boolean(right.entry.onActivePath)) - Number(Boolean(left.entry.onActivePath)) || left.id.localeCompare(right.id));
}

function createHistoryGroups(rows: HistoryGraphRow[]): HistoryEntryGroup[] {
  const groups = new Map<string, HistoryEntryGroup>();
  rows.forEach((row) => {
    const chunkStart = Math.floor(row.timestamp / HISTORY_CHUNK_MS) * HISTORY_CHUNK_MS;
    const id = `${getDayKey(row.timestamp)}:${chunkStart}`;
    const group = groups.get(id);
    if (group) group.rows.push(row);
    else groups.set(id, { id, title: formatChunkTitle(row.timestamp), rows: [row] });
  });
  let y = 0;
  return Array.from(groups.values()).map((group) => {
    y += GROUP_HEADER_HEIGHT;
    group.rows.forEach((row, index) => { row.centerY = y + getRowCenterY(index); });
    y += group.rows.length * ROW_HEIGHT;
    return group;
  });
}

function createGraphLines(groups: HistoryEntryGroup[], geometry: GraphGeometry): HistoryGraphLines {
  const rows = groups.flatMap((group) => group.rows);
  const byNodeId = new Map(rows.filter((row) => row.entry.nodeId).map((row) => [row.entry.nodeId!, row]));
  const maxLane = rows.reduce((max, row) => Math.max(max, row.entry.lane), 0);
  const lines = rows.flatMap((row) => {
    const { entry } = row;
    if (!entry.nodeId || !entry.parentNodeId) return [];
    const parent = byNodeId.get(entry.parentNodeId);
    if (!parent) return [];
    const parentX = laneX(parent.entry.lane, geometry);
    const childX = laneX(entry.lane, geometry);
    const deltaY = row.centerY - parent.centerY;
    const d = parent.entry.lane === entry.lane
      ? `M ${parentX} ${parent.centerY} L ${childX} ${row.centerY}`
      : `M ${parentX} ${parent.centerY} C ${parentX} ${parent.centerY + deltaY * 0.45} ${childX} ${row.centerY - deltaY * 0.45} ${childX} ${row.centerY}`;
    return [{ id: entry.nodeId, d, walked: Boolean(parent.entry.onActivePath && entry.onActivePath), main: parent.entry.lane === 0 && entry.lane === 0 }];
  });
  const height = Math.max(ROW_HEIGHT, groups.reduce((total, group) => total + GROUP_HEADER_HEIGHT + group.rows.length * ROW_HEIGHT, 0));
  return { height, railWidth: geometry.railPadding * 2 + maxLane * geometry.laneGap, lines };
}

function isJumpableEntry(entry: HistoryListEntry): boolean { return !entry.active && entry.kind !== 'event'; }
function entryClassName(entry: HistoryGraphEntry): string { return ['history-panel-entry', `history-panel-entry-${entry.kind}`, entry.eventType ? `history-panel-entry-${entry.eventType}` : '', entry.active ? 'history-panel-entry-active' : '', entry.highlighted ? 'history-panel-entry-highlighted' : ''].filter(Boolean).join(' '); }
function nodeClassName(entry: HistoryGraphEntry): string { return ['history-panel-node-dot', `history-panel-node-${entry.kind}`, entry.eventType ? `history-panel-node-${entry.eventType}` : '', entry.walked ? 'history-panel-node-walked' : '', entry.active ? 'history-panel-node-active' : ''].filter(Boolean).join(' '); }
function formatEntryMeta(entry: HistoryGraphEntry): string { return entry.kind === 'event' && entry.eventType !== 'manual-save' ? 'Event' : ''; }
function formatEntryBadge(entry: HistoryGraphEntry): { text: string; hint: boolean } | null {
  if (entry.active) return { text: 'Current', hint: false };
  if (entry.eventType === 'manual-save') return { text: 'Save', hint: false };
  if (entry.kind === 'undoable') return { text: 'Undo', hint: true };
  if (entry.kind === 'redoable') return { text: 'Redo', hint: true };
  if (entry.kind === 'branch') return { text: 'Jump', hint: true };
  return null;
}

function UndoIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>; }
function RedoIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>; }

export function HistoryPanel() {
  const historyState = useHistoryStore(useShallow((state) => ({ nodes: state.nodes, activeNodeId: state.activeNodeId, eventLog: state.eventLog })));
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const canUndo = useHistoryStore((state) => state.canUndo);
  const canRedo = useHistoryStore((state) => state.canRedo);
  const restoreEntry = useHistoryStore((state) => state.restoreEntry);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(0);

  useEffect(() => {
    const element = panelRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((observed) => { const width = observed[0]?.contentRect.width ?? 0; setPanelWidth((previous) => Math.abs(previous - width) < 20 ? previous : width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleListKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const targets = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-history-entry]') ?? []);
    if (!targets.length) return;
    const activeIndex = targets.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1 : activeIndex === -1 ? 0 : activeIndex + (event.key === 'ArrowDown' ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= targets.length) return;
    event.preventDefault(); targets[nextIndex]?.focus(); targets[nextIndex]?.scrollIntoView({ block: 'nearest' });
  }, []);

  const entries = useMemo(() => useHistoryStore.getState().getHistoryEntries(), [historyState.nodes, historyState.activeNodeId, historyState.eventLog]);
  const graphEntries = useMemo(() => createGraphEntries(entries, historyState.nodes), [entries, historyState.nodes]);
  const graphRows = useMemo(() => createGraphRows(graphEntries), [graphEntries]);
  const groups = useMemo(() => createHistoryGroups(graphRows), [graphRows]);
  const maxLane = useMemo(() => graphEntries.reduce((max, entry) => Math.max(max, entry.lane), 0), [graphEntries]);
  const geometry = useMemo(() => createGeometry(panelWidth, maxLane), [panelWidth, maxLane]);
  const graphLines = useMemo(() => createGraphLines(groups, geometry), [groups, geometry]);
  const counts = useMemo(() => {
    const children = new Map<string, number>();
    Object.values(historyState.nodes).forEach((node) => { if (node.parentId) children.set(node.parentId, (children.get(node.parentId) ?? 0) + 1); });
    return { undoable: entries.filter((entry) => entry.kind === 'undoable').length, redoable: entries.filter((entry) => entry.kind === 'redoable').length, saves: entries.filter((entry) => entry.eventType === 'manual-save').length, branches: entries.filter((entry) => entry.kind === 'branch' && entry.nodeId && !children.has(entry.nodeId)).length };
  }, [entries, historyState.nodes]);
  const summaryText = [`${counts.undoable} undo`, `${counts.redoable} redo`, `${counts.saves} saves`, counts.branches ? `${counts.branches} branches` : ''].filter(Boolean).join(' · ');
  const graphStyle = { '--history-row-height': `${ROW_HEIGHT}px`, '--history-rail-width': `${graphLines.railWidth}px`, '--history-graph-height': `${graphLines.height}px`, minHeight: graphLines.height } as CSSProperties;

  return <div className="history-panel" ref={panelRef}>
    <div className="history-panel-toolbar"><div className="history-panel-heading"><h2>History</h2><span title={summaryText}>{summaryText}</span></div><div className="history-panel-actions"><button type="button" onClick={() => undo()} disabled={!canUndo()} title={canUndo() ? 'Undo last change' : 'Nothing to undo'}><UndoIcon /><span>Undo</span></button><button type="button" onClick={() => redo()} disabled={!canRedo()} title={canRedo() ? 'Redo next change' : 'Nothing to redo'}><RedoIcon /><span>Redo</span></button></div></div>
    {graphRows.length === 0 ? <div className="history-panel-empty"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg><strong>No history yet</strong><span>Edits you make show up here as a timeline you can jump back to.</span></div> : <div className="history-panel-list" ref={listRef} onKeyDown={handleListKeyDown}><div className="history-panel-timeline" style={graphStyle}>
      <svg className="history-panel-graph-lines" viewBox={`0 0 ${graphLines.railWidth} ${graphLines.height}`} preserveAspectRatio="none" aria-hidden="true">{graphLines.lines.map((line) => <path key={line.id} className={`history-panel-graph-line ${line.walked ? 'history-panel-graph-line-walked' : line.main ? 'history-panel-graph-line-main' : 'history-panel-graph-line-branch'}`} d={line.d} />)}</svg>
      {groups.map((group) => <section key={group.id} className="history-panel-group" style={{ containIntrinsicSize: `auto ${GROUP_HEADER_HEIGHT + group.rows.length * ROW_HEIGHT}px` }}><div className="history-panel-group-header"><span className="history-panel-group-title">{group.title}</span><span className="history-panel-group-count">{group.rows.length}</span></div><ol className="history-panel-graph">{group.rows.map((row) => { const entry = row.entry; const jumpable = isJumpableEntry(entry); const label = formatHistoryLabel(entry.label); const meta = formatEntryMeta(entry); const badge = formatEntryBadge(entry); const clock = timeFormatter.format(new Date(row.timestamp)); return <li key={row.id} className="history-panel-graph-row"><span className="history-panel-row-time">{clock}</span><span className="history-panel-node"><span className={nodeClassName(entry)} style={{ left: laneX(entry.lane, geometry) }} aria-hidden="true" /></span><div className={entryClassName(entry)} title={`${label} · ${clock}${meta ? ` · ${meta}` : ''}`} data-history-entry={jumpable ? '' : undefined} role={jumpable ? 'button' : undefined} tabIndex={jumpable ? 0 : undefined} onClick={jumpable ? () => restoreEntry(entry) : undefined} onKeyDown={jumpable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); restoreEntry(entry); } } : undefined}><span className="history-panel-entry-main"><span className="history-panel-entry-label">{label}</span><span className="history-panel-entry-meta"><span className="history-panel-entry-clock">{clock}</span>{meta && <span className="history-panel-entry-detail">{meta}</span>}</span></span>{badge && <span className={`history-panel-entry-badge${badge.hint ? ' history-panel-entry-badge-hint' : ''}`}>{badge.text}</span>}</div></li>; })}</ol></section>)}
    </div></div>}
  </div>;
}
