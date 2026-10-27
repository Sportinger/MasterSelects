import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real stores, the real phone edit session and a real repository coordinator: what a cancel takes back can
// only be judged against the committed revisions of the other transactions.
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
import { beginEditorTransaction, cancelEditorTransaction, installEditorRepositorySession, runEditorBatch, runEditorTransaction } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import { runEditorBackgroundWrite } from '../../src/services/project/repository/transaction/editorTransactionBinding';
import { runAgentRequestWrites } from '../../src/services/aiTools/agentTransaction';
import { createPhoneEditSession } from '../../src/components/mobileSkin/sheets/phoneEditSession';
import { encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { entityKey } from '../../src/services/project/repository/domains/jsonBoundary';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { EntityDTO } from '../../src/services/project/repository/contracts';
import type { Composition, MediaFile } from '../../src/stores/mediaStore/types';

const initialTimeline = useTimelineStore.getState();
const initialMedia = useMediaStore.getState();
let repositoryCleanup: (() => void) | undefined;
const COMPOSITION = 'composition';

async function installRepository() {
  const owner: Composition = { id: COMPOSITION, name: 'Test composition', type: 'composition', parentId: null, createdAt: 0,
    width: 1920, height: 1080, frameRate: 25, duration: 10, backgroundColor: '#000',
    timelineData: createSerializableTimelineState(useTimelineStore.getState()) };
  useMediaStore.setState({ compositions: [owner], activeCompositionId: owner.id });
  const encoded = encodeProjectDomains({ version: 1, name: 'Cancel keeps other revisions', createdAt: '2026-10-27', updatedAt: '2026-10-27',
    settings: { width: 1920, height: 1080, frameRate: 25, sampleRate: 48000 }, media: [], folders: [],
    compositions: convertCompositions([owner]), activeCompositionId: owner.id, openCompositionIds: [owner.id], expandedFolderIds: [] });
  const revisions: LogicalRevision[] = [];
  const projections = new Map<string, ReadonlyMap<string, EntityDTO>>();
  const storage = {
    publishRevision: async (revision: LogicalRevision) => {
      const entities = new Map(revision.parentRevisionId ? projections.get(revision.parentRevisionId) : []);
      for (const change of revision.changes) {
        if (change.after) entities.set(change.entityKey, change.after); else entities.delete(change.entityKey);
      }
      revisions.push(revision); projections.set(revision.revisionId, entities);
    },
    publishNavigation: async () => {}, publishMetadata: async () => {}, publishJournal: async () => {},
    loadProjection: async (id: string) => projections.get(id) ?? new Map(), getRevision: async () => null,
    getRedoChild: async () => null, flushViews: async () => {}, assertOwned: () => {},
  } as unknown as CoordinatorStorage;
  const coordinator = new ProjectTransactionCoordinator('cancel-keeps-other-revisions', 'editor', storage, { canActivate: () => true, activate: async () => {} });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  const session = { opening: { writable: true }, coordinator, updateView: async () => 1 } as unknown as RepositorySession;
  repositoryCleanup = installEditorRepositorySession(session);
  const sources = async () => { await coordinator.flush(); return revisions.slice(1).map(revision => revision.source); };
  /** Clip ids the repository holds for the composition: the store must show exactly these after any cancel. */
  const repositoryClipIds = () => [...coordinator.getEntities().keys()]
    .filter(key => key.startsWith(`${entityKey('clip', COMPOSITION, '')}`) && key.split('/').length === 3)
    .map(key => decodeURIComponent(key.split('/')[2]!)).sort();
  const repositoryText = (key: string) => JSON.stringify(coordinator.getEntities().get(key)?.value ?? null);
  return { coordinator, sources, repositoryClipIds, repositoryText };
}

const SEED_NAMES = ['V1', 'V2', 'V3'];
const trackNames = () => useTimelineStore.getState().tracks.map(track => track.name);
const storeClipIds = () => useTimelineStore.getState().clips.map(clip => clip.id).toSorted();
const opacity = (id: string) => useTimelineStore.getState().clips.find(clip => clip.id === id)?.transform.opacity;
const setOpacity = (id: string, value: number) => useTimelineStore.getState().updateClipTransform(id, { opacity: value });
const textClip = () => createMockClip({ id: 'clip-text', name: 'Hallo Berlin', trackId: 'video-2', startTime: 5, file: undefined });
/** An assistant request's committed revision: adds a title clip (or renames a track) in its own transaction. */
const agentAddsTitle = () => runAgentRequestWrites('Add a title', 'req-title', () => {
  useTimelineStore.setState(state => ({ clips: [...state.clips, textClip()] }));
});
const agentRenames = (id: string, name: string) => runAgentRequestWrites('Rename track', 'req-rename', () => {
  useTimelineStore.getState().renameTrack(id, name);
});

beforeEach(() => {
  useTimelineStore.setState({
    clips: [createMockClip({ id: 'clip-a', trackId: 'video-1', file: undefined }), createMockClip({ id: 'clip-b', trackId: 'video-1', startTime: 5, file: undefined })],
    tracks: SEED_NAMES.map((name, index) => createMockTrack({ id: `video-${index + 1}`, name })),
    layers: [], clipKeyframes: new Map(), isExporting: false,
  });
  useMediaStore.setState({ files: [] });
  initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: () => {} }, dock: { getState: useDockStore.getState, setState: () => {} } });
  setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  useHistoryStore.setState({ batchId: null, batchLabel: null, isApplying: false });
  useHistoryStore.getState().clearHistory();
});
afterEach(() => {
  repositoryCleanup?.(); repositoryCleanup = undefined;
  useHistoryStore.getState().clearHistory(); useTimelineStore.setState(initialTimeline); useMediaStore.setState(initialMedia);
});

describe('cancelling a sheet or gesture takes back only its own writes', () => {
  it('R4: an assistant title added while the Adjust sheet is open survives the sheet\'s Cancel', async () => {
    const { sources, repositoryClipIds } = await installRepository();
    const sheet = createPhoneEditSession('Adjust', { onError: vi.fn() });
    await sheet.apply(() => setOpacity('clip-a', 0.2));
    agentAddsTitle();
    await sheet.apply(() => setOpacity('clip-a', 0.5));
    sheet.cancel(); await sheet.apply(() => {});
    await Promise.resolve();
    expect(opacity('clip-a')).toBe(1);
    expect(storeClipIds()).toEqual(['clip-a', 'clip-b', 'clip-text']);
    expect(storeClipIds()).toEqual(repositoryClipIds());
    expect(await sources()).toEqual(['agent-request:req-title']);
  });

  it('a title added between two sheet writes on the normal rollback path survives the Cancel (no merged whole-field restore)', async () => {
    const { repositoryClipIds } = await installRepository();
    const sheet = createPhoneEditSession('Edit', { onError: vi.fn() });
    // A write of clips together with another field skips the gesture preview: it takes the normal rollback path,
    // and the sheet's later clip writes follow it there.
    await sheet.apply(() => useTimelineStore.setState(state => ({
      clips: state.clips.map(clip => (clip.id === 'clip-a' ? { ...clip, transform: { ...clip.transform, opacity: 0.3 } } : clip)),
      selectedClipIds: new Set(['clip-a']),
    })));
    agentAddsTitle();
    await sheet.apply(() => setOpacity('clip-a', 0.5));
    sheet.cancel(); await sheet.apply(() => {});
    await Promise.resolve();
    expect(opacity('clip-a')).toBe(1);
    expect(storeClipIds()).toEqual(['clip-a', 'clip-b', 'clip-text']);
    expect(storeClipIds()).toEqual(repositoryClipIds());
  });

  it('P6: a track the assistant renamed between two sheet renames keeps its committed name after Cancel', async () => {
    const { repositoryText } = await installRepository();
    const sheet = createPhoneEditSession('Tracks', { onError: vi.fn() });
    await sheet.apply(() => useTimelineStore.getState().renameTrack('video-1', 'Sheet 1'));
    agentRenames('video-3', 'T2');
    await sheet.apply(() => useTimelineStore.getState().renameTrack('video-1', 'Sheet 2'));
    sheet.cancel(); await sheet.apply(() => {});
    await Promise.resolve();
    expect(trackNames()).toEqual(['V1', 'V2', 'T2']);
    expect(repositoryText(entityKey('track', COMPOSITION, 'video-3'))).toContain('T2');
    expect(repositoryText(entityKey('track', COMPOSITION, 'video-1'))).not.toContain('Sheet');
  });

  it('a cancelled gesture with many contiguous writes still returns to the state before it in one step', async () => {
    await installRepository();
    const token = beginEditorTransaction('Rename drag', 'gesture');
    for (let index = 0; index < 50; index += 1) runEditorTransaction(token, () => useTimelineStore.getState().renameTrack('video-2', `Drag ${index}`));
    cancelEditorTransaction(token);
    expect(trackNames()).toEqual(SEED_NAMES);
  });
});

describe('background job writes never join an open user batch or sheet', () => {
  const proxyFile = { id: 'file-1', name: 'a.mp4', type: 'video', parentId: null, createdAt: 0, url: '',
    proxyStatus: 'generating', proxyProgress: 0 } as unknown as MediaFile;
  const file = () => useMediaStore.getState().files.find(item => item.id === 'file-1');

  it('P10: proxy progress and status from worker callbacks during an async sheet change survive the Cancel', async () => {
    useMediaStore.setState({ files: [proxyFile] });
    await installRepository();
    const sheet = createPhoneEditSession('Tracks', { onError: vi.fn() });
    await sheet.apply(async () => {
      useTimelineStore.getState().renameTrack('video-1', 'Sheet');
      await new Promise(resolve => setTimeout(resolve, 0));
      // Worker callbacks report while the sheet's live change is still in flight (runtime.batch is the sheet).
      useMediaStore.getState().updateProxyProgress('file-1', 0.5);
      await useMediaStore.getState().setProxyStatus('file-1', 'ready');
    });
    sheet.cancel(); await sheet.apply(() => {});
    await Promise.resolve();
    expect(trackNames()).toEqual(SEED_NAMES);
    expect(file()).toMatchObject({ proxyStatus: 'ready', proxyProgress: 0.5 });
  });

  it('a proxy job result reported inside a failing runEditorBatch (Relink, Add media) stays committed', async () => {
    useMediaStore.setState({ files: [proxyFile] });
    await installRepository();
    await expect(runEditorBatch('Relink', async () => {
      useTimelineStore.getState().renameTrack('video-1', 'Batch');
      await new Promise(resolve => setTimeout(resolve, 0));
      useMediaStore.getState().updateProxyProgress('file-1', 0.75);
      throw new Error('relink failed');
    })).rejects.toThrow('relink failed');
    expect(trackNames()).toEqual(SEED_NAMES);
    expect(file()).toMatchObject({ proxyProgress: 0.75 });
  });

  it('an explicit background write nested in a store action of another transaction is its own revision', async () => {
    useMediaStore.setState({ files: [proxyFile] });
    const { sources } = await installRepository();
    const token = beginEditorTransaction('Sheet', 'gesture');
    runEditorTransaction(token, () => useTimelineStore.getState().renameTrack('video-1', 'Sheet'));
    // A store action running in the sheet's transaction writes a job result through runEditorBackgroundWrite.
    runEditorTransaction(token, () => useMediaStore.getState().updateProxyProgress('file-1', 0.25));
    runEditorTransaction(token, () => runEditorBackgroundWrite('Analysis', () => useTimelineStore.getState().renameTrack('video-3', 'Background')));
    cancelEditorTransaction(token);
    expect(trackNames()).toEqual(['V1', 'V2', 'Background']);
    expect(file()).toMatchObject({ proxyProgress: 0.25 });
    // Only background revisions: the cancelled sheet published nothing and took neither job write with it.
    expect(new Set(await sources())).toEqual(new Set(['background']));
  });
});
