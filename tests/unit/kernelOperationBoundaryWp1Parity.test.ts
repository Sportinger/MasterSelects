import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicOperationIdV1 } from '../../src/services/kernelClient/wp1Spike/publicOperationContracts';
import {
  executeCandidateTwoCompiledPlanV1,
  prepareCandidateTwoCompiledPlanV1,
  type CandidateTwoCompiledPlanV1,
} from '../../src/services/kernelClient/wp1Spike/candidateTwoCompiledPlanExecutor';
import { createWp1AgentTransactionAdapter } from '../../src/services/kernelClient/wp1Spike/agentTransactionAdapter';
import { createWp1EditorOperationAuthorization } from '../../src/services/kernelClient/wp1Spike/editorOperationDispatcher';
import { KernelOperationSessionAuthorityV1 } from '../../src/services/kernelClient/wp1Spike/operationSessionAuthority';
import { handleDeleteClips } from '../../src/services/aiTools/handlers/clips/delete';
import { handleSplitClipAtTimes } from '../../src/services/aiTools/handlers/clips/split';
import { getTimelineRevision } from '../../src/stores/timeline/revisionMiddleware';
import { isExclusiveTimelineMutationLeaseActive } from '../../src/stores/timeline/exclusiveMutationLease';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  cancelHistoryBatch,
  captureSnapshot,
  endBatch,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import {
  PUBLIC_COMPILED_PLAN_DIGEST_V1,
  PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
  fingerprintPublicTimelineStateV1,
} from '../../src/services/kernelClient/wp1Spike/publicOperationContracts';

type ClipKind = 'audio' | 'video';
type CanonicalClip = [string, ClipKind, number, number, number, number, number | null];

interface ParityFixtureV1 {
  schemaVersion: 1;
  caseId: string;
  initialTimeline: {
    tracks: Array<{ id: string; type: ClipKind }>;
    clips: Array<{
      duration: number;
      id: string;
      inPoint: number;
      linkedClipId?: string;
      outPoint: number;
      sourceId: string;
      startTime: number;
      trackId: string;
      type: ClipKind;
    }>;
  };
  compiledSteps: CandidateTwoCompiledPlanV1['steps'];
  expectedCanonicalTimeline: CanonicalClip[];
  expectedStateFingerprint: string;
}

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'fixtures/kernel-operation-parity/linked-generated-identity-plan-v1.json'),
  'utf8',
)) as ParityFixtureV1;
const edgeFixtures = (JSON.parse(readFileSync(
  resolve(process.cwd(), 'fixtures/kernel-operation-parity/linked-generated-identity-edge-cases-v1.json'),
  'utf8',
)) as { cases: ParityFixtureV1[]; schemaVersion: 1 }).cases;
const initialStoreState = useTimelineStore.getState();

function initializeHistoryRefs(): void {
  initHistoryStoreRefs({
    timeline: {
      getState: useTimelineStore.getState,
      setState: useTimelineStore.setState,
    },
    media: {
      getState: () => ({
        files: [],
        compositions: [],
        folders: [],
        selectedIds: [],
        expandedFolderIds: [],
        textItems: [],
        solidItems: [],
        mathSceneItems: [],
        motionShapeItems: [],
        signalAssets: [],
        signalArtifacts: [],
        signalGraphs: [],
        signalOperators: [],
      }),
      setState: () => undefined,
    },
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
  });
}

function round6(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canonicalTimelineForm(tracks: TimelineTrack[], clips: TimelineClip[]): CanonicalClip[] {
  const ordinalByType = new Map<string, number>();
  const trackKeyById = new Map<string, string>();
  const trackTypeById = new Map<string, ClipKind>();
  for (const track of tracks) {
    if (track.type !== 'audio' && track.type !== 'video') continue;
    const ordinal = ordinalByType.get(track.type) ?? 0;
    trackKeyById.set(track.id, `${track.type}:${ordinal}`);
    trackTypeById.set(track.id, track.type);
    ordinalByType.set(track.type, ordinal + 1);
  }
  const ordered = [...clips].toSorted((left, right) => {
    const leftTrack = trackKeyById.get(left.trackId) ?? left.trackId;
    const rightTrack = trackKeyById.get(right.trackId) ?? right.trackId;
    return leftTrack.localeCompare(rightTrack)
      || left.startTime - right.startTime
      || left.duration - right.duration
      || left.inPoint - right.inPoint
      || left.outPoint - right.outPoint;
  });
  const indexById = new Map(ordered.map((clip, index) => [clip.id, index]));
  return ordered.map((clip) => [
    trackKeyById.get(clip.trackId) ?? clip.trackId,
    trackTypeById.get(clip.trackId) ?? 'video',
    round6(clip.startTime),
    round6(clip.duration),
    round6(clip.inPoint),
    round6(clip.outPoint),
    clip.linkedClipId === undefined ? null : (indexById.get(clip.linkedClipId) ?? -1),
  ]);
}

async function fingerprintCurrentTimeline(): Promise<string> {
  const { clips, tracks } = useTimelineStore.getState();
  return fingerprintPublicTimelineStateV1({ clips, tracks });
}

function compileFixturePlan(
  expectedTimelineRevision: number,
  selectedFixture: ParityFixtureV1 = fixture,
): CandidateTwoCompiledPlanV1 {
  return {
    allowedEffects: ['segmentation', 'sourceCoverage', 'mediaDuration'],
    batchId: selectedFixture.caseId,
    contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
    expectedTimelineRevision,
    planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
    planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
    schemaVersion: 1,
    steps: selectedFixture.compiledSteps,
  };
}

function authorizeFixturePlan(plan: CandidateTwoCompiledPlanV1) {
  const nowEpochMs = 1_785_588_000_000;
  const authority = new KernelOperationSessionAuthorityV1({
    binding: {
      clientInstanceId: 'parity-client',
      sessionId: 'parity-session',
      turnId: 'parity-turn',
    },
    descriptor: {
      allowedEffects: [...plan.allowedEffects],
      allowedOperationIds: [...new Set(plan.steps.map((step) => step.operationId))],
      authoritySource: 'same-origin-authenticated-kernel-proxy-v1',
      capabilitySetId: 'parity-capability-set',
      clientInstanceId: 'parity-client',
      contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
      contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
      expiresAtEpochMs: nowEpochMs + 60_000,
      initialPlanSequence: 0,
      issuedAtEpochMs: nowEpochMs - 1_000,
      planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
      planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
      schemaVersion: 1,
      sessionId: 'parity-session',
      turnId: 'parity-turn',
    },
    nowEpochMs,
  });
  return createWp1EditorOperationAuthorization(authority.accept({
    capabilitySetId: 'parity-capability-set',
    clientInstanceId: 'parity-client',
    expiresAtEpochMs: nowEpochMs + 30_000,
    kind: 'operation-plan-request',
    plan,
    schemaVersion: 1,
    sequence: 0,
    sessionId: 'parity-session',
    settlement: 'fast-immediate',
    turnId: 'parity-turn',
  }, nowEpochMs));
}

describe('WP1 candidate-two behavioral parity fixture', () => {
  beforeEach(() => {
    expect(fixture.schemaVersion).toBe(1);
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
    initializeHistoryRefs();
    useHistoryStore.setState({ batchId: null, batchLabel: null });
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState(initialStoreState);
    useTimelineStore.setState({
      tracks: fixture.initialTimeline.tracks.map((track) => createMockTrack(track)),
      clips: fixture.initialTimeline.clips.map((clip) => createMockClip({
        ...clip,
        source: { type: clip.type },
      })),
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      isExporting: false,
    });
    captureSnapshot('WP1 parity initial state');
  });

  afterEach(() => {
    if (useHistoryStore.getState().batchId !== null) cancelHistoryBatch();
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState(initialStoreState);
    setHistoryCallbacks({
      flushPendingCapture: () => undefined,
      suppressCaptures: () => undefined,
    });
  });

  it('matches the shared canonical outcome through real editor handlers', async () => {
    const transaction = createWp1AgentTransactionAdapter();
    const dispatch = async (
      operationId: PublicOperationIdV1,
      argumentsValue: Record<string, unknown>,
    ) => operationId === 'timeline.segment.split.v1'
      ? handleSplitClipAtTimes(argumentsValue, useTimelineStore.getState())
      : handleDeleteClips(argumentsValue, useTimelineStore.getState());

    const plan = compileFixturePlan(getTimelineRevision());
    const result = await executeCandidateTwoCompiledPlanV1(
      plan,
      {
        authorize: authorizeFixturePlan(plan),
        dispatch,
        getTimelineRevision,
        transaction,
      },
    );

    expect(result.success).toBe(true);
    expect(canonicalTimelineForm(
      useTimelineStore.getState().tracks,
      useTimelineStore.getState().clips,
    )).toEqual(fixture.expectedCanonicalTimeline);
    expect(await fingerprintCurrentTimeline()).toBe(fixture.expectedStateFingerprint);
    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(useHistoryStore.getState().undo()).toMatchObject({ operation: 'undo' });
    expect(useTimelineStore.getState().clips).toHaveLength(2);
  });

  it.each(edgeFixtures)('matches shared boundary case $caseId through real handlers', async (
    edgeFixture,
  ) => {
    useHistoryStore.getState().clearHistory();
    useTimelineStore.setState({
      tracks: edgeFixture.initialTimeline.tracks.map((track) => createMockTrack(track)),
      clips: edgeFixture.initialTimeline.clips.map((clip) => createMockClip({
        ...clip,
        source: { type: clip.type },
      })),
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      isExporting: false,
    });
    captureSnapshot(`WP1 parity ${edgeFixture.caseId}`);
    const dispatch = async (
      operationId: PublicOperationIdV1,
      argumentsValue: Record<string, unknown>,
    ) => operationId === 'timeline.segment.split.v1'
      ? handleSplitClipAtTimes(argumentsValue, useTimelineStore.getState())
      : handleDeleteClips(argumentsValue, useTimelineStore.getState());
    const plan = compileFixturePlan(getTimelineRevision(), edgeFixture);

    const result = await executeCandidateTwoCompiledPlanV1(plan, {
      authorize: authorizeFixturePlan(plan),
      dispatch,
      getTimelineRevision,
      transaction: createWp1AgentTransactionAdapter(),
    });

    expect(result.success).toBe(true);
    expect(canonicalTimelineForm(
      useTimelineStore.getState().tracks,
      useTimelineStore.getState().clips,
    )).toEqual(edgeFixture.expectedCanonicalTimeline);
    expect(await fingerprintCurrentTimeline()).toBe(edgeFixture.expectedStateFingerprint);
  });

  it('rolls the real first mutation back when the bound delete step fails', async () => {
    const initialCanonical = canonicalTimelineForm(
      useTimelineStore.getState().tracks,
      useTimelineStore.getState().clips,
    );
    const dispatch = vi.fn(async (
      operationId: PublicOperationIdV1,
      argumentsValue: Record<string, unknown>,
    ) => operationId === 'timeline.segment.split.v1'
      ? handleSplitClipAtTimes(argumentsValue, useTimelineStore.getState())
      : { success: false, error: 'injected delete failure' });

    const plan = compileFixturePlan(getTimelineRevision());
    const result = await executeCandidateTwoCompiledPlanV1(
      plan,
      {
        authorize: authorizeFixturePlan(plan),
        dispatch,
        getTimelineRevision,
        transaction: createWp1AgentTransactionAdapter(),
      },
    );

    expect(result.success).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(canonicalTimelineForm(
      useTimelineStore.getState().tracks,
      useTimelineStore.getState().clips,
    )).toEqual(initialCanonical);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });

  it('keeps a successful Verified execution reversible until the private verdict settles it', async () => {
    const initialCanonical = canonicalTimelineForm(
      useTimelineStore.getState().tracks,
      useTimelineStore.getState().clips,
    );
    const dispatch = async (
      operationId: PublicOperationIdV1,
      argumentsValue: Record<string, unknown>,
    ) => operationId === 'timeline.segment.split.v1'
      ? handleSplitClipAtTimes(argumentsValue, useTimelineStore.getState())
      : handleDeleteClips(argumentsValue, useTimelineStore.getState());

    const plan = compileFixturePlan(getTimelineRevision());
    const prepared = await prepareCandidateTwoCompiledPlanV1(
      plan,
      {
        authorize: authorizeFixturePlan(plan),
        dispatch,
        getTimelineRevision,
        transaction: createWp1AgentTransactionAdapter(),
      },
    );

    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') throw new Error('expected prepared execution');
    expect(useHistoryStore.getState().batchId).not.toBeNull();
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(canonicalTimelineForm(
      useTimelineStore.getState().tracks,
      useTimelineStore.getState().clips,
    )).toEqual(fixture.expectedCanonicalTimeline);

    prepared.abort();
    expect(useHistoryStore.getState().batchId).toBeNull();
    expect(canonicalTimelineForm(
      useTimelineStore.getState().tracks,
      useTimelineStore.getState().clips,
    )).toEqual(initialCanonical);
    expect(() => prepared.commit()).toThrow('already settled');
  });

  it.each(['commit', 'abort'] as const)(
    'blocks a concurrent user timeline edit before Verified %s without absorbing it',
    async (decision) => {
      const initialCanonical = canonicalTimelineForm(
        useTimelineStore.getState().tracks,
        useTimelineStore.getState().clips,
      );
      const dispatch = async (
        operationId: PublicOperationIdV1,
        argumentsValue: Record<string, unknown>,
      ) => operationId === 'timeline.segment.split.v1'
        ? handleSplitClipAtTimes(argumentsValue, useTimelineStore.getState())
        : handleDeleteClips(argumentsValue, useTimelineStore.getState());
      const prepared = await prepareCandidateTwoCompiledPlanV1(
        compileFixturePlan(getTimelineRevision()),
        {
          authorize: () => true,
          dispatch,
          getTimelineRevision,
          transaction: createWp1AgentTransactionAdapter(),
        },
      );
      expect(prepared.status).toBe('prepared');
      if (prepared.status !== 'prepared') throw new Error('expected prepared execution');

      const operationTimeline = canonicalTimelineForm(
        useTimelineStore.getState().tracks,
        useTimelineStore.getState().clips,
      );
      const userTarget = useTimelineStore.getState().clips[0];
      expect(isExclusiveTimelineMutationLeaseActive()).toBe(true);
      expect(() => useTimelineStore.getState().updateClip(userTarget.id, {
        name: 'concurrent user edit',
      })).toThrow('temporarily locked');
      expect(() => endBatch()).toThrow('temporarily locked');
      expect(canonicalTimelineForm(
        useTimelineStore.getState().tracks,
        useTimelineStore.getState().clips,
      )).toEqual(operationTimeline);

      prepared[decision]();
      expect(isExclusiveTimelineMutationLeaseActive()).toBe(false);
      expect(canonicalTimelineForm(
        useTimelineStore.getState().tracks,
        useTimelineStore.getState().clips,
      )).toEqual(decision === 'commit' ? fixture.expectedCanonicalTimeline : initialCanonical);
      expect(useTimelineStore.getState().clips.some((clip) => (
        clip.name === 'concurrent user edit'
      ))).toBe(false);
    },
  );

  it('refuses to execute inside a history batch owned by another workflow', async () => {
    useHistoryStore.getState().startBatch('outer owner');
    const dispatch = vi.fn(async () => ({ success: true }));

    await expect(executeCandidateTwoCompiledPlanV1(
      compileFixturePlan(getTimelineRevision()),
      {
        authorize: () => true,
        dispatch,
        getTimelineRevision,
        transaction: createWp1AgentTransactionAdapter(),
      },
    )).rejects.toThrow('exclusive history transaction');
    expect(dispatch).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().batchLabel).toBe('outer owner');
  });

  it('detects when another workflow closes the operation history transaction', () => {
    const transaction = createWp1AgentTransactionAdapter();
    const handle = transaction.begin('ownership loss probe');
    useHistoryStore.setState({ batchId: null, batchLabel: null });

    expect(() => transaction.commit(handle)).toThrow('lost history transaction ownership');
  });
});
