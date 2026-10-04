import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real stores and a real repository coordinator: the ownership conflict only exists there.
vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(), establishTimelineCompositionSaveBaseline: vi.fn(),
}));
// A multi-step tool like manageEditableHook: one store edit, an await, then more edits.
vi.mock('../../src/services/aiTools/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/aiTools/handlers')>();
  return { ...actual, executeToolInternal: vi.fn(async (toolName: string, ...rest: unknown[]) => {
    if (!['manageEditableHook', 'executeBatch'].includes(toolName)) {
      return (actual.executeToolInternal as (...args: unknown[]) => Promise<unknown>)(toolName, ...rest);
    }
    const { useTimelineStore } = await import('../../src/stores/timeline');
    const trackId = useTimelineStore.getState().addTrack('video');
    await new Promise(resolve => setTimeout(resolve, 0));
    // Later steps edit what the first step created, as hooks do with their composition.
    useTimelineStore.getState().renameTrack(trackId, 'Hook');
    useTimelineStore.getState().addTrack('video');
    return { success: true };
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
  const encoded = encodeProjectDomains({ version: 1, name: 'Awaiting tool', createdAt: '2026-10-04', updatedAt: '2026-10-04',
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
  const coordinator = new ProjectTransactionCoordinator('awaiting-tool', 'editor', storage, { canActivate: () => true, activate: async () => {} });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  const session = { opening: { writable: true }, coordinator, updateView: async () => 1 } as unknown as RepositorySession;
  repositoryCleanup = installEditorRepositorySession(session);
  return { coordinator, revisionsAfterSeed: () => revisions.slice(1) };
}

beforeEach(() => {
  useTimelineStore.setState({ clips: [], tracks: [createMockTrack({ id: 'video-1' })], layers: [], clipKeyframes: new Map(), isExporting: false });
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

describe('AI tools that await between edits', () => {
  for (const [label, run] of [
    ['standalone call', () => executeAITool('manageEditableHook', { requestJson: '{}' }, 'kernel', { guidedReplay: false })],
    ['grouped kernel call', async () => (await import('../../src/services/aiTools')).executeAIToolCalls(
      [{ id: 'one', tool: 'manageEditableHook', args: { requestJson: '{}' } }], 'kernel', { guidedReplay: false })],
  ] as const) {
    it(`${label}: edits after an await join the tool's transaction as one revision`, async () => {
      const { coordinator, revisionsAfterSeed } = await installRepository();
      const outcome = await run();
      const result = Array.isArray(outcome) ? outcome[0]!.result : outcome;
      expect(result, JSON.stringify(result)).toMatchObject({ success: true });
      expect(useTimelineStore.getState().tracks.filter(track => track.type === 'video')).toHaveLength(3);
      expect(useTimelineStore.getState().tracks.some(track => track.name === 'Hook')).toBe(true);
      await coordinator.flush();
      expect(revisionsAfterSeed()).toHaveLength(1);
    });
  }
});
