import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Logger } from '../../services/logger';
import type { HistoryTimelineEvent } from '../../types/history';
import type { DockStoreSnapshot, ExportStoreSnapshot, FlashBoardStoreSnapshot, HistoryNode, HistoryStoreInitRefs, HistoryStoreRefs, HistoryState, MediaStoreState, StateSnapshot, StoryboardStoreSnapshot, TimelineStoreState } from './historyStoreTypes';
export type { HistoryRestoreResult } from './historyStoreTypes';
import { createHistoryEntries, getRedoChild } from './historyNavigation';
import { HISTORY_DEBUG_DISABLE_STORAGE_KEY, isHistoryDisabledForDebug, setHistoryDisabledForDebug } from './historyDebug';
import { createHistorySnapshot, createInitialHistorySnapshot as createInitialHistorySnapshotFromRefs } from './snapshotCapture';
import { applyHistorySnapshot } from './snapshotApply';
import { deepClone } from './snapshotCloning';
import { createHistoryFacade } from './historyFacade';
import { restoreHistoryBranchAction, restoreHistoryEntryAction, type HistoryRestoreActionContext } from './historyRestoreActions';
import { createHistoryProjectHydrationState, serializeHistoryForProject } from './historyProjectState';
import { assertExclusiveTimelineMutationAllowed } from '../timeline/exclusiveMutationLease';

export { HISTORY_DEBUG_DISABLE_STORAGE_KEY, isHistoryDisabledForDebug, setHistoryDisabledForDebug };
// Snapshot persistence is affordable since the tree rebuild: every state is
// stored exactly once (no per-branch stack copies), capped in
// historyProjectState.ts (MAX_PERSISTED_HISTORY_NODES).
const log = Logger.create('History'); const MAX_HISTORY_EVENT_LOG_SIZE = 500; const PERSIST_HISTORY_SNAPSHOTS = true; const HISTORY_CAPTURE_WARN_MS = 24;
let nextBatchId = 1;
let flushPendingCaptureCallback: (() => void) | null = null; let suppressCapturesCallback: (() => void) | null = null; let afterApplyCallback: (() => void) | null = null;
export function setHistoryCallbacks(callbacks: { flushPendingCapture: () => void; suppressCaptures: () => void; afterApply?: () => void }) { flushPendingCaptureCallback = callbacks.flushPendingCapture; suppressCapturesCallback = callbacks.suppressCaptures; afterApplyCallback = callbacks.afterApply ?? null; }
let getTimelineState: (() => TimelineStoreState) | undefined; let setTimelineState: ((s: Partial<TimelineStoreState>) => void) | undefined;
let getMediaState: (() => MediaStoreState) | undefined; let setMediaState: ((s: Partial<MediaStoreState>) => void) | undefined;
let getDockState: (() => DockStoreSnapshot) | undefined; let setDockState: ((s: Partial<DockStoreSnapshot>) => void) | undefined;
let getFlashBoardState: (() => FlashBoardStoreSnapshot) | undefined; let setFlashBoardState: ((s: Partial<FlashBoardStoreSnapshot>) => void) | undefined;
let getStoryboardState: (() => StoryboardStoreSnapshot) | undefined; let setStoryboardState: ((s: StoryboardStoreSnapshot) => void) | undefined;
let getExportState: (() => ExportStoreSnapshot) | undefined; let setExportState: ((s: Partial<ExportStoreSnapshot>) => void) | undefined;
export function initHistoryStoreRefs(stores: HistoryStoreInitRefs) { getTimelineState=stores.timeline.getState; setTimelineState=stores.timeline.setState; getMediaState=stores.media.getState; setMediaState=stores.media.setState; getDockState=stores.dock.getState; setDockState=stores.dock.setState; getFlashBoardState=stores.flashboard?.getState; setFlashBoardState=stores.flashboard?.setState; getStoryboardState=stores.storyboard?.getState; setStoryboardState=stores.storyboard?.setState; getExportState=stores.export?.getState; setExportState=stores.export?.setState; }
const refs = (): HistoryStoreRefs => ({ getTimelineState,setTimelineState,getMediaState,setMediaState,getDockState,setDockState,getFlashBoardState,setFlashBoardState,getStoryboardState,setStoryboardState,getExportState,setExportState });
const createSnapshot = (label: string, previous?: StateSnapshot | null) => createHistorySnapshot(label, refs(), previous);
const createInitialHistorySnapshot = () => createInitialHistorySnapshotFromRefs(refs());
const applySnapshot = (snapshot: StateSnapshot) => applyHistorySnapshot(snapshot, refs(), { afterApply: afterApplyCallback ?? undefined, onTimelineEditStateRestored: d => log.debug('Restored timeline from HistoryTimelineEditState', d) });
const flushPendingCapture = () => flushPendingCaptureCallback?.(); const suppressCaptures = () => suppressCapturesCallback?.(); export const flushPendingHistoryCapture = flushPendingCapture;
const isTimelineHistoryLocked = () => getTimelineState?.().isExporting === true;
const makeNodeId = () => `node:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
function appendNode(state: HistoryState, snapshot: StateSnapshot): Partial<HistoryState> {
  const id = makeNodeId(); const node: HistoryNode = { id, parentId: state.activeNodeId, snapshot };
  let nodes = { ...state.nodes, [id]: node }; let directions = { ...state.lastVisitedChildByNodeId };
  if (state.activeNodeId) directions[state.activeNodeId] = id;
  let rootId = state.rootId ?? id; const activeNodeId = id;
  while (Object.keys(nodes).length > state.maxHistoryNodes) {
    const childParents = new Set(Object.values(nodes).map(n => n.parentId).filter((x): x is string => !!x));
    const path = new Set<string>(); let c: HistoryNode | undefined = nodes[activeNodeId]; while (c) { path.add(c.id); c = c.parentId ? nodes[c.parentId] : undefined; }
    const leaf = Object.values(nodes).filter(n => !childParents.has(n.id) && !path.has(n.id) && n.id !== activeNodeId).sort((a,b) => a.snapshot.timestamp-b.snapshot.timestamp)[0];
    if (leaf) { const { [leaf.id]: _, ...rest } = nodes; nodes = rest; directions = Object.fromEntries(Object.entries(directions).filter(([p, child]) => p !== leaf.id && child !== leaf.id)); continue; }
    const root = rootId ? nodes[rootId] : undefined; const children = root ? Object.values(nodes).filter(n => n.parentId === root.id) : [];
    if (root && children.length === 1) { const child = children[0]; nodes = { ...nodes, [child.id]: { ...child, parentId: null } }; const { [root.id]: _, ...rest } = nodes; nodes = rest; directions = Object.fromEntries(Object.entries(directions).filter(([p, childId]) => p !== root.id && childId !== root.id)); rootId = child.id; continue; }
    break;
  }
  return { nodes, rootId, activeNodeId, lastVisitedChildByNodeId: directions };
}
function restoreContext(set: (s: Partial<HistoryState>) => void, get: () => HistoryState): HistoryRestoreActionContext { return { get,set,applySnapshot,isHistoryDisabledForDebug,isTimelineHistoryLocked,flushPendingCapture,suppressCaptures,log }; }

export const useHistoryStore = create<HistoryState>()(subscribeWithSelector((set, get) => ({
  nodes: {}, rootId: null, activeNodeId: null, lastVisitedChildByNodeId: {}, eventLog: [], maxHistoryNodes: 150, isApplying: false, batchId: null, batchLabel: null,
  captureSnapshot: (label, options) => {
    if (isHistoryDisabledForDebug()) return; const state = get(); if (state.isApplying || state.batchId !== null) return;
    if (!options?.isAutoCapture) suppressCaptures(); const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const snapshot = createSnapshot(label, state.nodes[state.activeNodeId ?? '']?.snapshot ?? null); const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    if (elapsed > HISTORY_CAPTURE_WARN_MS) log.warn('Slow history snapshot capture', { label, durationMs: Math.round(elapsed) }); set(appendNode(get(), snapshot));
  },
  undo: () => {
    if (isHistoryDisabledForDebug()) return null; if (isTimelineHistoryLocked()) { log.warn('Blocked undo during timeline export'); return null; }
    if (get().batchId !== null) get().endBatch(); flushPendingCapture(); const state = get(); const active = state.activeNodeId ? state.nodes[state.activeNodeId] : undefined; const target = active?.parentId ? state.nodes[active.parentId] : undefined; if (!active || !target) return null;
    set({ isApplying: true }); applySnapshot(deepClone(target.snapshot)); set({ activeNodeId: target.id, lastVisitedChildByNodeId: { ...state.lastVisitedChildByNodeId, [target.id]: active.id }, isApplying: false }); suppressCaptures(); return { operation: 'undo', label: active.snapshot.label };
  },
  redo: () => {
    if (isHistoryDisabledForDebug()) return null; if (isTimelineHistoryLocked()) { log.warn('Blocked redo during timeline export'); return null; }
    if (get().batchId !== null) get().endBatch(); flushPendingCapture(); const state=get(); if (!state.activeNodeId) return null; const child=getRedoChild(state.nodes,state.activeNodeId,state.lastVisitedChildByNodeId); if (!child) return null;
    set({ isApplying:true }); applySnapshot(deepClone(child.snapshot)); set({ activeNodeId: child.id, isApplying:false }); suppressCaptures(); return { operation:'redo', label: child.snapshot.label };
  },
  canUndo: () => { const s=get(); return !!(s.activeNodeId && s.nodes[s.activeNodeId]?.parentId); },
  canRedo: () => { const s=get(); return !!(s.activeNodeId && getRedoChild(s.nodes,s.activeNodeId,s.lastVisitedChildByNodeId)); },
  getHistoryEntries: () => isHistoryDisabledForDebug() ? [] : createHistoryEntries(get().nodes,get().activeNodeId,get().lastVisitedChildByNodeId,get().eventLog),
  getActiveSnapshot: () => { const s=get(); return s.activeNodeId ? s.nodes[s.activeNodeId]?.snapshot ?? null : null; },
  recordEvent: (type,label) => { if (isHistoryDisabledForDebug() || type === 'autosave') return; const timestamp=Date.now(); const trimmed=label.trim(); const event: HistoryTimelineEvent={ id:`event:${type}:${timestamp}:${Math.random().toString(36).slice(2,8)}`,type,label:trimmed || 'History event',timestamp }; set(s=>({eventLog:[...s.eventLog,event].slice(-MAX_HISTORY_EVENT_LOG_SIZE)})); },
  restoreEntry: entry => restoreHistoryEntryAction(entry, restoreContext(set,get)), restoreBranch: (id,index) => restoreHistoryBranchAction(id,index,restoreContext(set,get)),
  startBatch: label => { const existing=get().batchId; if (isHistoryDisabledForDebug() || existing !== null) return { opened:false,batchId:existing }; flushPendingCapture(); if (get().batchId !== null) return { opened:false,batchId:get().batchId }; if (!get().activeNodeId) { const initial=createSnapshot('initial'); set(appendNode(get(),initial)); } const batchId=nextBatchId++; set({batchId,batchLabel:label}); return {opened:true,batchId}; },
  endBatch: () => { const state=get(); if (state.batchId === null) return; assertExclusiveTimelineMutationAllowed(); if (isHistoryDisabledForDebug()) { set({batchId:null,batchLabel:null}); return; } const started=typeof performance !== 'undefined'?performance.now():Date.now(); const snapshot=createSnapshot(state.batchLabel || 'batch',state.nodes[state.activeNodeId ?? '']?.snapshot ?? null); const elapsed=(typeof performance !== 'undefined'?performance.now():Date.now())-started; if(elapsed>HISTORY_CAPTURE_WARN_MS)log.warn('Slow history batch capture',{label:state.batchLabel||'batch',durationMs:Math.round(elapsed)}); set({...appendNode(get(),snapshot),batchId:null,batchLabel:null}); suppressCaptures(); },
  cancelBatch: () => { if (get().batchId === null) return; assertExclusiveTimelineMutationAllowed(); const snapshot=get().getActiveSnapshot(); if (snapshot) { set({isApplying:true}); applySnapshot(deepClone(snapshot)); set({isApplying:false}); suppressCaptures(); } set({batchId:null,batchLabel:null}); },
  setIsApplying: value => set({isApplying:value}), clearHistory: () => set({nodes:{},rootId:null,activeNodeId:null,lastVisitedChildByNodeId:{}}),
  serializeForProject: () => { const s=get(); return serializeHistoryForProject({ nodes:s.nodes,rootId:s.rootId,activeNodeId:s.activeNodeId,lastVisitedChildByNodeId:s.lastVisitedChildByNodeId,eventLog:s.eventLog,isHistoryDisabled:isHistoryDisabledForDebug(),persistHistorySnapshots:PERSIST_HISTORY_SNAPSHOTS,maxEventLogSize:MAX_HISTORY_EVENT_LOG_SIZE }); },
  hydrateFromProject: history => set(createHistoryProjectHydrationState({history,isHistoryDisabled:isHistoryDisabledForDebug(),createInitialHistorySnapshot,maxEventLogSize:MAX_HISTORY_EVENT_LOG_SIZE})),
})));

/**
 * Linear view of the currently selected history path.
 *
 * The snapshot tree remains the only stored history state. This view exists
 * for diagnostics and callers that need stack-shaped data while they migrate
 * from the former v1 history model.
 */
export function getHistoryStateView() {
  const state = useHistoryStore.getState();
  const currentNode = state.activeNodeId ? state.nodes[state.activeNodeId] : undefined;
  const undoStack: StateSnapshot[] = [];
  let cursor = currentNode?.parentId ? state.nodes[currentNode.parentId] : undefined;
  while (cursor) {
    undoStack.unshift(cursor.snapshot);
    cursor = cursor.parentId ? state.nodes[cursor.parentId] : undefined;
  }

  const redoPath: StateSnapshot[] = [];
  cursor = state.activeNodeId
    ? getRedoChild(state.nodes, state.activeNodeId, state.lastVisitedChildByNodeId) ?? undefined
    : undefined;
  while (cursor) {
    redoPath.push(cursor.snapshot);
    cursor = getRedoChild(state.nodes, cursor.id, state.lastVisitedChildByNodeId) ?? undefined;
  }

  return {
    ...state,
    undoStack,
    currentSnapshot: currentNode?.snapshot ?? null,
    // The v1 redo stack popped its next entry from the end.
    redoStack: redoPath.reverse(),
    maxHistorySize: state.maxHistoryNodes,
  };
}

const historyFacade=createHistoryFacade(useHistoryStore); export const captureSnapshot=historyFacade.captureSnapshot; export const undo=historyFacade.undo; export const redo=historyFacade.redo; export const startBatch=historyFacade.startBatch; export const endBatch=historyFacade.endBatch; export const cancelHistoryBatch=historyFacade.cancelHistoryBatch; export const recordHistoryEvent=historyFacade.recordHistoryEvent; export const restoreHistoryEntry=historyFacade.restoreHistoryEntry; export const restoreHistoryBranch=historyFacade.restoreHistoryBranch; export const serializeHistoryStateForProject=historyFacade.serializeHistoryStateForProject; export const hydrateHistoryStateFromProject=historyFacade.hydrateHistoryStateFromProject;
