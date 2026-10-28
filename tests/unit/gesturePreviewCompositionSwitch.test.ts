import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A gesture preview keeps its live values only in the timeline store of one composition. A composition
// switch replaces that store while the gesture can still be open (a phone sheet holds its explicit
// gesture for the whole sheet session; a desktop drag can outlast a tab click or an agent tool). The
// switch must flush the preview into the gesture's transaction, and commit and cancel must never throw.
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
import { navigateEditorComposition } from '../../src/services/project/repository/transaction/editorCompositionNavigation';
import { withRepositoryHydration } from '../../src/services/project/repository/transaction/storeMutationBoundary';
import { decodeOwnedAggregate } from '../../src/services/project/repository/transaction/domainAdapters/aggregatePlan';
import { encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { entityKey } from '../../src/services/project/repository/domains/jsonBoundary';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import { Logger } from '../../src/services/logger';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { EntityDTO } from '../../src/services/project/repository/contracts';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/types/timeline';

const initialTimeline = useTimelineStore.getState();
const initialMedia = useMediaStore.getState();
let repositoryCleanup: (() => void) | undefined;
const openGestures: number[] = [];

interface ProjectClipJson { name?: string; transform?: { opacity?: number } }

function composition(id: string, timelineData: Composition['timelineData']): Composition {
  return { id, name: id, type: 'composition', parentId: null, createdAt: 0, width: 1920, height: 1080, frameRate: 25,
    duration: 10, backgroundColor: '#000', timelineData };
}

async function installRepository(otherClips: TimelineClip[] = []) {
  const main = composition('main', createSerializableTimelineState(useTimelineStore.getState()));
  const other = composition('other', createSerializableTimelineState({ ...useTimelineStore.getState(), clips: otherClips, clipKeyframes: new Map() }));
  useMediaStore.setState({ compositions: [main, other], activeCompositionId: main.id, openCompositionIds: [main.id, other.id] });
  const encoded = encodeProjectDomains({ version: 1, name: 'Switch', createdAt: '2026-10-28', updatedAt: '2026-10-28',
    settings: { width: 1920, height: 1080, frameRate: 25, sampleRate: 48000 }, media: [], folders: [],
    compositions: convertCompositions([main, other]), activeCompositionId: main.id, openCompositionIds: [main.id, other.id], expandedFolderIds: [] });
  const revisions: LogicalRevision[] = [];
  const storage = {
    publishRevision: async (revision: LogicalRevision) => { revisions.push(revision); },
    publishNavigation: async () => {}, publishMetadata: async () => {}, publishJournal: async () => {},
    loadProjection: async () => new Map(), getRevision: async () => null,
    getRedoChild: async () => null, flushViews: async () => {}, assertOwned: () => {},
  } as unknown as CoordinatorStorage;
  const coordinator = new ProjectTransactionCoordinator('composition-switch', 'editor', storage, { canActivate: () => true, activate: async () => {} });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  repositoryCleanup = installEditorRepositorySession({ opening: { writable: true }, coordinator, updateView: async () => 1 } as unknown as RepositorySession);
  const savedRevisions = async () => { await coordinator.flush(); return revisions.length - 1; };
  const savedOpacity = (entities: ReadonlyMap<string, EntityDTO> = coordinator.getEntities()) =>
    (decodeOwnedAggregate(entityKey('clip', 'main', 'clip-a'), entities) as ProjectClipJson).transform?.opacity;
  const savedClip = (id: string, comp = 'main') => decodeOwnedAggregate(entityKey('clip', comp, id), coordinator.getEntities()) as ProjectClipJson;
  const mirroredClip = (id: string, comp = 'main') => useMediaStore.getState().compositions.find(item => item.id === comp)
    ?.timelineData?.clips.find(clip => clip.id === id);
  const mirroredOpacity = () => mirroredClip('clip-a')?.transform.opacity;
  return { coordinator, savedRevisions, savedOpacity, mirroredOpacity, savedClip, mirroredClip };
}

function gesture(label: string, explicit: boolean) {
  const opened = beginEditorGesture(label, { explicit });
  if (!opened.opened || opened.batchId === null) throw new Error('The gesture did not open');
  const id = opened.batchId; openGestures.push(id);
  return {
    sample: (action: () => void) => runEditorGesture(id, action),
    release: () => finishEditorGesture(id),
    cancel: () => finishEditorGesture(id, true),
  };
}

const timeline = () => useTimelineStore.getState();
const setOpacity = (opacity: number, id = 'clip-a') => timeline().updateClipTransform(id, { opacity });
/** A solid clip: a composition switch back rebuilds it from the composition's saved timeline. */
const solidClip = (id: string, trackId = 'video-1') => createMockClip({ id, trackId, file: undefined, name: `Solid ${id}`,
  source: { type: 'solid' } as TimelineClip['source'], solidColor: '#ff0000' } as Partial<TimelineClip>);
const logged = (text: string) => Logger.search(text).length;

beforeEach(() => {
  useTimelineStore.setState({
    clips: [createMockClip({ id: 'clip-a', trackId: 'video-1', file: undefined })],
    tracks: [createMockTrack({ id: 'video-1', name: 'V1' })], layers: [], clipKeyframes: new Map(), isExporting: false,
    playheadPosition: 1, durationLocked: false, videoBakeRegions: [], selectedClipIds: new Set(), selectedKeyframeIds: new Set(),
  });
  initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: () => {} }, dock: { getState: useDockStore.getState, setState: () => {} } });
  setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  useHistoryStore.setState({ batchId: null, batchLabel: null, isApplying: false });
  useHistoryStore.getState().clearHistory();
});
afterEach(() => {
  for (const id of openGestures.splice(0)) { try { finishEditorGesture(id, true); } catch { /* reported by the test */ } }
  repositoryCleanup?.(); repositoryCleanup = undefined;
  vi.restoreAllMocks();
  useHistoryStore.getState().clearHistory(); useTimelineStore.setState(initialTimeline); useMediaStore.setState(initialMedia);
});

describe('gesture preview across a composition switch', () => {
  it('desktop drag: the switch saves the dragged value and the release commits one revision', async () => {
    const repo = await installRepository();
    const drag = gesture('Drag opacity', false);
    for (let i = 1; i <= 10; i++) drag.sample(() => setOpacity(i / 20));
    // The flush is an INFO message: an expected event, not a fault.
    Logger.setLevel('INFO');
    const flushed = logged('live preview of composition main was written');
    try { await navigateEditorComposition('other'); } finally { Logger.setLevel('WARN'); }
    expect(logged('live preview of composition main was written')).toBe(flushed + 1);
    expect(timeline().clips).toEqual([]);
    expect(repo.mirroredOpacity()).toBe(0.5);
    expect(() => drag.release()).not.toThrow();
    expect(await repo.savedRevisions()).toBe(1);
    expect(repo.savedOpacity()).toBe(0.5);
  });

  it('phone sheet: an explicit gesture stays open over the switch and keeps working afterwards', async () => {
    const repo = await installRepository();
    const sheet = gesture('Phone sheet', true);
    for (let i = 1; i <= 6; i++) sheet.sample(() => setOpacity(i / 10));
    await navigateEditorComposition('other');
    // The sheet keeps sampling; its clip is no longer in the visible timeline.
    expect(() => sheet.sample(() => setOpacity(0.9))).not.toThrow();
    expect(() => sheet.release()).not.toThrow();
    expect(await repo.savedRevisions()).toBe(1);
    expect(repo.savedOpacity()).toBe(0.6);
    expect(repo.mirroredOpacity()).toBe(0.6);
  });

  it('cancel after the switch saves nothing and restores the off-screen composition', async () => {
    const startKey = { id: 'kf-start', clipId: 'clip-a', time: 0, property: 'rotation.z' as const, value: 0, easing: 'linear' as const };
    useTimelineStore.setState({ clipKeyframes: new Map([['clip-a', [startKey]]]) });
    const repo = await installRepository();
    const start = repo.mirroredOpacity();
    const sheet = gesture('Phone sheet', true);
    for (let i = 1; i <= 6; i++) sheet.sample(() => setOpacity(i / 10));
    sheet.sample(() => timeline().addKeyframe('clip-a', 'rotation.z', 30, 1));
    expect(timeline().clipKeyframes.get('clip-a')).toHaveLength(2);
    await navigateEditorComposition('other');
    const visible = timeline();
    expect(() => sheet.cancel()).not.toThrow();
    expect(await repo.savedRevisions()).toBe(0);
    expect(repo.savedOpacity()).toBe(start);
    expect(repo.mirroredOpacity()).toBe(start);
    const mirrored = useMediaStore.getState().compositions.find(comp => comp.id === 'main')?.timelineData?.clips.find(clip => clip.id === 'clip-a');
    expect(mirrored?.keyframes?.map(key => key.id)).toEqual(['kf-start']);
    // Nothing of the other composition's rollback lands in the visible timeline.
    expect(timeline().clips).toEqual(visible.clips);
    expect([...timeline().clipKeyframes.keys()]).toEqual([...visible.clipKeyframes.keys()]);
  });

  it('a store swap that bypasses navigation drops the stale preview with a warning instead of throwing', async () => {
    const repo = await installRepository();
    const before = logged('replaced by a composition switch');
    const mainClips = timeline().clips, mainKeys = timeline().clipKeyframes;
    for (const finish of ['release', 'cancel'] as const) {
      const sheet = gesture('Phone sheet', true);
      for (let i = 1; i <= 4; i++) sheet.sample(() => setOpacity(i / 10));
      // Like a project activation: both stores change at once, without the navigation's flush.
      withRepositoryHydration(() => {
        useMediaStore.setState({ activeCompositionId: 'other' });
        useTimelineStore.setState({ clips: [], clipKeyframes: new Map() });
      });
      expect(() => sheet.sample(() => setOpacity(0.95))).not.toThrow();
      expect(() => sheet[finish]()).not.toThrow();
      withRepositoryHydration(() => {
        useMediaStore.setState({ activeCompositionId: 'main' });
        useTimelineStore.setState({ clips: mainClips, clipKeyframes: mainKeys });
      });
    }
    expect(repo.mirroredOpacity()).toBe(1);
    expect(logged('replaced by a composition switch')).toBeGreaterThan(before);
    expect(await repo.savedRevisions()).toBe(0);
  });

  it('cancel after the switch keeps an edit another transaction committed between two gesture samples', async () => {
    useTimelineStore.setState({ clips: [...timeline().clips, createMockClip({ id: 'clip-b', trackId: 'video-1', file: undefined, name: 'B' })] });
    const repo = await installRepository();
    const start = repo.mirroredOpacity();
    const sheet = gesture('Phone sheet', true);
    // A sample that also sets a non-preview field is encoded in full; the gesture encodes every later sample too.
    sheet.sample(() => useTimelineStore.setState({ selectedClipIds: new Set(['clip-a']),
      clips: timeline().clips.map(clip => clip.id === 'clip-a' ? { ...clip, transform: { ...clip.transform, opacity: 0.3 } } : clip) }));
    // Outside the sheet: its own committed revision.
    timeline().updateClip('clip-b', { name: 'from T' });
    sheet.sample(() => setOpacity(0.4));
    await navigateEditorComposition('other');
    expect(() => sheet.cancel()).not.toThrow();
    expect(await repo.savedRevisions()).toBe(1);
    expect(repo.savedClip('clip-b').name).toBe('from T');
    expect(repo.mirroredClip('clip-b')?.name).toBe('from T');
    expect(repo.savedOpacity()).toBe(start);
    expect(repo.mirroredOpacity()).toBe(start);
  });

  it('keeps the preview fast path for samples in the composition the gesture switched to', async () => {
    useTimelineStore.setState({ clips: [solidClip('clip-a')] });
    const repo = await installRepository([solidClip('clip-o')]);
    const sheet = gesture('Phone sheet', true);
    for (let i = 1; i <= 3; i++) sheet.sample(() => setOpacity(i / 10));
    await navigateEditorComposition('other');
    expect(timeline().clips.map(clip => clip.id)).toEqual(['clip-o']);
    const write = vi.spyOn(repo.coordinator, 'write');
    for (let i = 1; i <= 5; i++) sheet.sample(() => setOpacity(i / 10, 'clip-o'));
    expect(write).not.toHaveBeenCalled();
    expect(() => sheet.release()).not.toThrow();
    expect(await repo.savedRevisions()).toBe(1);
    expect(repo.savedOpacity()).toBe(0.3);
    expect(repo.savedClip('clip-o', 'other').transform?.opacity).toBe(0.5);
  });

  for (const finish of ['release', 'cancel'] as const) {
    it(`A -> B -> A during an open gesture: ${finish} after returning to the edited composition`, async () => {
      useTimelineStore.setState({ clips: [solidClip('clip-a')] });
      const repo = await installRepository();
      const start = repo.mirroredOpacity();
      const sheet = gesture('Phone sheet', true);
      for (let i = 1; i <= 4; i++) sheet.sample(() => setOpacity(i / 10));
      await navigateEditorComposition('other');
      await navigateEditorComposition('main');
      // The returned composition is rebuilt from its projection, with the gesture's value.
      expect(timeline().clips.map(clip => clip.transform.opacity)).toEqual([0.4]);
      Logger.setLevel('INFO');
      const off = logged('Gesture preview off');
      try {
        for (let i = 5; i <= 8; i++) sheet.sample(() => setOpacity(i / 10));
        // Back in a composition the gesture already wrote, the samples are encoded; that is said once.
        expect(logged('Gesture preview off')).toBe(off + 1);
      } finally { Logger.setLevel('WARN'); }
      expect(() => sheet[finish]()).not.toThrow();
      const expected = finish === 'release' ? 0.8 : start;
      expect(await repo.savedRevisions()).toBe(finish === 'release' ? 1 : 0);
      expect(repo.savedOpacity()).toBe(expected);
      expect(repo.mirroredOpacity()).toBe(expected);
      expect(timeline().clips.map(clip => clip.transform.opacity)).toEqual([expected]);
    });
  }
});
