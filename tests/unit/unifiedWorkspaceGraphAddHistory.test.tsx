import { Children, isValidElement, type ReactElement } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// tests/setup.ts replaces mediaStore with a stateless mock whose setState is a
// no-op. Repository timeline mutations need the registered, active composition.
// Match the real-store fixtures in exclusiveHistorySnapshotLease.test.ts.
vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(), establishTimelineCompositionSaveBaseline: vi.fn(),
}));

import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import { captureSnapshot, getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks, startBatch, endBatch, useHistoryStore } from '../../src/stores/historyStore';
import { createHistorySnapshot } from '../../src/stores/historyStore/snapshotCapture';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { useClipWorkspaceController } from '../../src/components/panels/nodes/unified/useClipWorkspaceController';
import { WorkspaceContextMenu } from '../../src/components/panels/nodes/unified/WorkspaceContextMenu';
import { clipWorkspaceAddActions } from '../../src/components/panels/nodes/unified/clipWorkspaceAddActions';
import { flattenNodeMenu, searchNodeMenu, type NodeMenuEntry } from '../../src/components/panels/nodes/workspace/NodeMenuTree';
import type { NodeGraphCanvasProps } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type LogicalRevision } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { getEditorRepositorySession, installEditorRepositorySession } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import { getRepositoryStore } from '../../src/services/project/repository/transaction/storeMutationBoundary';
import { getCurrentEditorGestureId, hasOpenEditorGestures, runEditorGesture } from '../../src/services/project/repository/transaction/editorGestureOwnership';
import { undo, redo } from '../../src/stores/historyStore';
import { encodeProjectDomains, decodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { EntityDTO, RevisionMetadata } from '../../src/services/project/repository/contracts';
import type { Composition } from '../../src/stores/mediaStore/types';
import { useNodeCanvasPlacement } from '../../src/components/panels/nodes/canvas/useNodeCanvasPlacement';

const initial = useTimelineStore.getState();
const initialMedia = useMediaStore.getState();
let repositoryCleanup: (() => void) | undefined;
const read = () => createHistorySnapshot('Probe', { getTimelineState: useTimelineStore.getState }).timelineEditState!.timeline;
// Runtime handles (reload flags) are restored by the runtime, not authored project content.
const withoutRuntime = (clips: ReturnType<typeof read>['clips']) => clips.map(({ runtimeRef: _runtimeRef, ...clip }) => clip);
const authored = () => ({ clips: withoutRuntime(read().clips), compositionGraph: useTimelineStore.getState().compositionGraph });

beforeEach(() => {
  vi.useFakeTimers();
  useTimelineStore.setState({ clips: [createMockClip({ id: 'clip', source: { type: 'solid', naturalDuration: 5 },
    nodeGraph: { version: 1, nodes: [] } })], tracks: [createMockTrack({ id: 'video-1' })], layers: [],
    selectedClipIds: new Set(['clip']), primarySelectedClipId: 'clip', clipKeyframes: new Map(), isExporting: false,
    compositionGraph: { version: 1, layout: { nodes: { 'comp:clip:clip': { x: 300, y: 80 } },
      collapsed: { 'comp:clip:clip:processing': false } } } });
  initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: () => {} },
    dock: { getState: useDockStore.getState, setState: () => {} } });
  setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  useHistoryStore.setState({ batchId: null, batchLabel: null, isApplying: false });
  useHistoryStore.getState().clearHistory();
});
afterEach(() => {
  cleanup(); repositoryCleanup?.(); repositoryCleanup = undefined; vi.restoreAllMocks();
  useHistoryStore.getState().clearHistory(); useTimelineStore.setState(initial); useMediaStore.setState(initialMedia);
  setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  vi.clearAllTimers(); vi.useRealTimers();
});

for (const root of ['clip-root', 'inline']) describe(`${root}: controller add history`, () => {
  for (const choice of ['search:blur gaussian', 'effect:gaussian-blur', 'stage:transform', 'stage:ai', 'stage:color']) {
    it(`${choice} creates one entry and one undo restores all authored clip/composition state`, () => {
      const controller = renderHook(() => useClipWorkspaceController('clip', root === 'inline' ? 'workspace:inline:clip' : 'workspace'));
      act(() => (controller.result.current!.canvas.props as NodeGraphCanvasProps).onOpenAddMenu!({ x: 100, y: 120, layout: { x: 670, y: 310 } }));
      const menu = Children.toArray(controller.result.current!.menus.props.children).find(child => isValidElement(child) && child.type === WorkspaceContextMenu) as ReactElement<{ entries: NodeMenuEntry[] }>;
      expect(menu).toBeDefined();
      const selected = choice.startsWith('search:') ? searchNodeMenu(menu.props.entries, choice.slice(7))[0]?.entry
        : flattenNodeMenu(menu.props.entries).find(item => item.entry.id === choice)?.entry;
      expect(selected).toBeDefined();
      const before = authored(); captureSnapshot('Before add');
      act(() => selected!.onSelect());
      act(() => vi.advanceTimersByTime(2000));
      expect(authored()).not.toEqual(before);
      expect(getHistoryStateView().undoStack).toHaveLength(1);
      expect(useHistoryStore.getState().batchId).toBeNull();
      const added = authored();
      act(() => { expect(useHistoryStore.getState().undo()).not.toBeNull(); });
      expect(authored()).toEqual(before);
      expect(getHistoryStateView().undoStack).toHaveLength(0);
      act(() => { expect(useHistoryStore.getState().redo()).not.toBeNull(); });
      expect(authored()).toEqual(added);
    });
  }
});

it('primary and wheels additions join an existing owner without finishing its batch', () => {
  const before = authored(); captureSnapshot('Before colors');
  const batch = startBatch('Add colors');
  const actions = clipWorkspaceAddActions('clip');
  actions.color('primary'); actions.color('wheels');
  expect(useHistoryStore.getState().batchId).toBe(batch.batchId);
  expect(getHistoryStateView().undoStack).toHaveLength(0);
  endBatch();
  expect(getHistoryStateView().undoStack).toHaveLength(1);
  useHistoryStore.getState().undo();
  expect(authored()).toEqual(before);
});

it('built-in/effect/AI additions never end the surrounding add transaction', () => {
  const before = authored(); captureSnapshot('Before compound add');
  const batch = startBatch('Add processing');
  const actions = clipWorkspaceAddActions('clip');
  actions.builtIn('transform', { x: 500, y: 20 });
  actions.effect('gaussian-blur', { x: 800, y: 20 });
  actions.ai({ x: 1100, y: 20 });
  expect(useHistoryStore.getState().batchId).toBe(batch.batchId);
  expect(getHistoryStateView().undoStack).toHaveLength(0);
  endBatch();
  expect(getHistoryStateView().undoStack).toHaveLength(1);
  useHistoryStore.getState().undo();
  expect(authored()).toEqual(before);
});

// Real repository coordinator, gesture ownership, domain adapters and store boundary.
// Only disk transport and runtime activation are replaced: assertions below compare
// the canonical clip/composition entities that a real undo activates.
async function repositoryFixture() {
  expect(vi.isMockFunction(useMediaStore.setState), 'Repository tests require the real media store').toBe(false);
  expect(getRepositoryStore('media')?.getState(), 'Repository media registry must use the fixture store').toBe(useMediaStore.getState());
  expect(getRepositoryStore('timeline')?.getState(), 'Repository timeline registry must use the controller store').toBe(useTimelineStore.getState());
  const owner: Composition = { id: 'composition', name: 'Test composition', type: 'composition',
    parentId: null, createdAt: 0, width: 1920, height: 1080, frameRate: 25, duration: 5,
    backgroundColor: '#000', timelineData: createSerializableTimelineState(useTimelineStore.getState()) };
  useMediaStore.setState({ files: [], compositions: [owner], activeCompositionId: owner.id });
  expect(useMediaStore.getState().activeCompositionId).toBe(owner.id);
  expect(useMediaStore.getState().compositions.find(composition => composition.id === owner.id)).toBe(owner);
  const encoded = encodeProjectDomains({ version: 1, name: 'Workspace history', createdAt: '2026-10-03', updatedAt: '2026-10-03',
    settings: { width: 1920, height: 1080, frameRate: 25, sampleRate: 48000 }, media: [], folders: [],
    compositions: convertCompositions([owner]), activeCompositionId: owner.id, openCompositionIds: [owner.id], expandedFolderIds: [] });
  const revisions = new Map<string, LogicalRevision>();
  const projections = new Map<string, ReadonlyMap<string, EntityDTO>>();
  const storage: CoordinatorStorage = {
    publishRevision: async revision => {
      const entities = new Map(revision.parentRevisionId ? projections.get(revision.parentRevisionId) : []);
      for (const change of revision.changes) {
        if (change.after) entities.set(change.entityKey, change.after); else entities.delete(change.entityKey);
      }
      revisions.set(revision.revisionId, revision); projections.set(revision.revisionId, entities);
    },
    publishNavigation: async () => {}, publishMetadata: async () => {}, publishJournal: async () => {},
    loadProjection: async id => projections.get(id) ?? new Map(),
    getRevision: async id => {
      const revision = revisions.get(id);
      return revision ? { ...revision, operationSequence: 1, changedEntities: revision.changes.map(change => change.entityKey),
        reference: { hash: `sha256:${'0'.repeat(64)}`, segmentId: 'test', offset: 8, length: 1 } } as RevisionMetadata : null;
    },
    getRedoChild: async (id, preferred) => preferred ?? [...revisions.values()].find(revision => revision.parentRevisionId === id)?.revisionId ?? null,
    flushViews: async () => {}, assertOwned: () => {},
  };
  const coordinator = new ProjectTransactionCoordinator('workspace-test', 'editor', storage, { canActivate: () => true, activate: async () => {} });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  const session = { opening: { writable: true }, coordinator, updateView: async () => 1 } as unknown as RepositorySession;
  repositoryCleanup = installEditorRepositorySession(session);
  expect(getEditorRepositorySession()).toBe(session);
  const begin = vi.spyOn(coordinator, 'begin');
  const canonical = () => decodeProjectDomains(coordinator.getEntities(), encoded.workspace).compositions[0];
  return { coordinator, begin, canonical };
}

/** Repository owners are dispatch-scoped. A direct onSelect() call misses this. */
function dispatchAdd(action: () => void, type: 'keydown' | 'click' = 'keydown') {
  const control = document.createElement('button'); document.body.append(control);
  let failure: unknown, called = false;
  control.addEventListener(type, () => { called = true; try { action(); } catch (error) { failure = error; } });
  try {
    act(() => control.dispatchEvent(type === 'keydown'
      ? new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) : new MouseEvent('click', { bubbles: true })));
    expect(called).toBe(true);
    if (failure) throw failure;
  } finally { control.remove(); }
}

for (const root of ['clip-root', 'inline']) describe(`${root}: REPOSITORY controller add history`, () => {
  for (const choice of ['search:blur gaussian', 'effect:gaussian-blur', 'stage:transform', 'stage:ai', 'stage:color', 'empty-effect']) {
    it(`${choice} commits exactly one gesture including placement, with no delayed authored write`, async () => {
      const repository = await repositoryFixture();
      const before = repository.canonical(), beforeEntities = new Map(repository.coordinator.getEntities());
      const beforeRevision = repository.coordinator.getStatus().revisionId;
      const controller = renderHook(() => {
        const value = useClipWorkspaceController('clip', root === 'inline' ? 'workspace:inline:clip' : 'workspace')!;
        useNodeCanvasPlacement((value.canvas.props as NodeGraphCanvasProps).graph, 1);
        return value;
      });
      act(() => (controller.result.current.canvas.props as NodeGraphCanvasProps).onOpenAddMenu!({ x: 100, y: 120, layout: { x: 670, y: 310 } }));
      const menu = Children.toArray(controller.result.current.menus.props.children).find(child => isValidElement(child) && child.type === WorkspaceContextMenu) as ReactElement<{ entries: NodeMenuEntry[] }>;
      const selected = choice.startsWith('search:') ? searchNodeMenu(menu.props.entries, choice.slice(7))[0]?.entry
        : flattenNodeMenu(menu.props.entries).find(item => item.entry.id === choice)?.entry;
      expect(selected).toBeDefined();
      const beforeRuntime = authored();
      dispatchAdd(() => selected!.onSelect(), root === 'inline' ? 'keydown' : 'click');
      // The controller catches add failures to display them in the menu. Surface
      // that reason before diagnosing an unchanged repository as a history bug.
      const remainingMenu = Children.toArray(controller.result.current.menus.props.children).find(child => isValidElement(child) && child.type === WorkspaceContextMenu) as ReactElement<{ error?: string }> | undefined;
      expect(remainingMenu?.props.error ?? '', 'The controller must accept the add').toBe('');
      expect(authored(), 'The add must change the real timeline store').not.toEqual(beforeRuntime);
      if (choice === 'effect:gaussian-blur') {
        expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip')!.effects).toHaveLength(beforeRuntime.clips[0].effects.length + 1);
      }
      const added = repository.canonical(), addedRevision = repository.coordinator.getStatus().revisionId;
      expect(added, 'The registered repository must publish the timeline add').not.toEqual(before);
      if (choice === 'effect:gaussian-blur') expect(added.clips[0].effects).toHaveLength(before.clips[0].effects.length + 1);
      expect(addedRevision, 'The add must create a content revision').not.toBe(beforeRevision);
      expect(repository.begin).toHaveBeenCalledTimes(1);
      expect(repository.begin.mock.calls[0][1]).toBe('gesture');
      expect(hasOpenEditorGestures()).toBe(false);
      expect(useHistoryStore.getState().batchId).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(repository.begin).toHaveBeenCalledTimes(1);
      expect(repository.coordinator.getStatus().revisionId).toBe(addedRevision);
      expect(repository.canonical()).toEqual(added);
      await act(async () => { expect(await undo()).not.toBeNull(); });
      expect(repository.coordinator.getStatus().revisionId).toBe(beforeRevision);
      expect(repository.coordinator.getEntities()).toEqual(beforeEntities);
      expect(repository.canonical()).toEqual(before);
      await act(async () => { expect(await redo()).not.toBeNull(); });
      expect(repository.canonical()).toEqual(added);
    });
  }

  it('nested add and folding leave the outer repository gesture open for subsequent placement', async () => {
    const repository = await repositoryFixture();
    const before = new Map(repository.coordinator.getEntities());
    const controller = renderHook(() => useClipWorkspaceController('clip', root === 'inline' ? 'workspace:inline:clip' : 'workspace'));
    dispatchAdd(() => {
      const outer = startBatch('Add and expand');
      expect(outer.opened).toBe(true);
      try {
        runEditorGesture(outer.batchId!, () => {
          const actions = clipWorkspaceAddActions('clip');
          actions.effect('gaussian-blur', { x: 670, y: 310 });
          actions.ai({ x: 1000, y: 310 });
          actions.builtIn('transform', { x: 350, y: 310 });
          actions.color('primary'); actions.color('wheels');
          (controller.result.current!.canvas.props as NodeGraphCanvasProps).onToggleGroup?.('color');
          expect(getCurrentEditorGestureId()).toBe(outer.batchId);
          useTimelineStore.getState().moveClipNodeGraphNode('clip', 'output', { x: 1400, y: 310 });
        });
      } finally { if (outer.opened) endBatch(); }
    });
    expect(repository.begin).toHaveBeenCalledTimes(1);
    expect(hasOpenEditorGestures()).toBe(false);
    await act(async () => { expect(await undo()).not.toBeNull(); });
    expect(repository.coordinator.getEntities()).toEqual(before);
  });

  it('effect bypass cannot end an enclosing add/placement gesture', async () => {
    const effectId = useTimelineStore.getState().addClipEffect('clip', 'gaussian-blur');
    const repository = await repositoryFixture(), before = new Map(repository.coordinator.getEntities());
    const controller = renderHook(() => useClipWorkspaceController('clip', root === 'inline' ? 'workspace:inline:clip' : 'workspace'));
    dispatchAdd(() => {
      const outer = startBatch('Add and bypass');
      try {
        (controller.result.current!.canvas.props as NodeGraphCanvasProps).onToggleNodeBypass?.(`effect-${effectId}`);
        expect(getCurrentEditorGestureId()).toBe(outer.batchId);
        clipWorkspaceAddActions('clip').ai({ x: 670, y: 310 });
      } finally { if (outer.opened) endBatch(); }
    });
    expect(repository.begin).toHaveBeenCalledTimes(1);
    expect(hasOpenEditorGestures()).toBe(false);
    await act(async () => { expect(await undo()).not.toBeNull(); });
    expect(repository.coordinator.getEntities()).toEqual(before);
  });
});
