import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseHostedAgentFastV2Sse,
  type HostedAgentFastV2Event,
} from '../../src/services/kernelClient/hostedAgent/fastV2FetchTransport';
import {
  executeCandidateTwoCompiledPlanV1,
  type CandidateTwoCompiledPlanV1,
} from '../../src/services/kernelClient/wp1Spike/candidateTwoCompiledPlanExecutor';
import { createWp1AgentTransactionAdapter } from '../../src/services/kernelClient/wp1Spike/agentTransactionAdapter';
import { createWp1EditorOperationAuthorization } from '../../src/services/kernelClient/wp1Spike/editorOperationDispatcher';
import { KernelOperationRoundTripV1 } from '../../src/services/kernelClient/wp1Spike/operationRoundTrip';
import {
  KernelOperationSessionAuthorityV1,
  type KernelOperationPlanRequestV1,
  type KernelOperationSessionDescriptorV1,
} from '../../src/services/kernelClient/wp1Spike/operationSessionAuthority';
import {
  PUBLIC_COMPILED_PLAN_DIGEST_V1,
  PUBLIC_COMPILED_PLAN_EXTENSION_V1,
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
  fingerprintPublicTimelineStateV1,
  type PublicOperationIdV1,
} from '../../src/services/kernelClient/wp1Spike/publicOperationContracts';
import { handleDeleteClips } from '../../src/services/aiTools/handlers/clips/delete';
import { handleSplitClipAtTimes } from '../../src/services/aiTools/handlers/clips/split';
import {
  cancelHistoryBatch,
  captureSnapshot,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  useHistoryStore,
} from '../../src/stores/historyStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { getTimelineRevision } from '../../src/stores/timeline/revisionMiddleware';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

type ClipKind = 'audio' | 'video';
type CanonicalClip = [string, ClipKind, number, number, number, number, number | null];

interface ReferenceFixtureV1 {
  caseId: string;
  compiledSteps: CandidateTwoCompiledPlanV1['steps'];
  expectedCanonicalTimeline: CanonicalClip[];
  expectedStateFingerprint: string;
  initialTimeline: {
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
    tracks: Array<{ id: string; type: ClipKind }>;
  };
  schemaVersion: 1;
}

interface SanitizedRangeRemovalInputV1 {
  compactSnapshot: {
    payload: {
      clips: Array<{
        duration: number;
        id: string;
        inPoint: number;
        linkedClipId?: string;
        name: string;
        outPoint: number;
        startTime: number;
        trackId: string;
      }>;
      duration: number;
      inPoint: number | null;
      outPoint: number | null;
      playheadPosition: number;
      selectedClipIds: string[];
      tracks: Array<{
        id: string;
        locked: boolean;
        muted: boolean;
        name: string;
        solo: boolean;
        type: ClipKind;
        visible: boolean;
      }>;
    };
    schemaVersion: 1;
    stateFingerprint: string;
    timelineRevision: 7;
  };
  expectedStateFingerprint: string;
  inputId: 'multi-range-linked-sanitized-v1';
  request: string;
  target: {
    clipId: string;
    ranges: Array<{ end: number; start: number }>;
    withLinked: true;
  };
}

interface RecordedParityCaseV1 {
  caseId: string;
  fastV2RecordedSteps: CandidateTwoCompiledPlanV1['steps'];
  referenceCaseId?: string;
  referenceFixture: string;
  sanitizedInput?: SanitizedRangeRemovalInputV1;
}

interface RecordedParityCorpusV1 {
  cases: RecordedParityCaseV1[];
  claimScope: 'controlled-public-boundary-mechanics-only';
  recordingProvenance: string;
  schemaVersion: 1;
}

interface MechanicalOutcome {
  canonicalTimeline: CanonicalClip[];
  dispatchCount: number;
  historyNodeCount: number;
  payloadBytes: number;
  runtimeMs: number;
  stateFingerprint: string;
  undoRestoredInitialState: boolean;
}

const FIXED_NOW = 1_785_588_000_000;
const corpusPath = resolve(
  process.cwd(),
  'fixtures/fast-v2-parity/recorded-public-operation-plans-v1.json',
);
const corpusText = readFileSync(corpusPath, 'utf8');
const corpus = JSON.parse(corpusText) as RecordedParityCorpusV1;
const initialStoreState = useTimelineStore.getState();

function readReferenceFixture(selected: RecordedParityCaseV1): ReferenceFixtureV1 {
  const document = JSON.parse(readFileSync(
    resolve(process.cwd(), selected.referenceFixture),
    'utf8',
  )) as ReferenceFixtureV1 | { cases: ReferenceFixtureV1[]; schemaVersion: 1 };
  if ('cases' in document) {
    const found = document.cases.find((candidate) => (
      candidate.caseId === selected.referenceCaseId
    ));
    if (!found) throw new Error(`Missing WP1 reference fixture ${selected.referenceCaseId}.`);
    return found;
  }
  return document;
}

function initializeHistoryRefs(): void {
  initHistoryStoreRefs({
    dock: {
      getState: () => ({ layout: null }),
      setState: () => undefined,
    },
    media: {
      getState: () => ({
        compositions: [],
        expandedFolderIds: [],
        files: [],
        folders: [],
        mathSceneItems: [],
        motionShapeItems: [],
        selectedIds: [],
        signalArtifacts: [],
        signalAssets: [],
        signalGraphs: [],
        signalOperators: [],
        solidItems: [],
        textItems: [],
      }),
      setState: () => undefined,
    },
    timeline: {
      getState: useTimelineStore.getState,
      setState: useTimelineStore.setState,
    },
  });
}

function installInitialTimeline(reference: ReferenceFixtureV1): CanonicalClip[] {
  setHistoryCallbacks({
    flushPendingCapture: () => undefined,
    suppressCaptures: () => undefined,
  });
  initializeHistoryRefs();
  useHistoryStore.setState({ batchId: null, batchLabel: null });
  useHistoryStore.getState().clearHistory();
  useTimelineStore.setState(initialStoreState);
  useTimelineStore.setState({
    clips: reference.initialTimeline.clips.map((clip) => createMockClip({
      ...clip,
      source: { type: clip.type },
    })),
    isExporting: false,
    primarySelectedClipId: null,
    selectedClipIds: new Set(),
    tracks: reference.initialTimeline.tracks.map((track) => createMockTrack(track)),
  });
  const initial = canonicalTimelineForm(
    useTimelineStore.getState().tracks,
    useTimelineStore.getState().clips,
  );
  captureSnapshot(`Fast V2 recorded parity initial: ${reference.caseId}`);
  expect(Object.keys(useHistoryStore.getState().nodes)).toHaveLength(1);
  return initial;
}

function round6(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canonicalTimelineForm(
  tracks: TimelineTrack[],
  clips: TimelineClip[],
): CanonicalClip[] {
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

async function currentFingerprint(): Promise<string> {
  const { clips, tracks } = useTimelineStore.getState();
  return fingerprintPublicTimelineStateV1({ clips, tracks });
}

function plan(
  caseId: string,
  steps: CandidateTwoCompiledPlanV1['steps'],
  expectedTimelineRevision = getTimelineRevision(),
): CandidateTwoCompiledPlanV1 {
  return {
    allowedEffects: ['segmentation', 'sourceCoverage', 'mediaDuration'],
    batchId: `recorded-parity-${caseId}`,
    contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
    expectedTimelineRevision,
    planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
    planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
    schemaVersion: 1,
    steps: structuredClone(steps),
  };
}

function binding(caseId: string) {
  return {
    clientInstanceId: `parity-client-${caseId}`,
    sessionId: `parity-session-${caseId}`,
    turnId: `parity-turn-${caseId}`,
  };
}

function descriptor(
  compiledPlan: CandidateTwoCompiledPlanV1,
  caseId: string,
): KernelOperationSessionDescriptorV1 {
  const bound = binding(caseId);
  return {
    allowedEffects: [...compiledPlan.allowedEffects],
    allowedOperationIds: [...new Set(compiledPlan.steps.map((step) => step.operationId))],
    authoritySource: 'same-origin-authenticated-kernel-proxy-v1',
    capabilitySetId: `parity-capability-${caseId}`,
    clientInstanceId: bound.clientInstanceId,
    contractDigest: PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
    contractVersion: PUBLIC_OPERATION_CONTRACT_V1.contractVersion,
    expiresAtEpochMs: FIXED_NOW + 60_000,
    initialPlanSequence: 0,
    issuedAtEpochMs: FIXED_NOW - 1_000,
    planDigest: PUBLIC_COMPILED_PLAN_DIGEST_V1,
    planVersion: PUBLIC_COMPILED_PLAN_EXTENSION_V1.planVersion,
    schemaVersion: 1,
    sessionId: bound.sessionId,
    turnId: bound.turnId,
  };
}

function request(
  compiledPlan: CandidateTwoCompiledPlanV1,
  selectedDescriptor: KernelOperationSessionDescriptorV1,
): KernelOperationPlanRequestV1 {
  return {
    capabilitySetId: selectedDescriptor.capabilitySetId,
    clientInstanceId: selectedDescriptor.clientInstanceId,
    expiresAtEpochMs: FIXED_NOW + 30_000,
    kind: 'operation-plan-request',
    plan: compiledPlan,
    schemaVersion: 1,
    sequence: 0,
    sessionId: selectedDescriptor.sessionId,
    settlement: 'fast-immediate',
    turnId: selectedDescriptor.turnId,
  };
}

function operationDispatch() {
  return vi.fn(async (
    operationId: PublicOperationIdV1,
    argumentsValue: Record<string, unknown>,
  ) => operationId === 'timeline.segment.split.v1'
    ? handleSplitClipAtTimes(argumentsValue, useTimelineStore.getState())
    : handleDeleteClips(argumentsValue, useTimelineStore.getState()));
}

function assertSnapshotDerivedFromReference(
  sanitizedInput: SanitizedRangeRemovalInputV1,
  reference: ReferenceFixtureV1,
): void {
  const payload = sanitizedInput.compactSnapshot.payload;
  expect(payload.tracks.map(({ id, type }) => ({ id, type })))
    .toEqual(reference.initialTimeline.tracks);
  expect(payload.clips).toHaveLength(reference.initialTimeline.clips.length);
  for (const referenceClip of reference.initialTimeline.clips) {
    const snapshotClip = payload.clips.find((clip) => clip.id === referenceClip.id);
    expect(snapshotClip).toMatchObject({
      duration: referenceClip.duration,
      id: referenceClip.id,
      inPoint: referenceClip.inPoint,
      linkedClipId: referenceClip.linkedClipId,
      outPoint: referenceClip.outPoint,
      startTime: referenceClip.startTime,
      trackId: referenceClip.trackId,
    });
  }
}

function fastReferenceFromSanitizedSnapshot(
  sanitizedInput: SanitizedRangeRemovalInputV1,
  reference: ReferenceFixtureV1,
): ReferenceFixtureV1 {
  const payload = sanitizedInput.compactSnapshot.payload;
  const typeByTrackId = new Map(payload.tracks.map((track) => [track.id, track.type] as const));
  return {
    ...reference,
    initialTimeline: {
      clips: payload.clips.map(({ name: _name, ...clip }) => ({
        ...clip,
        sourceId: `sanitized-source:${clip.id}`,
        type: typeByTrackId.get(clip.trackId) ?? 'video',
      })),
      tracks: payload.tracks.map(({ id, type }) => ({ id, type })),
    },
  };
}

function assertSanitizedInputPlanBinding(
  sanitizedInput: SanitizedRangeRemovalInputV1,
  compiledPlan: CandidateTwoCompiledPlanV1,
): void {
  const [splitStep, deleteStep] = compiledPlan.steps;
  const targetBoundaries = sanitizedInput.target.ranges.flatMap(({ start, end }) => [start, end]);
  expect(sanitizedInput.request).toBe(
    'Remove the two synthetic marked ranges from the linked source clip.',
  );
  expect(splitStep).toMatchObject({
    arguments: {
      clipId: sanitizedInput.target.clipId,
      snapToAudioZeroCrossing: true,
      times: targetBoundaries,
      withLinked: sanitizedInput.target.withLinked,
    },
    operationId: 'timeline.segment.split.v1',
    sequence: 1,
  });
  expect(deleteStep).toMatchObject({
    arguments: {
      deClickFadeSeconds: 0.006,
      withLinked: sanitizedInput.target.withLinked,
    },
    operationId: 'timeline.segment.delete-many.v1',
    sequence: 2,
  });
  const clipIds = deleteStep?.arguments.clipIds;
  expect(Array.isArray(clipIds)).toBe(true);
  if (!Array.isArray(clipIds) || !splitStep) {
    throw new Error('The sanitized range-removal plan is incomplete.');
  }
  expect(clipIds.map((entry) => (
    (entry as { $result?: { path?: unknown[]; stepId?: string } }).$result?.path?.at(-1)
  ))).toEqual(sanitizedInput.target.ranges.map((_range, index) => index * 2 + 1));
  expect(clipIds.map((entry) => (
    (entry as { $result?: { stepId?: string } }).$result?.stepId
  ))).toEqual(sanitizedInput.target.ranges.map(() => splitStep.stepId));
}

function encodeSse(events: HostedAgentFastV2Event[]): string {
  return events.map((event) => [
    `id: ${event.eventId}`,
    `event: ${event.kind}`,
    `data: ${JSON.stringify(event)}`,
  ].join('\n')).join('\n\n');
}

function recordedV2Sse(
  compiledPlan: CandidateTwoCompiledPlanV1,
  caseId: string,
): string {
  const selectedDescriptor = descriptor(compiledPlan, caseId);
  const bound = binding(caseId);
  return encodeSse([
    {
      descriptor: selectedDescriptor,
      eventId: '1',
      kind: 'operation-session-ready',
      protocolVersion: 'fast-agent-v2',
      sessionId: bound.sessionId,
      turnId: bound.turnId,
    },
    {
      eventId: '2',
      kind: 'operation-plan-request',
      protocolVersion: 'fast-agent-v2',
      request: request(compiledPlan, selectedDescriptor),
      sessionId: bound.sessionId,
      turnId: bound.turnId,
    },
  ]);
}

function assertSingleUndoAndRestore(initial: CanonicalClip[]): boolean {
  const historyBeforeUndo = useHistoryStore.getState();
  expect(Object.keys(historyBeforeUndo.nodes)).toHaveLength(2);
  expect(historyBeforeUndo.canUndo()).toBe(true);
  expect(historyBeforeUndo.undo()).toMatchObject({ operation: 'undo' });
  expect(useHistoryStore.getState().canUndo()).toBe(false);
  return JSON.stringify(canonicalTimelineForm(
    useTimelineStore.getState().tracks,
    useTimelineStore.getState().clips,
  )) === JSON.stringify(initial);
}

async function runWp1Reference(
  selected: RecordedParityCaseV1,
  reference: ReferenceFixtureV1,
): Promise<MechanicalOutcome> {
  const initial = installInitialTimeline(reference);
  const compiledPlan = plan(`${selected.caseId}-wp1`, reference.compiledSteps);
  const selectedDescriptor = descriptor(compiledPlan, `${selected.caseId}-wp1`);
  const authority = new KernelOperationSessionAuthorityV1({
    binding: binding(`${selected.caseId}-wp1`),
    descriptor: selectedDescriptor,
    nowEpochMs: FIXED_NOW,
  });
  const accepted = authority.accept(request(compiledPlan, selectedDescriptor), FIXED_NOW);
  const dispatch = operationDispatch();
  const started = performance.now();
  const result = await executeCandidateTwoCompiledPlanV1(compiledPlan, {
    authorize: createWp1EditorOperationAuthorization(accepted),
    dispatch,
    getTimelineRevision,
    transaction: createWp1AgentTransactionAdapter(),
  });
  const runtimeMs = performance.now() - started;
  expect(result.success).toBe(true);
  const canonicalTimeline = canonicalTimelineForm(
    useTimelineStore.getState().tracks,
    useTimelineStore.getState().clips,
  );
  const stateFingerprint = await currentFingerprint();
  const historyNodeCount = Object.keys(useHistoryStore.getState().nodes).length;
  const undoRestoredInitialState = assertSingleUndoAndRestore(initial);
  return {
    canonicalTimeline,
    dispatchCount: dispatch.mock.calls.length,
    historyNodeCount,
    payloadBytes: Buffer.byteLength(JSON.stringify(compiledPlan), 'utf8'),
    runtimeMs,
    stateFingerprint,
    undoRestoredInitialState,
  };
}

async function runFastV2Recording(
  selected: RecordedParityCaseV1,
  reference: ReferenceFixtureV1,
): Promise<MechanicalOutcome> {
  const sanitizedInput = selected.sanitizedInput;
  const fastReference = sanitizedInput === undefined
    ? reference
    : fastReferenceFromSanitizedSnapshot(sanitizedInput, reference);
  const initial = installInitialTimeline(fastReference);
  if (sanitizedInput !== undefined) {
    assertSnapshotDerivedFromReference(sanitizedInput, reference);
    expect(await currentFingerprint()).toBe(sanitizedInput.compactSnapshot.stateFingerprint);
  }
  const compiledPlan = plan(`${selected.caseId}-v2`, selected.fastV2RecordedSteps);
  const sse = recordedV2Sse(compiledPlan, `${selected.caseId}-v2`);
  const events = parseHostedAgentFastV2Sse(sse, binding(`${selected.caseId}-v2`));
  const sessionEvent = events.find((event) => event.kind === 'operation-session-ready');
  const planEvent = events.find((event) => event.kind === 'operation-plan-request');
  if (sessionEvent?.kind !== 'operation-session-ready'
    || planEvent?.kind !== 'operation-plan-request') {
    throw new Error('The recorded Fast V2 stream is incomplete.');
  }
  if (sanitizedInput !== undefined) {
    assertSanitizedInputPlanBinding(sanitizedInput, planEvent.request.plan);
  }
  const authority = new KernelOperationSessionAuthorityV1({
    binding: binding(`${selected.caseId}-v2`),
    descriptor: sessionEvent.descriptor,
    nowEpochMs: FIXED_NOW,
  });
  const dispatch = operationDispatch();
  const roundTrip = new KernelOperationRoundTripV1({
    authority,
    dependencies: {
      dispatch,
      getTimelineRevision,
      transaction: createWp1AgentTransactionAdapter(),
    },
    requestConfirmation: async (confirmation) => ({
      decision: 'approved',
      planBinding: confirmation.planBinding,
    }),
  });
  const started = performance.now();
  const result = await roundTrip.execute(planEvent.request, FIXED_NOW);
  const runtimeMs = performance.now() - started;
  expect(result.status).toBe('committed');
  const canonicalTimeline = canonicalTimelineForm(
    useTimelineStore.getState().tracks,
    useTimelineStore.getState().clips,
  );
  const stateFingerprint = await currentFingerprint();
  const dispatchCount = dispatch.mock.calls.length;
  const historyNodeCount = Object.keys(useHistoryStore.getState().nodes).length;
  const replay = await roundTrip.execute(structuredClone(planEvent.request), FIXED_NOW);
  expect(replay).toEqual(result);
  expect(dispatch).toHaveBeenCalledTimes(dispatchCount);
  expect(Object.keys(useHistoryStore.getState().nodes)).toHaveLength(historyNodeCount);
  expect(await currentFingerprint()).toBe(stateFingerprint);
  const undoRestoredInitialState = assertSingleUndoAndRestore(initial);
  return {
    canonicalTimeline,
    dispatchCount,
    historyNodeCount,
    payloadBytes: Buffer.byteLength(sse, 'utf8'),
    runtimeMs,
    stateFingerprint,
    undoRestoredInitialState,
  };
}

afterEach(() => {
  if (useHistoryStore.getState().batchId !== null) cancelHistoryBatch();
  useHistoryStore.getState().clearHistory();
  useTimelineStore.setState(initialStoreState);
  setHistoryCallbacks({
    flushPendingCapture: () => undefined,
    suppressCaptures: () => undefined,
  });
});

describe('Fast V2 recorded public operation-plan boundary parity', () => {
  it('states a mechanical-only scope and contains no browser-owned model authority', () => {
    expect(corpus).toMatchObject({
      claimScope: 'controlled-public-boundary-mechanics-only',
      schemaVersion: 1,
    });
    expect(corpus.cases).toHaveLength(5);
    expect(corpus.cases.map((entry) => entry.fastV2RecordedSteps.length)).toEqual([
      2, 2, 2, 2, 1,
    ]);
    for (const forbidden of [
      'systemPrompt',
      'providerInput',
      'modelPolicy',
      'toolSchema',
      'maximumOutputTokens',
    ]) {
      expect(corpusText).not.toContain(forbidden);
    }
    for (const forbidden of [
      'contractdigest',
      'model',
      'plandigest',
      'prompt',
      'provider',
      'visualreferences',
      'visualverificationtimes',
    ]) {
      expect(corpusText.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('binds one strict sanitized public input to the multi-range Fast recording', async () => {
    const selected = corpus.cases.find((entry) => entry.caseId === 'multi-range-linked');
    if (!selected?.sanitizedInput) throw new Error('Missing sanitized multi-range input.');
    const { sanitizedInput } = selected;
    const reference = readReferenceFixture(selected);

    expect(corpus.cases.filter((entry) => entry.sanitizedInput !== undefined))
      .toEqual([selected]);
    expect(Object.keys(sanitizedInput).sort()).toEqual([
      'compactSnapshot',
      'expectedStateFingerprint',
      'inputId',
      'request',
      'target',
    ]);
    expect(Object.keys(sanitizedInput.compactSnapshot).sort()).toEqual([
      'payload',
      'schemaVersion',
      'stateFingerprint',
      'timelineRevision',
    ]);
    expect(Object.keys(sanitizedInput.target).sort()).toEqual([
      'clipId',
      'ranges',
      'withLinked',
    ]);
    expect(sanitizedInput.compactSnapshot).toMatchObject({
      schemaVersion: 1,
      timelineRevision: 7,
    });
    expect(Object.keys(sanitizedInput.compactSnapshot.payload).sort()).toEqual([
      'clips',
      'duration',
      'inPoint',
      'outPoint',
      'playheadPosition',
      'selectedClipIds',
      'tracks',
    ]);
    for (const track of sanitizedInput.compactSnapshot.payload.tracks) {
      expect(Object.keys(track).sort()).toEqual([
        'id', 'locked', 'muted', 'name', 'solo', 'type', 'visible',
      ]);
    }
    for (const clip of sanitizedInput.compactSnapshot.payload.clips) {
      expect(Object.keys(clip).sort()).toEqual([
        'duration', 'id', 'inPoint', 'linkedClipId', 'name', 'outPoint', 'startTime', 'trackId',
      ]);
    }
    assertSnapshotDerivedFromReference(sanitizedInput, reference);
    expect(await fingerprintPublicTimelineStateV1(sanitizedInput.compactSnapshot.payload))
      .toBe(sanitizedInput.compactSnapshot.stateFingerprint);
    expect(sanitizedInput.expectedStateFingerprint).toBe(reference.expectedStateFingerprint);
    assertSanitizedInputPlanBinding(
      sanitizedInput,
      plan(`${selected.caseId}-sanitized-assertion`, selected.fastV2RecordedSteps),
    );
    expect(Buffer.byteLength(JSON.stringify(sanitizedInput), 'utf8')).toBeLessThan(32_000);
  });

  it.each(corpus.cases)(
    'matches WP1 final state, undo cardinality, and exact replay for $caseId',
    async (selected) => {
      const reference = readReferenceFixture(selected);
      const wp1 = await runWp1Reference(selected, reference);
      const fastV2 = await runFastV2Recording(selected, reference);

      expect(wp1.canonicalTimeline).toEqual(reference.expectedCanonicalTimeline);
      expect(fastV2.canonicalTimeline).toEqual(reference.expectedCanonicalTimeline);
      expect(fastV2.canonicalTimeline).toEqual(wp1.canonicalTimeline);
      expect(wp1.stateFingerprint).toBe(reference.expectedStateFingerprint);
      expect(fastV2.stateFingerprint).toBe(reference.expectedStateFingerprint);
      if (selected.sanitizedInput !== undefined) {
        expect(fastV2.stateFingerprint).toBe(selected.sanitizedInput.expectedStateFingerprint);
      }
      expect(fastV2.stateFingerprint).toBe(wp1.stateFingerprint);
      expect(wp1.historyNodeCount).toBe(2);
      expect(fastV2.historyNodeCount).toBe(2);
      expect(wp1.undoRestoredInitialState).toBe(true);
      expect(fastV2.undoRestoredInitialState).toBe(true);

      // These are controlled local mechanics bounds, not production/provider claims.
      expect(wp1.runtimeMs).toBeGreaterThanOrEqual(0);
      expect(fastV2.runtimeMs).toBeGreaterThanOrEqual(0);
      expect(wp1.runtimeMs).toBeLessThan(10_000);
      expect(fastV2.runtimeMs).toBeLessThan(10_000);
      expect(wp1.payloadBytes).toBeLessThan(32_000);
      expect(fastV2.payloadBytes).toBeLessThan(32_000);
      expect(fastV2.dispatchCount).toBe(wp1.dispatchCount);
    },
  );

  it.each(corpus.cases)(
    'fails $caseId closed before mutation when the recorded plan revision drifts',
    async (selected) => {
      const reference = readReferenceFixture(selected);
      const initial = installInitialTimeline(reference);
      const compiledPlan = plan(
        `${selected.caseId}-drift`,
        selected.fastV2RecordedSteps,
        getTimelineRevision() + 1,
      );
      const sse = recordedV2Sse(compiledPlan, `${selected.caseId}-drift`);
      const events = parseHostedAgentFastV2Sse(sse, binding(`${selected.caseId}-drift`));
      const sessionEvent = events.find((event) => event.kind === 'operation-session-ready');
      const planEvent = events.find((event) => event.kind === 'operation-plan-request');
      if (sessionEvent?.kind !== 'operation-session-ready'
        || planEvent?.kind !== 'operation-plan-request') {
        throw new Error('The recorded Fast V2 drift stream is incomplete.');
      }
      const dispatch = operationDispatch();
      const roundTrip = new KernelOperationRoundTripV1({
        authority: new KernelOperationSessionAuthorityV1({
          binding: binding(`${selected.caseId}-drift`),
          descriptor: sessionEvent.descriptor,
          nowEpochMs: FIXED_NOW,
        }),
        dependencies: {
          dispatch,
          getTimelineRevision,
          transaction: createWp1AgentTransactionAdapter(),
        },
        requestConfirmation: async (confirmation) => ({
          decision: 'approved',
          planBinding: confirmation.planBinding,
        }),
      });

      await expect(roundTrip.execute(planEvent.request, FIXED_NOW)).resolves.toMatchObject({
        errorCode: 'execution-rejected',
        status: 'failed',
      });
      expect(dispatch).not.toHaveBeenCalled();
      expect(Object.keys(useHistoryStore.getState().nodes)).toHaveLength(1);
      expect(useHistoryStore.getState().canUndo()).toBe(false);
      expect(canonicalTimelineForm(
        useTimelineStore.getState().tracks,
        useTimelineStore.getState().clips,
      )).toEqual(initial);
    },
  );

  it.each(['intersecting', 'non-intersecting'] as const)(
    'applies the declared fail-closed policy to a %s user edit between rounds',
    async (driftKind) => {
      const selected = corpus.cases[0];
      if (!selected) throw new Error('The recorded Fast V2 corpus is empty.');
      const reference = readReferenceFixture(selected);
      installInitialTimeline(reference);
      const expectedRevision = getTimelineRevision();
      const caseId = `${selected.caseId}-${driftKind}-user-edit`;
      const compiledPlan = plan(caseId, selected.fastV2RecordedSteps, expectedRevision);

      if (driftKind === 'intersecting') {
        useTimelineStore.getState().updateClip('video-source', { startTime: 0.125 });
      } else {
        useTimelineStore.setState((state) => ({ duration: state.duration + 1 }));
      }
      expect(getTimelineRevision()).toBeGreaterThan(expectedRevision);
      const userEditedFingerprint = await currentFingerprint();

      const events = parseHostedAgentFastV2Sse(
        recordedV2Sse(compiledPlan, caseId),
        binding(caseId),
      );
      const sessionEvent = events.find((event) => event.kind === 'operation-session-ready');
      const planEvent = events.find((event) => event.kind === 'operation-plan-request');
      if (sessionEvent?.kind !== 'operation-session-ready'
        || planEvent?.kind !== 'operation-plan-request') {
        throw new Error('The recorded Fast V2 drift stream is incomplete.');
      }
      const dispatch = operationDispatch();
      const roundTrip = new KernelOperationRoundTripV1({
        authority: new KernelOperationSessionAuthorityV1({
          binding: binding(caseId),
          descriptor: sessionEvent.descriptor,
          nowEpochMs: FIXED_NOW,
        }),
        dependencies: {
          dispatch,
          getTimelineRevision,
          transaction: createWp1AgentTransactionAdapter(),
        },
        requestConfirmation: async (confirmation) => ({
          decision: 'approved',
          planBinding: confirmation.planBinding,
        }),
      });

      await expect(roundTrip.execute(planEvent.request, FIXED_NOW)).resolves.toMatchObject({
        errorCode: 'execution-rejected',
        status: 'failed',
      });
      expect(dispatch).not.toHaveBeenCalled();
      expect(await currentFingerprint()).toBe(userEditedFingerprint);
      expect(Object.keys(useHistoryStore.getState().nodes)).toHaveLength(1);
    },
  );

  it('rejects a recorded V2 public plan whose frozen contract digest drifts', () => {
    const selected = corpus.cases[0];
    if (!selected) throw new Error('The recorded Fast V2 corpus is empty.');
    const reference = readReferenceFixture(selected);
    installInitialTimeline(reference);
    const compiledPlan = plan(`${selected.caseId}-contract-drift`, selected.fastV2RecordedSteps);
    compiledPlan.contractDigest = `sha256:${'0'.repeat(64)}`;
    const sse = recordedV2Sse(compiledPlan, `${selected.caseId}-contract-drift`);

    expect(() => parseHostedAgentFastV2Sse(
      sse,
      binding(`${selected.caseId}-contract-drift`),
    )).toThrow('invalid or unexpected payload');
    expect(Object.keys(useHistoryStore.getState().nodes)).toHaveLength(1);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
  });
});
