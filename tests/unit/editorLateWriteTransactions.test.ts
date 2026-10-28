import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real stores and a real repository coordinator: transaction membership only exists there.
vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(), establishTimelineCompositionSaveBaseline: vi.fn(),
}));

import { executeAITool } from '../../src/services/aiTools';
import { captureToolTransaction } from '../../src/services/aiTools/toolTransaction';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import { initHistoryStoreRefs, setHistoryCallbacks, useHistoryStore } from '../../src/stores/historyStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { Logger } from '../../src/services/logger';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type LogicalRevision } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { beginEditorTransaction, cancelEditorTransaction, installEditorRepositorySession, runEditorBatch,
  runEditorTransaction } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import { captureEditorAsyncMutation } from '../../src/services/project/repository/transaction/editorAsyncMutation';
import { captureEditorTransactionBinding, runEditorBackgroundWrite } from '../../src/services/project/repository/transaction/editorTransactionBinding';
import { encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { EntityDTO } from '../../src/services/project/repository/contracts';
import type { Composition, MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/types';

const initialTimeline = useTimelineStore.getState();
const initialMedia = useMediaStore.getState();
let repositoryCleanup: (() => void) | undefined;

/** A real coordinator over in-memory storage; `access.owned = false` makes the project read-only. */
async function installRepository(files: MediaFile[] = []) {
  const owner: Composition = { id: 'composition', name: 'Test composition', type: 'composition', parentId: null, createdAt: 0,
    width: 1920, height: 1080, frameRate: 25, duration: 30, backgroundColor: '#000',
    timelineData: createSerializableTimelineState(useTimelineStore.getState()) };
  useMediaStore.setState({ files, compositions: [owner], activeCompositionId: owner.id });
  const encoded = encodeProjectDomains({ version: 1, name: 'Late writes', createdAt: '2026-10-28', updatedAt: '2026-10-28',
    settings: { width: 1920, height: 1080, frameRate: 25, sampleRate: 48000 }, media: [], folders: [],
    compositions: convertCompositions([owner]), activeCompositionId: owner.id, openCompositionIds: [owner.id], expandedFolderIds: [] });
  const revisions: LogicalRevision[] = [];
  const access = { owned: true };
  const storage = {
    publishRevision: async (revision: LogicalRevision) => { revisions.push(revision); },
    publishNavigation: async () => {}, publishMetadata: async () => {}, publishJournal: async () => {},
    loadProjection: async () => new Map<string, EntityDTO>(), getRevision: async () => null,
    getRedoChild: async () => null, flushViews: async () => {},
    assertOwned: () => { if (!access.owned) throw new Error('This project is open read-only in another tab'); },
  } as unknown as CoordinatorStorage;
  const coordinator = new ProjectTransactionCoordinator('late-writes', 'editor', storage, { canActivate: () => true, activate: async () => {} });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  const session = { opening: { writable: true }, coordinator, updateView: async () => 1 } as unknown as RepositorySession;
  repositoryCleanup = installEditorRepositorySession(session);
  let notifications = 0;
  coordinator.subscribe(() => { notifications++; });
  const sources = async () => { await coordinator.flush(); return revisions.slice(1).map(revision => revision.source); };
  const setActivating = (value: boolean) => { (coordinator as unknown as { activating: boolean }).activating = value; };
  return { coordinator, access, sources, setActivating, notifications: () => notifications };
}

const trackNames = () => useTimelineStore.getState().tracks.map(track => track.name);
const rename = (id: string, name: string) => useTimelineStore.getState().renameTrack(id, name);
const SEED_NAMES = ['V1', 'V2', 'V3'];
const warnings = (text: string) => Logger.search(text).filter(entry => entry.level === 'WARN');

beforeEach(() => {
  Logger.clear();
  useTimelineStore.setState({ clips: [], tracks: [...SEED_NAMES.map((name, index) => createMockTrack({ id: `video-${index + 1}`, name })),
    createMockTrack({ id: 'audio-1', name: 'A1', type: 'audio' })], layers: [], clipKeyframes: new Map(), isExporting: false });
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

describe('background writes open a transaction only for content and never throw into the job', () => {
  it('a runtime-only write (job progress) opens, commits and announces nothing', async () => {
    const { sources, notifications } = await installRepository();
    const before = notifications();
    runEditorBackgroundWrite('Proxy job', () => useTimelineStore.setState({ isExporting: true }));
    expect(useTimelineStore.getState().isExporting).toBe(true);
    expect(notifications()).toBe(before);
    expect(await sources()).toEqual([]);
  });

  it('a runtime-only write succeeds in a read-only project and during Undo/Redo activation', async () => {
    const { access, setActivating } = await installRepository();
    access.owned = false;
    expect(() => runEditorBackgroundWrite('Proxy job', () => useTimelineStore.setState({ isExporting: true }))).not.toThrow();
    access.owned = true;
    setActivating(true);
    expect(() => runEditorBackgroundWrite('Proxy job', () => useTimelineStore.setState({ isExporting: false }))).not.toThrow();
    setActivating(false);
    expect(useTimelineStore.getState().isExporting).toBe(false);
  });

  it('a content result while the project cannot take writes is shown, not saved, and logged', async () => {
    const { access, sources, setActivating } = await installRepository();
    access.owned = false;
    expect(() => runEditorBackgroundWrite('Scene description', () => rename('video-1', 'Read-only result'))).not.toThrow();
    expect(trackNames()[0]).toBe('Read-only result');
    expect(warnings('Scene description')[0]?.message).toContain('not saved');
    access.owned = true;
    setActivating(true);
    expect(() => runEditorBackgroundWrite('Clip analysis', () => rename('video-2', 'During activation'))).not.toThrow();
    setActivating(false);
    expect(trackNames().slice(0, 2)).toEqual(['Read-only result', 'During activation']);
    expect(await sources()).toEqual([]);
    // Once writable again, a background content result is its own saved background revision.
    runEditorBackgroundWrite('Clip analysis', () => rename('video-3', 'Saved'));
    expect(await sources()).toEqual(['background']);
  });

  it('a user edit in a read-only project still fails loudly', async () => {
    const { access } = await installRepository();
    access.owned = false;
    expect(() => rename('video-1', 'User edit')).toThrow(/read-only/);
    expect(trackNames()[0]).toBe('V1');
  });

  it('a background write inside an open user batch stays out of it and begins its own revision only for content', async () => {
    const { sources } = await installRepository();
    await expect(runEditorBatch('Look sheet', async () => {
      rename('video-1', 'Sheet');
      runEditorBackgroundWrite('Proxy job', () => {
        useTimelineStore.setState({ layers: [] });
        rename('video-2', 'Background');
      });
      throw new Error('Sheet cancelled');
    })).rejects.toThrow('Sheet cancelled');
    expect(trackNames().slice(0, 2)).toEqual(['V1', 'Background']);
    expect(await sources()).toEqual(['background']);
  });
});

describe('a captured binding writes only into the project it was captured in', () => {
  it('a write after another project was opened during the await is refused, a late result dropped', async () => {
    await installRepository();
    const binding = captureEditorTransactionBinding('Add text clip', { fallbackSource: 'timeline' });
    repositoryCleanup?.();
    const second = await installRepository();
    expect(() => binding.run(() => rename('video-1', 'Leaked text'))).toThrow(/no longer open/);
    expect(binding.runLate(() => rename('video-2', 'Leaked waveform'))).toBeUndefined();
    expect(trackNames().slice(0, 2)).toEqual(['V1', 'V2']);
    expect(await second.sources()).toEqual([]);
  });

  it('in the same project a write after the await forms its own revision', async () => {
    const { sources } = await installRepository();
    const binding = captureEditorTransactionBinding('Add text clip', { fallbackSource: 'timeline' });
    binding.run(() => rename('video-1', 'Text'));
    expect(await sources()).toEqual(['timeline']);
  });
});

describe('a late tool write after its transaction closed is its own assistant step', () => {
  it('it never joins a user batch that is open then, so cancelling the batch keeps it', async () => {
    const { sources } = await installRepository();
    const token = beginEditorTransaction('Timed-out tool', 'agent');
    const tool = runEditorTransaction(token, () => captureToolTransaction('Timed-out tool'));
    cancelEditorTransaction(token);
    await expect(runEditorBatch('Look sheet', async () => {
      rename('video-1', 'Sheet');
      tool.bindStore(useTimelineStore.getState()).renameTrack('video-2', 'Late tool write');
      throw new Error('Sheet cancelled');
    })).rejects.toThrow('Sheet cancelled');
    expect(trackNames().slice(0, 2)).toEqual(['V1', 'Late tool write']);
    expect(await sources()).toEqual(['agent']);
    expect(warnings('Timed-out tool')).toHaveLength(1);
  });
});

describe('addClipSegment writes after its await stay in the tool or batch transaction', () => {
  const media = { id: 'tone', name: 'Tone.wav', type: 'audio', file: new File(['x'], 'tone.wav'), duration: 20 } as unknown as MediaFile;
  beforeEach(() => {
    // Stands in for the real addClip: it captures the caller's transaction synchronously and writes after an await.
    useTimelineStore.setState({ addClip: (async (trackId: string, _file: File, startTime: number, duration: number, mediaFileId?: string) => {
      const mutation = captureEditorAsyncMutation('Add clip');
      await Promise.resolve();
      const clip = createMockClip({ id: 'inserted', trackId, startTime, duration, inPoint: 0, outPoint: duration, mediaFileId,
        source: { type: 'audio', mediaFileId, naturalDuration: 20 } as TimelineClip['source'] });
      mutation.run(() => useTimelineStore.setState(state => ({ clips: [...state.clips, clip] })));
    }) as never });
  });
  const segment = { mediaFileId: 'tone', trackId: 'audio-1', startTime: 0, inPoint: 2, outPoint: 4 };
  const expectTrimmedWithDeClick = () => {
    const clip = useTimelineStore.getState().clips.find(item => item.id === 'inserted');
    expect(clip).toMatchObject({ inPoint: 2, outPoint: 4 });
    expect(clip?.audioState?.editStack?.length).toBeGreaterThan(0);
  };

  it('inside executeBatch the trim and de-click join the batch: one revision of the request', async () => {
    const { sources } = await installRepository([media]);
    const result = await executeAITool('executeBatch', { actions: [{ tool: 'addClipSegment', args: segment }] }, 'chat',
      { guidedReplay: false, agentRequestId: 'req-1' });
    expect(result).toMatchObject({ success: true });
    expectTrimmedWithDeClick();
    expect(await sources()).toEqual(['agent-request:req-1']);
  });

  it('as a single tool call the trim and de-click join the tool transaction', async () => {
    const { sources } = await installRepository([media]);
    const result = await executeAITool('addClipSegment', segment, 'chat', { guidedReplay: false, agentRequestId: 'req-2' });
    expect(result).toMatchObject({ success: true });
    expectTrimmedWithDeClick();
    expect(await sources()).toEqual(['agent-request:req-2']);
  });
});
