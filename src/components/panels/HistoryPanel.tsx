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
/** Must match --history-time-width in HistoryPanel.css. */
const TIME_COLUMN_WIDTH = 50;
/** Description block reserved on the right edge of every row. */
const ENTRY_COLUMN_WIDTH = 210;
/** List padding plus the entry's own margin, so the rail math ends where the
 *  description column actually starts. */
const LIST_CHROME_WIDTH = 24;
/** Widest a single lane step may get, so two lanes on a full-width tab do not
 *  end up half a screen apart. */
const MAX_LANE_GAP = 140;

interface GraphGeometry { railPadding: number; laneGap: number; railWidth: number; }
interface HistoryNode { id: string; parentId: string | null; snapshot: { label: string; timestamp: number }; }
interface HistoryGraphEntry extends HistoryListEntry { lane: number; walked: boolean; }
interface HistoryGraphRow { id: string; timestamp: number; entry: HistoryGraphEntry; centerY: number; }
interface HistoryEntryGroup { id: string; title: string; rows: HistoryGraphRow[]; }
interface HistoryGraphLine { id: string; d: string; walked: boolean; main: boolean; }
interface HistoryGraphLines { height: number; railWidth: number; lines: HistoryGraphLine[]; }

const NARROW_GEOMETRY: GraphGeometry = { railPadding: 11, laneGap: 13, railWidth: 63 };

function clamp(min: number, value: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function laneX(lane: number, geometry: GraphGeometry): number { return geometry.railPadding + lane * geometry.laneGap; }
function getRowCenterY(rowIndex: number): number { return rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2; }

function createGeometry(panelWidth: number, maxLane: number): GraphGeometry {
  if (panelWidth <= 0) return NARROW_GEOMETRY;
  const railPadding = Math.round(clamp(10, panelWidth / 40, 15));
  const available = panelWidth - TIME_COLUMN_WIDTH - ENTRY_COLUMN_WIDTH - LIST_CHROME_WIDTH - railPadding * 2;
  if (available >= 80) {
    // Wide panel: the rail owns the whole span between the time column and the
    // right-pinned description column; lanes spread evenly across it.
    const laneGap = Math.round(clamp(13, available / Math.max(maxLane, 1), MAX_LANE_GAP));
    return { railPadding, laneGap, railWidth: railPadding * 2 + available };
  }
  // Narrow dock: fall back to the tight gutter so labels keep their room.
  const idealGap = clamp(12, panelWidth / 45, 19);
  const budget = Math.max(0, panelWidth * RAIL_WIDTH_RATIO - railPadding * 2);
  const laneGap = Math.round(maxLane <= 0 ? idealGap : Math.max(9, Math.min(idealGap, budget / maxLane)));
  return { railPadding, laneGap, railWidth: railPadding * 2 + Math.max(maxLane, 0) * laneGap };
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
interface HistoryChain { id: string; nodeIds: string[]; firstNodeId: string; }

function compareEntries(left: HistoryListEntry, right: HistoryListEntry): number {
  return right.timestamp - left.timestamp || left.id.localeCompare(right.id);
}

/** Chain identity is deliberately tree-only: a parent's earliest child continues
 * its rail and every later child begins a new rail. */
function createChains(nodes: Record<string, HistoryNode>): { chains: HistoryChain[]; chainByNodeId: Map<string, string> } {
  const children = new Map<string, string[]>();
  Object.values(nodes).forEach((node) => {
    if (!node.parentId) return;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  });
  children.forEach((siblings) => siblings.sort((left, right) =>
    nodes[left].snapshot.timestamp - nodes[right].snapshot.timestamp || left.localeCompare(right)));

  const roots = Object.values(nodes).filter((node) => !node.parentId).sort((left, right) =>
    left.snapshot.timestamp - right.snapshot.timestamp || left.id.localeCompare(right.id));
  const chains: HistoryChain[] = [];
  const chainByNodeId = new Map<string, string>();
  const visit = (node: HistoryNode, chain: HistoryChain) => {
    chain.nodeIds.push(node.id);
    chainByNodeId.set(node.id, chain.id);
    (children.get(node.id) ?? []).forEach((childId, index) => {
      const child = nodes[childId];
      if (index === 0) visit(child, chain);
      else {
        const fork = { id: child.id, nodeIds: [], firstNodeId: child.id };
        chains.push(fork);
        visit(child, fork);
      }
    });
  };
  roots.forEach((root, index) => {
    const rootChain = { id: root.id, nodeIds: [], firstNodeId: root.id };
    if (index === 0) chains.unshift(rootChain);
    else chains.push(rootChain);
    visit(root, rootChain);
  });
  return { chains, chainByNodeId };
}

function createLaneMap(entries: HistoryListEntry[], nodes: Record<string, HistoryNode>): { lanes: Map<string, number>; branchCount: number } {
  const { chains, chainByNodeId } = createChains(nodes);
  const rowIndex = new Map(entries.filter((entry) => entry.nodeId).toSorted(compareEntries).map((entry, index) => [entry.nodeId!, index]));
  const lanes = new Map<string, number>();
  const rootChain = chains[0];
  rootChain?.nodeIds.forEach((id) => lanes.set(id, 0));
  const ranges = chains.slice(1).map((chain) => {
    const positions = chain.nodeIds.map((id) => rowIndex.get(id)).filter((index): index is number => index !== undefined);
    const parentId = nodes[chain.firstNodeId]?.parentId;
    const parentRow = parentId ? rowIndex.get(parentId) : undefined;
    if (parentRow !== undefined) positions.push(parentRow);
    return { chain, start: Math.min(...positions), end: Math.max(...positions), timestamp: nodes[chain.firstNodeId]?.snapshot.timestamp ?? 0 };
  }).filter((range) => Number.isFinite(range.start));
  const assignedByLane = new Map<number, Array<{ start: number; end: number }>>();
  ranges.sort((left, right) => left.timestamp - right.timestamp || left.chain.firstNodeId.localeCompare(right.chain.firstNodeId)).forEach((range) => {
    let lane = 1;
    while (lane < MAX_BRANCH_LANES && (assignedByLane.get(lane) ?? []).some((other) => other.start <= range.end && range.start <= other.end)) lane += 1;
    (assignedByLane.get(lane) ?? assignedByLane.set(lane, []).get(lane)!).push({ start: range.start, end: range.end });
    range.chain.nodeIds.forEach((id) => lanes.set(id, lane));
  });
  // A node's chain is known even when a persisted entry is temporarily absent.
  chainByNodeId.forEach((chainId, nodeId) => { if (!lanes.has(nodeId) && chainId === rootChain?.id) lanes.set(nodeId, 0); });
  return { lanes, branchCount: Math.max(0, chains.length - 1) };
}

function createWalkedNodeIds(activeNodeId: string | null, nodes: Record<string, HistoryNode>): Set<string> {
  const walked = new Set<string>();
  let cursor = activeNodeId;
  while (cursor && !walked.has(cursor)) { walked.add(cursor); cursor = nodes[cursor]?.parentId ?? null; }
  return walked;
}

function createGraphEntries(entries: HistoryListEntry[], nodes: Record<string, HistoryNode>, activeNodeId: string | null): HistoryGraphEntry[] {
  const { lanes } = createLaneMap(entries, nodes);
  const walked = createWalkedNodeIds(activeNodeId, nodes);
  return entries.map((entry) => ({ ...entry, lane: lanes.get(entry.nodeId ?? '') ?? 0, walked: Boolean(entry.nodeId && walked.has(entry.nodeId)) }));
}

function createGraphRows(entries: HistoryGraphEntry[]): HistoryGraphRow[] {
  return entries.map((entry) => ({ id: entry.id, timestamp: entry.timestamp, entry, centerY: 0 })).toSorted((left, right) => compareEntries(left.entry, right.entry));
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
    return [{ id: entry.nodeId, d, walked: parent.entry.walked && entry.walked, main: parent.entry.lane === entry.lane }];
  });
  const height = Math.max(ROW_HEIGHT, groups.reduce((total, group) => total + GROUP_HEADER_HEIGHT + group.rows.length * ROW_HEIGHT, 0));
  return { height, railWidth: geometry.railWidth, lines };
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
  const graphEntries = useMemo(() => createGraphEntries(entries, historyState.nodes, historyState.activeNodeId), [entries, historyState.nodes, historyState.activeNodeId]);
  const graphRows = useMemo(() => createGraphRows(graphEntries), [graphEntries]);
  const groups = useMemo(() => createHistoryGroups(graphRows), [graphRows]);
  const maxLane = useMemo(() => graphEntries.reduce((max, entry) => Math.max(max, entry.lane), 0), [graphEntries]);
  const geometry = useMemo(() => createGeometry(panelWidth, maxLane), [panelWidth, maxLane]);
  const graphLines = useMemo(() => createGraphLines(groups, geometry), [groups, geometry]);
  const counts = useMemo(() => {
    const { branchCount } = createLaneMap(entries, historyState.nodes);
    return { undoable: entries.filter((entry) => entry.kind === 'undoable').length, redoable: entries.filter((entry) => entry.kind === 'redoable').length, saves: entries.filter((entry) => entry.eventType === 'manual-save').length, branches: branchCount };
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
