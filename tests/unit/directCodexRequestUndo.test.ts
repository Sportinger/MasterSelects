import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real stores and a real repository coordinator: the split revisions only exist there.
vi.unmock('../../src/stores/mediaStore');
vi.unmock('../../src/services/fileSystemService');
vi.mock('../../src/stores/mediaStore/init', () => ({
  triggerTimelineSave: vi.fn(), establishTimelineCompositionSaveBaseline: vi.fn(),
}));

import { sendFlashBoardChatMessage } from '../../src/services/flashboard/FlashBoardChatService';
import { resetDirectCodexSession } from '../../src/services/flashboard/FlashBoardDirectCodexTransport';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import { useDocumentsStore } from '../../src/stores/documentsStore';
import { initHistoryStoreRefs, setHistoryCallbacks, useHistoryStore } from '../../src/stores/historyStore';
import { createMockTrack } from '../helpers/mockData';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type LogicalRevision } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { installEditorRepositorySession } from '../../src/services/project/repository/transaction/editorMutationRuntime';
import { isAgentRequestRevisionSource } from '../../src/services/project/repository/transaction/historyNavigationPlan';
import { encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { createSerializableTimelineState } from '../../src/stores/timeline/serialization/serializableTimelineState';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { EntityDTO } from '../../src/services/project/repository/contracts';
import type { Composition } from '../../src/stores/mediaStore/types';

/**
 * Production defect (3.3.5, phone assistant, model Slow = Codex Direct): 'Add a title that says
 * "Hallo Berlin" at the start of the timeline.' left one title clip and about six Undo steps behind.
 * createTextClip writes the clip after an await (canvas runtime), and a scene stream stores its scene
 * document with four more writes; none of them joined the request's revision. This drives the real
 * Direct transport with a canned Codex app-server conversation over a fake socket.
 */

const initialTimeline = useTimelineStore.getState();
const initialMedia = useMediaStore.getState();
const initialDocuments = useDocumentsStore.getState();
let repositoryCleanup: (() => void) | undefined;
const realWebSocket = globalThis.WebSocket;
const realFetch = globalThis.fetch;

async function installRepository() {
  const owner: Composition = { id: 'composition', name: 'Test composition', type: 'composition', parentId: null, createdAt: 0,
    width: 1920, height: 1080, frameRate: 25, duration: 5, backgroundColor: '#000',
    timelineData: createSerializableTimelineState(useTimelineStore.getState()) };
  useMediaStore.setState({ files: [], compositions: [owner], activeCompositionId: owner.id });
  const encoded = encodeProjectDomains({ version: 1, name: 'Direct request undo', createdAt: '2026-10-27', updatedAt: '2026-10-27',
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
  const coordinator = new ProjectTransactionCoordinator('direct-request-undo', 'editor', storage, { canActivate: () => true, activate: async () => {} });
  const seed = coordinator.begin('Initial project', 'import');
  for (const [key, entity] of encoded.entities) coordinator.write(seed, key, entity);
  await coordinator.flush(coordinator.commit(seed).receipt);
  const session = { opening: { writable: true }, coordinator, updateView: async () => 1 } as unknown as RepositorySession;
  repositoryCleanup = installEditorRepositorySession(session);
  return { coordinator, seedRevision: coordinator.getStatus().revisionId, revisionsAfterSeed: () => revisions.slice(1) };
}

type Frame = Record<string, unknown>;
type ToolStep = { tool: string; arguments: Record<string, unknown> };

/** A Codex app-server speaking the JSON-RPC the Direct transport handles: tool calls first, then the streamed answer. */
function installFakeCodex(script: { calls: ToolStep[]; answerDeltas: string[] }) {
  const toolResults: Array<{ tool: string; success: boolean }> = [];
  class FakeCodexSocket extends EventTarget {
    static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
    readyState = 0;
    private serverId = 0;
    private readonly waiting = new Map<string, (frame: Frame) => void>();
    constructor(readonly url: string) {
      super();
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }, 0);
    }
    private emit(frame: Frame): Promise<void> {
      // Real frames arrive as separate network tasks.
      return new Promise(resolve => setTimeout(() => {
        if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
        resolve();
      }, 0));
    }
    private request(method: string, params: Frame): Promise<Frame> {
      const id = `srv-${++this.serverId}`;
      return new Promise(resolve => { this.waiting.set(id, resolve); void this.emit({ id, method, params }); });
    }
    private async runTurn(threadId: string, turnId: string): Promise<void> {
      for (const [index, call] of script.calls.entries()) {
        const reply = await this.request('item/tool/call', { threadId, turnId, callId: `${turnId}-call-${index + 1}`, tool: call.tool, arguments: call.arguments });
        toolResults.push({ tool: call.tool, success: (reply.result as { success?: boolean } | undefined)?.success === true });
      }
      for (const delta of script.answerDeltas) await this.emit({ method: 'item/agentMessage/delta', params: { threadId, turnId, delta } });
      await this.emit({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', text: script.answerDeltas.join('') } } });
      await this.emit({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
    }
    send(raw: string): void {
      const message = JSON.parse(raw) as Frame & { id?: string | number; method?: string; params?: Frame };
      if (message.method === undefined && message.id !== undefined) {
        this.waiting.get(String(message.id))?.(message); this.waiting.delete(String(message.id)); return;
      }
      if (message.id === undefined) return;
      if (message.method === 'thread/start') { void this.emit({ id: message.id, result: { thread: { id: 'thread-1' } } }); return; }
      if (message.method === 'turn/start') {
        void this.emit({ id: message.id, result: { turn: { id: 'turn-1' } } }).then(() => this.runTurn('thread-1', 'turn-1'));
        return;
      }
      void this.emit({ id: message.id, result: {} });
    }
    close(): void { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  globalThis.WebSocket = FakeCodexSocket as unknown as typeof WebSocket;
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ session: { authenticated: true } }), { status: 200 })) as typeof fetch;
  return { toolResults };
}

const PROMPT = 'Add a title that says "Hallo Berlin" at the start of the timeline.';
const textClips = () => useTimelineStore.getState().clips.filter(clip => clip.source?.type === 'text');

async function runCannedRequest(script: { calls: ToolStep[]; answerDeltas: string[] }) {
  const repository = await installRepository();
  const fake = installFakeCodex(script);
  const answer = await sendFlashBoardChatMessage({ prompt: PROMPT, agentPath: 'direct-codex', conversationRef: `undo-${Math.random()}` } as Parameters<typeof sendFlashBoardChatMessage>[0]);
  await repository.coordinator.flush();
  return { ...repository, ...fake, answer };
}

async function expectOneUndoStep({ coordinator, seedRevision, revisionsAfterSeed }: Awaited<ReturnType<typeof runCannedRequest>>) {
  const revisions = revisionsAfterSeed();
  expect(revisions.length).toBeGreaterThan(0);
  // Every revision of the request carries the request's group, so Undo/Redo treat them as one step.
  expect(revisions.map(revision => revision.source).filter(source => !isAgentRequestRevisionSource(source))).toEqual([]);
  expect(new Set(revisions.map(revision => revision.source)).size).toBe(1);
  const after = new Map(coordinator.getEntities());
  const seedEntities = await (coordinator as unknown as { storage: CoordinatorStorage }).storage.loadProjection(seedRevision!, new AbortController().signal);

  expect((await coordinator.undo())?.status).toBe('applied');
  expect(coordinator.getStatus().revisionId).toBe(seedRevision);
  expect(new Map(coordinator.getEntities())).toEqual(new Map(seedEntities));
  expect(await coordinator.getNavigationAvailability()).toEqual({ canUndo: false, canRedo: true });

  expect((await coordinator.redoRevision())?.status).toBe('applied');
  expect(coordinator.getStatus().revisionId).toBe(revisions.at(-1)!.revisionId);
  expect(new Map(coordinator.getEntities())).toEqual(after);
}

beforeEach(() => {
  resetDirectCodexSession();
  useTimelineStore.setState({ clips: [], tracks: [createMockTrack({ id: 'video-1' })], layers: [], clipKeyframes: new Map(), isExporting: false, playheadPosition: 3 });
  initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: () => {} }, dock: { getState: useDockStore.getState, setState: () => {} } });
  setHistoryCallbacks({ flushPendingCapture: () => {}, suppressCaptures: () => {} });
  useHistoryStore.setState({ batchId: null, batchLabel: null, isApplying: false });
  useHistoryStore.getState().clearHistory();
});
afterEach(() => {
  repositoryCleanup?.(); repositoryCleanup = undefined;
  globalThis.WebSocket = realWebSocket; globalThis.fetch = realFetch;
  useHistoryStore.getState().clearHistory(); useTimelineStore.setState(initialTimeline); useMediaStore.setState(initialMedia);
  useDocumentsStore.setState(initialDocuments, true);
});

describe('Codex Direct: one assistant request is one Undo step', () => {
  it('a createTextClip tool call (its clip lands after an await) is one revision of the request; Undo restores, Redo returns it', async () => {
    const run = await runCannedRequest({
      calls: [
        { tool: 'getTimelineState', arguments: {} },
        { tool: 'createTextClip', arguments: { text: 'Hallo Berlin', startTime: 0, duration: 5 } },
        { tool: 'getTimelineState', arguments: {} },
      ],
      answerDeltas: ['Added the title "Hallo Berlin" at 0 s.'],
    });
    expect(run.toolResults).toEqual([{ tool: 'getTimelineState', success: true }, { tool: 'createTextClip', success: true }, { tool: 'getTimelineState', success: true }]);
    expect(textClips().map(clip => [clip.textProperties?.text, clip.startTime])).toEqual([['Hallo Berlin', 0]]);
    await expectOneUndoStep(run);
  });

  it('a streamed ms-scene-v1 title (record plus scene document) is one Undo step with the tool calls', async () => {
    const records = [
      '{"op":"begin","schemaVersion":1,"scene":"Title"}',
      '{"op":"tool","seq":1,"ref":"title","tool":"createTextClip","args":{"trackId":"video-1","text":"Hallo Berlin","startTime":0,"duration":5}}',
      '{"op":"end","lastSeq":1}',
    ];
    const run = await runCannedRequest({
      calls: [
        { tool: 'getTimelineState', arguments: {} },
        { tool: 'getStreamProtocol', arguments: { format: 'ms-scene-v1' } },
        { tool: 'getTimelineState', arguments: {} },
      ],
      // Streamed in pieces, as the provider does.
      answerDeltas: ['Adding the title.\n```ms-scene-v1\n', `${records[0]}\n${records[1].slice(0, 40)}`, `${records[1].slice(40)}\n${records[2]}\n`, '```\nDone.'],
    });
    expect(textClips().map(clip => [clip.textProperties?.text, clip.startTime])).toEqual([['Hallo Berlin', 0]]);
    expect(useDocumentsStore.getState().documents.some(doc => doc.title.includes('Title'))).toBe(true);
    await expectOneUndoStep(run);
  });
});
