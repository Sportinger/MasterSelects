import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real stores and a real repository coordinator: transaction membership only exists there.
vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(), establishTimelineCompositionSaveBaseline: vi.fn(),
}));

/** What the next synthetic tool call does while it awaits (set per test). */
interface ToolScript { duringAwait?: () => Promise<void> | void; succeed: boolean; name: string; before: string; after: string }
const scripts: ToolScript[] = [];
// createTrack stands in for any modifying tool that writes after an await: it renames one track before and
// one after its await (the later one bound explicitly), lets the test act during the await, then reports.
// Tools touch different tracks, so overlapping calls never contend for one entity.
vi.mock('../../src/services/aiTools/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/aiTools/handlers')>();
  const { useTimelineStore } = await import('../../src/stores/timeline');
  const { captureToolTransaction } = await import('../../src/services/aiTools/toolTransaction');
  return { ...actual, executeToolInternal: vi.fn(async (toolName: string, ...rest: unknown[]) => {
    if (toolName !== 'createTrack') return (actual.executeToolInternal as (...args: unknown[]) => Promise<unknown>)(toolName, ...rest);
    const script = scripts.shift()!;
    const transaction = captureToolTransaction(toolName);
    useTimelineStore.getState().renameTrack(script.before, `${script.name} before`);
    await new Promise(resolve => setTimeout(resolve, 0));
    await script.duringAwait?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    transaction.run(() => useTimelineStore.getState().renameTrack(script.after, `${script.name} after`));
    return script.succeed ? { success: true } : { success: false, error: `${script.name} failed` };
  }) };
});

import { executeAITool } from '../../src/services/aiTools';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import { initHistoryStoreRefs, setHistoryCallbacks, useHistoryStore } from '../../src/stores/historyStore';
import { createMockTrack } from '../helpers/mockData';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type LogicalRevision } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { installEditorRepositorySession } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import { installEditorGestureEvents } from '../../src/services/project/repository/transaction/editorGestureOwnership';
import { runEditorBackgroundWrite } from '../../src/services/project/repository/transaction/editorTransactionBinding';
import { encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { EntityDTO } from '../../src/services/project/repository/contracts';
import type { Composition } from '../../src/stores/mediaStore/types';

const initialTimeline = useTimelineStore.getState();
const initialMedia = useMediaStore.getState();
let repositoryCleanup: (() => void) | undefined;

async function installRepository() {
  const owner: Composition = { id: 'composition', name: 'Test composition', type: 'composition', parentId: null, createdAt: 0,
    width: 1920, height: 1080, frameRate: 25, duration: 5, backgroundColor: '#000',
    timelineData: createSerializableTimelineState(useTimelineStore.getState()) };
  useMediaStore.setState({ files: [], compositions: [owner], activeCompositionId: owner.id });
  const encoded = encodeProjectDomains({ version: 1, name: 'Explicit tool transactions', createdAt: '2026-10-27', updatedAt: '2026-10-27',
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
  const coordinator = new ProjectTransactionCoordinator('explicit-tool-transactions', 'editor', storage, { canActivate: () => true, activate: async () => {} });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  const session = { opening: { writable: true }, coordinator, updateView: async () => 1 } as unknown as RepositorySession;
  repositoryCleanup = installEditorRepositorySession(session);
  const sources = async () => { await coordinator.flush(); return revisions.slice(1).map(revision => revision.source); };
  return { coordinator, sources, revisionsAfterSeed: () => revisions.slice(1) };
}

const trackNames = () => useTimelineStore.getState().tracks.map(track => track.name);
const renameBase = (name: string) => useTimelineStore.getState().renameTrack('video-1', name);
const SEED_NAMES = ['V1', 'V2', 'V3', 'V4', 'V5'];
const runTool = (name: string, succeed: boolean, duringAwait: ToolScript['duringAwait'],
  options: { caller?: 'chat' | 'devBridge'; requestId?: string; tracks?: [string, string] } = {}) => {
  const [before, after] = options.tracks ?? ['video-2', 'video-3'];
  scripts.push({ name, succeed, duringAwait, before, after });
  return executeAITool('createTrack', { type: 'video' }, options.caller ?? 'chat', {
    guidedReplay: false, ...(options.requestId ? { agentRequestId: options.requestId } : {}),
  });
};

beforeEach(() => {
  scripts.length = 0;
  useTimelineStore.setState({ clips: [], tracks: SEED_NAMES.map((name, index) => createMockTrack({ id: `video-${index + 1}`, name })),
    layers: [], clipKeyframes: new Map(), isExporting: false });
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

describe('a modifying tool binds exactly its own writes to its transaction', () => {
  it('a successful tool records its writes before and after the await as one revision of its request', async () => {
    const { sources } = await installRepository();
    const result = await runTool('Tool', true, undefined, { requestId: 'req-1' });
    expect(result).toMatchObject({ success: true });
    expect(trackNames()).toEqual(['V1', 'Tool before', 'Tool after', 'V4', 'V5']);
    expect(await sources()).toEqual(['agent-request:req-1']);
  });

  it('a failing tool rolls back only its own writes, including the one after its await', async () => {
    const { sources } = await installRepository();
    const result = await runTool('Tool', false, undefined);
    expect(result).toMatchObject({ success: false });
    expect(trackNames()).toEqual(SEED_NAMES);
    expect(await sources()).toEqual([]);
  });

  it('a background result during the await is its own background revision and survives a failing tool', async () => {
    const { sources, coordinator } = await installRepository();
    await runTool('Tool', false, () => runEditorBackgroundWrite('Proxy job', () => renameBase('Background result')));
    expect(trackNames()).toEqual(['Background result', 'V2', 'V3', 'V4', 'V5']);
    expect(await sources()).toEqual(['background']);
    // A background revision is never an Undo step.
    expect(await coordinator.getNavigationAvailability()).toMatchObject({ canUndo: false });
  });

  it('an untokened timer write during the await is not absorbed: its own revision, kept when the tool fails', async () => {
    const { sources } = await installRepository();
    await runTool('Tool', false, () => new Promise<void>(resolve => setTimeout(() => { renameBase('Timer'); resolve(); }, 0)));
    expect(trackNames()).toEqual(['Timer', 'V2', 'V3', 'V4', 'V5']);
    expect(await sources()).toEqual(['timeline']);
  });

  for (const type of ['drop', 'paste', 'dblclick'] as const) {
    it(`a user edit from a ${type} handler during the await stays its own Undo step, also when the tool fails`, async () => {
      const { sources, revisionsAfterSeed } = await installRepository();
      installEditorGestureEvents();
      const handler = () => renameBase(`User ${type}`);
      window.addEventListener(type, handler);
      try {
        await runTool('Tool', true, () => { window.dispatchEvent(new Event(type, { bubbles: true })); }, { requestId: 'req-ok' });
        expect(trackNames()).toEqual([`User ${type}`, 'Tool before', 'Tool after', 'V4', 'V5']);
        expect(await sources()).toEqual(['timeline', 'agent-request:req-ok']);
        const [userRevision, toolRevision] = revisionsAfterSeed();
        expect(userRevision!.changes.map(change => change.entityKey).join()).toContain('video-1');
        expect(toolRevision!.changes.map(change => change.entityKey).join()).not.toContain('video-1');

        window.removeEventListener(type, handler);
        const second = () => renameBase(`Again ${type}`);
        window.addEventListener(type, second);
        try {
          await runTool('Failing', false, () => { window.dispatchEvent(new Event(type, { bubbles: true })); }, { tracks: ['video-4', 'video-5'] });
        } finally { window.removeEventListener(type, second); }
        expect(trackNames()).toEqual([`Again ${type}`, 'Tool before', 'Tool after', 'V4', 'V5']);
        expect(await sources()).toEqual(['timeline', 'agent-request:req-ok', 'timeline']);
      } finally {
        window.removeEventListener(type, handler);
      }
    });
  }

  it('an overlapping devBridge tool and a chat request keep separate steps', async () => {
    const { sources, revisionsAfterSeed } = await installRepository();
    let chat: Promise<unknown> | undefined;
    const bridge = runTool('Bridge', true, () => {
      chat = runTool('Chat', true, undefined, { requestId: 'req-2', tracks: ['video-4', 'video-5'] }); return chat as Promise<void>;
    }, { caller: 'devBridge' });
    await bridge; await chat;
    expect(trackNames()).toEqual(['V1', 'Bridge before', 'Bridge after', 'Chat before', 'Chat after']);
    expect(await sources()).toEqual(['agent-request:req-2', 'agent']);
    const names = (index: number) => JSON.stringify(revisionsAfterSeed()[index]!.changes.map(change => change.after));
    expect(names(0)).toContain('Chat after');
    expect(names(0)).not.toContain('Bridge');
    expect(names(1)).toContain('Bridge after');
    expect(names(1)).not.toContain('Chat');
  });

  it('a failing devBridge tool does not take an overlapping chat request\'s result with it', async () => {
    const { sources } = await installRepository();
    let chat: Promise<unknown> | undefined;
    const bridge = runTool('Bridge', false, () => {
      chat = runTool('Chat', true, undefined, { requestId: 'req-3', tracks: ['video-4', 'video-5'] }); return chat as Promise<void>;
    }, { caller: 'devBridge' });
    expect(await bridge).toMatchObject({ success: false });
    expect(await chat).toMatchObject({ success: true });
    expect(trackNames()).toEqual(['V1', 'V2', 'V3', 'Chat before', 'Chat after']);
    expect(await sources()).toEqual(['agent-request:req-3']);
  });
});
