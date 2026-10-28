import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// An inspector drag on the REAL timeline store (revision middleware + repository boundary): every pointer
// sample must stay a live gesture preview, so a clip with heavy effects is encoded once at release instead
// of once per sample. The old fixture used a bare store without withTimelineRevision and missed that the
// middleware's timelineRevision (and invalidateCache's cache fields) pushed every sample onto the full path.
vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(), establishTimelineCompositionSaveBaseline: vi.fn(),
}));

import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import { initHistoryStoreRefs, setHistoryCallbacks, useHistoryStore } from '../../src/stores/historyStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type LogicalRevision } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { installEditorRepositorySession } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import { beginEditorGesture, finishEditorGesture, runEditorGesture } from '../../src/services/project/repository/transaction/editorGestureOwnership';
import { TimelineGesturePreview } from '../../src/services/project/repository/transaction/TimelineGesturePreview';
import { decodeOwnedAggregate } from '../../src/services/project/repository/transaction/domainAdapters/aggregatePlan';
import { encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { entityKey } from '../../src/services/project/repository/domains/jsonBoundary';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { EntityDTO, RepositoryProjection } from '../../src/services/project/repository/contracts';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { AnimatableProperty } from '../../src/types/animationProperties';

const initialTimeline = useTimelineStore.getState();
const initialMedia = useMediaStore.getState();
const COMPOSITION = 'composition';
const SAMPLES = 50;
let repositoryCleanup: (() => void) | undefined;
const openGestures: number[] = [];
let unsubscribeMirror: (() => void) | undefined;

interface ProjectClipJson { transform?: { opacity?: number; x?: number }; effects?: Array<{ id: string; params?: Record<string, unknown> }>; keyframes?: Array<{ property: string; value: number }> }

async function installRepository() {
  const owner: Composition = { id: COMPOSITION, name: 'Inspector drag', type: 'composition', parentId: null, createdAt: 0,
    width: 1920, height: 1080, frameRate: 25, duration: 10, backgroundColor: '#000',
    timelineData: createSerializableTimelineState(useTimelineStore.getState()) };
  useMediaStore.setState({ compositions: [owner], activeCompositionId: owner.id });
  const encoded = encodeProjectDomains({ version: 1, name: 'Inspector drag', createdAt: '2026-10-28', updatedAt: '2026-10-28',
    settings: { width: 1920, height: 1080, frameRate: 25, sampleRate: 48000 }, media: [], folders: [],
    compositions: convertCompositions([owner]), activeCompositionId: owner.id, openCompositionIds: [owner.id], expandedFolderIds: [] });
  const revisions: LogicalRevision[] = [];
  const projections = new Map<string, ReadonlyMap<string, EntityDTO>>();
  const storage = {
    publishRevision: async (revision: LogicalRevision) => {
      const entities = new Map(revision.parentRevisionId ? projections.get(revision.parentRevisionId) : []);
      for (const change of revision.changes) if (change.after) entities.set(change.entityKey, change.after); else entities.delete(change.entityKey);
      revisions.push(revision); projections.set(revision.revisionId, entities);
    },
    publishNavigation: async () => {}, publishMetadata: async () => {}, publishJournal: async () => {},
    loadProjection: async (id: string) => projections.get(id) ?? new Map(), getRevision: async () => null,
    getRedoChild: async () => null, flushViews: async () => {}, assertOwned: () => {},
  } as unknown as CoordinatorStorage;
  const activate = vi.fn(async (_projection: RepositoryProjection) => {});
  const coordinator = new ProjectTransactionCoordinator('inspector-drag', 'editor', storage, { canActivate: () => true, activate });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  repositoryCleanup = installEditorRepositorySession({ opening: { writable: true }, coordinator, updateView: async () => 1 } as unknown as RepositorySession);
  let mirrorWrites = 0;
  unsubscribeMirror = useMediaStore.subscribe((state, prior) => { if (state.compositions !== prior.compositions) mirrorWrites++; });
  const savedRevisions = async () => { await coordinator.flush(); return revisions.length - 1; };
  const savedClip = (id: string, entities: ReadonlyMap<string, EntityDTO> = coordinator.getEntities()) =>
    decodeOwnedAggregate(entityKey('clip', COMPOSITION, id), entities) as ProjectClipJson;
  const mirroredClip = (id: string) => useMediaStore.getState().compositions.find(comp => comp.id === COMPOSITION)
    ?.timelineData?.clips.find(clip => clip.id === id);
  return { coordinator, activate, savedRevisions, savedClip, mirroredClip, mirrorWrites: () => mirrorWrites };
}

/** One drag: an explicit editor gesture, like the inspector's frame-coalesced number controls open. */
function drag(label: string) {
  const gesture = beginEditorGesture(label, { explicit: true });
  if (!gesture.opened || gesture.batchId === null) throw new Error('The drag gesture did not open');
  const id = gesture.batchId; openGestures.push(id);
  return {
    sample: (action: () => void) => runEditorGesture(id, action),
    release: () => finishEditorGesture(id),
    cancel: () => finishEditorGesture(id, true),
  };
}

const timeline = () => useTimelineStore.getState();
const clip = (id: string) => timeline().clips.find(value => value.id === id)!;
const brightness = () => clip('clip-a').effects.find(effect => effect.type === 'brightness')!;

let stage: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  useTimelineStore.setState({
    clips: [createMockClip({ id: 'clip-a', trackId: 'video-1', file: undefined }), createMockClip({ id: 'clip-b', trackId: 'video-1', startTime: 5, file: undefined })],
    tracks: [createMockTrack({ id: 'video-1', name: 'V1' })], layers: [], clipKeyframes: new Map(), isExporting: false,
    playheadPosition: 1, durationLocked: false, videoBakeRegions: [],
  });
  timeline().addClipEffect('clip-a', 'brightness');
  initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: () => {} }, dock: { getState: useDockStore.getState, setState: () => {} } });
  setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  useHistoryStore.setState({ batchId: null, batchLabel: null, isApplying: false });
  useHistoryStore.getState().clearHistory();
  stage = vi.spyOn(TimelineGesturePreview.prototype, 'stage');
});
afterEach(() => {
  // A failed assertion must not leave the drag open for the next test's project.
  for (const id of openGestures.splice(0)) finishEditorGesture(id, true);
  unsubscribeMirror?.(); unsubscribeMirror = undefined;
  repositoryCleanup?.(); repositoryCleanup = undefined;
  vi.restoreAllMocks();
  useHistoryStore.getState().clearHistory(); useTimelineStore.setState(initialTimeline); useMediaStore.setState(initialMedia);
});

const stagedResults = () => stage.mock.results.map(result => result.value);

describe('inspector drags on the real timeline store stay a live preview until release', () => {
  it.each([
    ['updateClipTransform', (i: number) => timeline().updateClipTransform('clip-a', { opacity: i / 100 }), (c: ProjectClipJson) => c.transform?.opacity, 0.5],
    ['setPropertyValue position.x', (i: number) => timeline().setPropertyValue('clip-a', 'position.x' as AnimatableProperty, i), (c: ProjectClipJson) => c.transform?.x, 50],
    ['updateClipEffect', (i: number) => timeline().updateClipEffect('clip-a', brightness().id, { amount: i / 100 }),
      (c: ProjectClipJson) => c.effects?.find(effect => effect.id === brightness().id)?.params?.amount, 0.5],
  ] as const)('%s: 50 samples, one revision, one mirror write, one undo step', async (_name, apply, read, expected) => {
    const repo = await installRepository();
    const start = read(repo.savedClip('clip-a'));
    const revisionBefore = timeline().timelineRevision;
    const gesture = drag('Drag value');
    for (let i = 1; i <= SAMPLES; i++) gesture.sample(() => apply(i));
    expect(stagedResults()).toHaveLength(SAMPLES);
    expect(stagedResults().every(value => value === true)).toBe(true);
    expect(repo.mirrorWrites()).toBe(0);
    // The store-session revision still advances live: stale-plan detection keeps working during the drag.
    expect(timeline().timelineRevision).toBe(revisionBefore + SAMPLES);
    gesture.release();
    expect(await repo.savedRevisions()).toBe(1);
    expect(repo.mirrorWrites()).toBe(1);
    expect(start).not.toEqual(expected);
    expect(read(repo.savedClip('clip-a'))).toBe(expected);

    expect((await repo.coordinator.undo())?.status).toBe('applied');
    const undone = repo.activate.mock.calls.at(-1)![0];
    expect(read(repo.savedClip('clip-a', undone.entities))).toEqual(start);
  });

  it('addKeyframe while recording: 50 samples of one keyframe are one revision', async () => {
    const repo = await installRepository();
    const gesture = drag('Drag keyframed value');
    for (let i = 1; i <= SAMPLES; i++) gesture.sample(() => timeline().addKeyframe('clip-a', 'opacity', i / 100, 1));
    expect(stagedResults()).toHaveLength(SAMPLES);
    expect(stagedResults().every(value => value === true)).toBe(true);
    expect(repo.mirrorWrites()).toBe(0);
    gesture.release();
    expect(await repo.savedRevisions()).toBe(1);
    expect(repo.mirrorWrites()).toBe(1);
    const keys = repo.savedClip('clip-a').keyframes ?? [];
    expect(keys.filter(key => key.property === 'opacity').map(key => key.value)).toEqual([0.5]);
    expect((await repo.coordinator.undo())?.status).toBe('applied');
    const undone = repo.activate.mock.calls.at(-1)![0];
    expect(repo.savedClip('clip-a', undone.entities).keyframes ?? []).toEqual([]);
  });

  it('a cancel mid-drag restores the exact start state and saves nothing', async () => {
    const repo = await installRepository();
    const startClip = clip('clip-a'), startKeys = timeline().clipKeyframes.get('clip-a');
    const gesture = drag('Drag value');
    for (let i = 1; i <= 20; i++) gesture.sample(() => {
      timeline().updateClipTransform('clip-a', { opacity: i / 40 });
      timeline().updateClipEffect('clip-a', brightness().id, { amount: i / 40 });
      timeline().addKeyframe('clip-a', 'rotation.z', i, 2);
    });
    gesture.cancel();
    expect(clip('clip-a')).toBe(startClip);
    expect(timeline().clipKeyframes.get('clip-a')).toBe(startKeys);
    expect(await repo.savedRevisions()).toBe(0);
  });

  it('a structural edit during a drag flushes the preview and still saves one consistent revision', async () => {
    const repo = await installRepository();
    const gesture = drag('Drag value');
    for (let i = 1; i <= 10; i++) gesture.sample(() => timeline().updateClipTransform('clip-a', { opacity: i / 20 }));
    gesture.sample(() => timeline().removeClip('clip-b'));
    for (let i = 11; i <= 16; i++) gesture.sample(() => timeline().updateClipTransform('clip-a', { opacity: i / 20 }));
    expect(stagedResults().slice(0, 10).every(value => value === true)).toBe(true);
    gesture.release();
    expect(await repo.savedRevisions()).toBe(1);
    expect(repo.savedClip('clip-a').transform?.opacity).toBe(0.8);
    expect(() => repo.savedClip('clip-b')).toThrow();
    expect(repo.mirroredClip('clip-a')?.transform.opacity).toBe(0.8);
    expect(repo.mirroredClip('clip-b')).toBeUndefined();
    expect(timeline().clips.map(value => value.id)).toEqual(['clip-a']);
  });

  it('a cancel after a structural edit in the drag restores both the clip list and the values', async () => {
    const repo = await installRepository();
    const startClip = clip('clip-a');
    const gesture = drag('Drag value');
    for (let i = 1; i <= 5; i++) gesture.sample(() => timeline().updateClipTransform('clip-a', { opacity: i / 10 }));
    gesture.sample(() => timeline().removeClip('clip-b'));
    gesture.sample(() => timeline().updateClipTransform('clip-a', { opacity: 0.9 }));
    gesture.cancel();
    expect(timeline().clips.map(value => value.id)).toEqual(['clip-a', 'clip-b']);
    expect(clip('clip-a').transform).toEqual(startClip.transform);
    expect(await repo.savedRevisions()).toBe(0);
  });
});

describe('invalidateCache writes only what changes', () => {
  const region = (id: string, status: 'marked' | 'baked') => ({ id, scope: 'composition' as const, startTime: 0, endTime: 2, createdAt: 0, status, ...(status === 'baked' ? { bakedAt: 5 } : {}) });

  it('keeps clips, bake regions and cache state untouched when nothing is baked or cached', () => {
    useTimelineStore.setState({ videoBakeRegions: [region('r1', 'marked')], cachedFrameTimes: new Set(), isRamPreviewing: false });
    const before = timeline();
    let notifications = 0;
    const unsubscribe = useTimelineStore.subscribe(() => { notifications++; });
    timeline().invalidateCache();
    unsubscribe();
    expect(notifications).toBe(0);
    expect(timeline().clips).toBe(before.clips);
    expect(timeline().videoBakeRegions).toBe(before.videoBakeRegions);
    expect(timeline().timelineRevision).toBe(before.timelineRevision);
  });

  it('still resets baked regions and the RAM preview cache when there is something to reset', () => {
    const baked = { ...clip('clip-b'), videoState: { bakeRegions: [region('c1', 'baked')] } };
    useTimelineStore.setState({
      clips: [clip('clip-a'), baked], videoBakeRegions: [region('r1', 'marked'), region('r2', 'baked')],
      cachedFrameTimes: new Set([0, 1]), isRamPreviewing: true, ramPreviewRange: { start: 0, end: 1 },
    });
    const before = timeline();
    timeline().invalidateCache();
    const after = timeline();
    expect(after.videoBakeRegions.map(value => value.status)).toEqual(['marked', 'marked']);
    expect(after.videoBakeRegions[0]).toBe(before.videoBakeRegions[0]);
    expect(after.videoBakeRegions[1].bakedAt).toBeUndefined();
    expect(after.clips[0]).toBe(before.clips[0]);
    expect(after.clips[1].videoState?.bakeRegions?.[0].status).toBe('marked');
    expect(after.cachedFrameTimes.size).toBe(0);
    expect(after.isRamPreviewing).toBe(false);
    expect(after.ramPreviewRange).toBeNull();
  });
});
