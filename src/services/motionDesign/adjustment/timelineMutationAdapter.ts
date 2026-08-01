import { layerBuilder } from '../../layerBuilder';
import { getPlayheadPosition } from '../../layerBuilder/PlayheadState';
import { renderHostPort } from '../../render/renderHostPort';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  cancelHistoryBatch,
  endBatch,
  startBatch,
} from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import { DEFAULT_TRANSFORM } from '../../../stores/timeline/constants';
import {
  generateEffectId,
  generateMotionClipId,
} from '../../../stores/timeline/helpers/idGenerator';
import { getTimelineRevision } from '../../../stores/timeline/revisionMiddleware';
import type { Effect, TimelineClip, TimelineTrack } from '../../../types';
import { createDefaultMotionLayerDefinition } from '../../../types/motionDesign';
import {
  IDENTITY_ADJUSTMENT_TRANSFORM,
  MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
  type JsonObject,
  type MotionAdjustmentBlendMode,
  type MotionAdjustmentEffectContract,
  type MotionAdjustmentLayerContract,
  type MotionAdjustmentStackContract,
} from './contracts';
import {
  assertMotionAdjustmentJsonData,
  isMotionAdjustmentStableId,
} from './contractLimits';
import {
  createDefaultMotionAdjustmentLayer,
  planConfigureMotionAdjustment,
  planCreateMotionAdjustment,
  planMoveMotionAdjustment,
  planRemoveMotionAdjustment,
  planTrimMotionAdjustment,
  type MotionAdjustmentMutationKind,
  type MotionAdjustmentMutationDirection,
  type MotionAdjustmentMutationPlan,
} from './mutationPlanner';
import { planMotionAdjustmentOperations } from './operationPlanner';
import { adaptTimelineEffectsToMotionAdjustmentContracts } from './supportedEffectContractAdapter';
import {
  SUPPORTED_ADJUSTMENT_EFFECT_TYPES,
  isSupportedAdjustmentEffectType,
  normalizeAdjustmentEffectParameters,
} from './supportedEffects';

const ADJUSTMENT_BLEND_MODES = Object.freeze([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
] as const satisfies readonly MotionAdjustmentBlendMode[]);

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export type TimelineMotionAdjustmentOperation =
  | 'create'
  | 'configure'
  | 'move'
  | 'trim'
  | 'remove';

export interface TimelineMotionAdjustmentSnapshot {
  readonly clipId: string;
  readonly trackId: string;
  readonly name: string;
  readonly startTime: number;
  readonly duration: number;
  readonly opacity: number;
  readonly blendMode: MotionAdjustmentBlendMode;
  readonly effects: readonly MotionAdjustmentEffectContract[];
}

export interface TimelineMotionAdjustmentMutationReceipt {
  readonly operation: TimelineMotionAdjustmentOperation;
  readonly clipId: string;
  readonly affectedClipIds: readonly string[];
  readonly createdEffectIds: readonly string[];
  readonly removedEffectIds: readonly string[];
  readonly stateRevisionBefore: number;
  readonly stateRevisionAfter: number;
  readonly contractRevisionBefore: number;
  readonly contractRevisionAfter: number;
  readonly plannerKinds: readonly (MotionAdjustmentMutationKind | 'admit-stack')[];
  readonly before: TimelineMotionAdjustmentSnapshot | null;
  readonly after: TimelineMotionAdjustmentSnapshot | null;
  readonly diagnostics: readonly [];
  readonly history: {
    readonly mode: 'single-entry';
    readonly atomic: true;
    readonly label: string;
  };
}

export interface TimelineMotionAdjustmentMutationFailure {
  readonly code: string;
  readonly message: string;
  readonly operation: TimelineMotionAdjustmentOperation | 'unknown';
  readonly affectedClipIds: readonly string[];
  readonly stateRevisionBefore: number;
  readonly stateRevisionAfter: number;
  readonly diagnostics: readonly [{
    readonly code: string;
    readonly message: string;
    readonly affectedClipIds: readonly string[];
  }];
}

export type TimelineMotionAdjustmentMutationResult =
  | { readonly ok: true; readonly receipt: TimelineMotionAdjustmentMutationReceipt }
  | { readonly ok: false; readonly failure: TimelineMotionAdjustmentMutationFailure };

interface ParsedEffectList {
  readonly contracts: MotionAdjustmentEffectContract[];
  readonly timelineEffects: Effect[];
  readonly createdEffectIds: string[];
}

interface PlannedTimelineMutation {
  readonly operation: TimelineMotionAdjustmentOperation;
  readonly clipId: string;
  readonly nextClips: TimelineClip[];
  readonly nextClipKeyframes: TimelineStore['clipKeyframes'];
  readonly before: TimelineMotionAdjustmentSnapshot | null;
  readonly after: TimelineMotionAdjustmentSnapshot | null;
  readonly createdEffectIds: string[];
  readonly removedEffectIds: string[];
  readonly plannerKinds: Array<MotionAdjustmentMutationKind | 'admit-stack'>;
  readonly contractRevisionAfter: number;
  readonly historyLabel: string;
}

class TimelineMotionAdjustmentMutationError extends Error {
  readonly code: string;
  readonly affectedClipIds: readonly string[];

  constructor(code: string, message: string, affectedClipIds: readonly string[] = []) {
    super(message);
    this.name = 'TimelineMotionAdjustmentMutationError';
    this.code = code;
    this.affectedClipIds = affectedClipIds;
  }
}

/**
 * Sole AI-facing mutation path for Adjustment 1.0 timeline clips. It performs
 * complete, descriptor-safe contract planning before opening history or
 * changing the Zustand store, and commits one durable state patch.
 */
export function applyTimelineMotionAdjustmentMutation(
  rawArgs: Record<string, unknown>,
): TimelineMotionAdjustmentMutationResult {
  const stateRevisionBefore = getTimelineRevision();
  let operation: TimelineMotionAdjustmentOperation | 'unknown' = 'unknown';
  try {
    assertMotionAdjustmentJsonData(rawArgs);
    operation = parseOperation(rawArgs.operation);
    const state = useTimelineStore.getState();
    const expectedRevision = parseOptionalRevision(rawArgs.expectedRevision);
    if (expectedRevision !== undefined && expectedRevision !== state.timelineRevision) {
      throw mutationError(
        'MD7_ADJUSTMENT_STALE_REVISION',
        `Timeline revision conflict: expected ${expectedRevision}, received ${state.timelineRevision}`,
      );
    }

    const compositionId = resolveCompositionId();
    const plan = planTimelineMutation(operation, rawArgs, state, compositionId);
    applyPlannedTimelineMutation(plan, state);
    const stateAfter = useTimelineStore.getState();
    const actualAfter = findAdjustmentSnapshot(plan.clipId, stateAfter);
    if (plan.operation === 'remove' ? actualAfter !== null : actualAfter === null) {
      throw mutationError(
        'MD7_ADJUSTMENT_POSTCONDITION_FAILED',
        `Adjustment ${plan.operation} did not reach its requested final state`,
        [plan.clipId],
      );
    }

    return {
      ok: true,
      receipt: {
        operation: plan.operation,
        clipId: plan.clipId,
        affectedClipIds: [plan.clipId],
        createdEffectIds: plan.createdEffectIds,
        removedEffectIds: plan.removedEffectIds,
        stateRevisionBefore,
        stateRevisionAfter: getTimelineRevision(),
        contractRevisionBefore: state.timelineRevision,
        contractRevisionAfter: plan.contractRevisionAfter,
        plannerKinds: plan.plannerKinds,
        before: plan.before,
        after: actualAfter,
        diagnostics: [],
        history: {
          mode: 'single-entry',
          atomic: true,
          label: plan.historyLabel,
        },
      },
    };
  } catch (error) {
    const normalized = normalizeMutationError(error);
    return {
      ok: false,
      failure: {
        code: normalized.code,
        message: normalized.message,
        operation,
        affectedClipIds: normalized.affectedClipIds,
        stateRevisionBefore,
        stateRevisionAfter: getTimelineRevision(),
        diagnostics: [{
          code: normalized.code,
          message: normalized.message,
          affectedClipIds: normalized.affectedClipIds,
        }],
      },
    };
  }
}

function planTimelineMutation(
  operation: TimelineMotionAdjustmentOperation,
  args: Record<string, unknown>,
  state: TimelineStore,
  compositionId: string,
): PlannedTimelineMutation {
  switch (operation) {
    case 'create':
      return planCreate(args, state, compositionId);
    case 'configure':
      return planConfigure(args, state, compositionId);
    case 'move':
      return planMove(args, state, compositionId);
    case 'trim':
      return planTrim(args, state, compositionId);
    case 'remove':
      return planRemove(args, state, compositionId);
  }
}

function planCreate(
  args: Record<string, unknown>,
  state: TimelineStore,
  compositionId: string,
): PlannedTimelineMutation {
  assertAllowedKeys(args, [
    'operation', 'expectedRevision', 'trackId', 'startTime', 'duration',
    'name', 'effects', 'opacity', 'blendMode',
  ]);
  const track = resolveUnlockedVideoTrack(args.trackId, state);
  const startTime = args.startTime === undefined
    ? getPlayheadPosition(state.playheadPosition)
    : finiteNumber(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
  const duration = args.duration === undefined
    ? 5
    : finiteNumber(args.duration, 'duration', 0.001, Number.MAX_SAFE_INTEGER);
  const name = args.name === undefined ? 'Adjustment' : nonEmptyString(args.name, 'name');
  if (name.length > 120) {
    throw mutationError('MD7_ADJUSTMENT_INVALID_INPUT', 'name must contain at most 120 characters');
  }
  const opacity = args.opacity === undefined
    ? 1
    : finiteNumber(args.opacity, 'opacity', 0, 1);
  const blendMode = args.blendMode === undefined
    ? 'normal'
    : parseBlendMode(args.blendMode);
  const parsedEffects = parseEffectList(args.effects ?? []);
  assertNoForeignEffectIds(parsedEffects.timelineEffects, state);

  const clipId = generateMotionClipId('adjustment');
  const motion = createDefaultMotionLayerDefinition('adjustment');
  const clip: TimelineClip = {
    id: clipId,
    trackId: track.id,
    name,
    file: new File(
      [JSON.stringify(motion)],
      'motion-adjustment.msmotion',
      { type: 'application/json' },
    ),
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { type: 'motion-adjustment', naturalDuration: duration },
    motion,
    transform: {
      ...structuredClone(DEFAULT_TRANSFORM),
      opacity,
      blendMode,
    },
    effects: parsedEffects.timelineEffects,
    isLoading: false,
  };
  const currentStack = buildAdjustmentStack(state.clips, state.tracks, state, compositionId);
  const nextClips = [...state.clips, clip];
  const candidateStack = buildAdjustmentStack(nextClips, state.tracks, state, compositionId);
  const layer = candidateStack.layers.find((candidate) => candidate.layerId === clipId);
  const insertIndex = candidateStack.layers.findIndex((candidate) => candidate.layerId === clipId);
  if (!layer || layer.kind !== 'adjustment' || insertIndex < 0) {
    throw mutationError('MD7_ADJUSTMENT_PLAN_REJECTED', 'Created adjustment was not admitted');
  }
  const semanticPlan = planCreateMotionAdjustment(currentStack, {
    expectedRevision: currentStack.revision,
    insertIndex,
    layer,
  });
  assertPlannedStackMatchesCandidate(semanticPlan.apply, candidateStack);

  return {
    operation: 'create',
    clipId,
    nextClips,
    nextClipKeyframes: state.clipKeyframes,
    before: null,
    after: snapshotAdjustmentClip(clip),
    createdEffectIds: parsedEffects.createdEffectIds,
    removedEffectIds: [],
    plannerKinds: ['create'],
    contractRevisionAfter: semanticPlan.apply.nextRevision,
    historyLabel: semanticPlan.history.label,
  };
}

function planConfigure(
  args: Record<string, unknown>,
  state: TimelineStore,
  compositionId: string,
): PlannedTimelineMutation {
  assertAllowedKeys(args, [
    'operation', 'expectedRevision', 'clipId', 'effects', 'opacity', 'blendMode',
  ]);
  if (args.effects === undefined && args.opacity === undefined && args.blendMode === undefined) {
    throw mutationError(
      'MD7_ADJUSTMENT_INVALID_INPUT',
      'configure requires effects, opacity, or blendMode',
    );
  }
  const target = requireMutableAdjustmentClip(args.clipId, state);
  const currentStack = buildAdjustmentStack(state.clips, state.tracks, state, compositionId);
  const parsedEffects = args.effects === undefined ? null : parseEffectList(args.effects);
  if (parsedEffects) {
    assertNoForeignEffectIds(parsedEffects.timelineEffects, state, target.id);
  }
  if (parsedEffects && hasEffectKeyframes(state, target.id)) {
    throw mutationError(
      'MD7_ADJUSTMENT_KEYFRAMES_CONFLICT',
      'Replacing adjustment effects requires removing their effect keyframes first',
      [target.id],
    );
  }
  if (args.opacity !== undefined && hasPropertyKeyframes(state, target.id, 'opacity')) {
    throw mutationError(
      'MD7_ADJUSTMENT_KEYFRAMES_CONFLICT',
      'Static adjustment opacity cannot replace animated opacity',
      [target.id],
    );
  }
  const opacity = args.opacity === undefined
    ? target.transform.opacity
    : finiteNumber(args.opacity, 'opacity', 0, 1);
  const blendMode = args.blendMode === undefined
    ? parseBlendMode(target.transform.blendMode)
    : parseBlendMode(args.blendMode);
  const nextEffects = parsedEffects?.timelineEffects ?? target.effects;
  const nextClip: TimelineClip = {
    ...target,
    transform: { ...target.transform, opacity, blendMode },
    effects: nextEffects.map((effect) => ({ ...effect, params: { ...effect.params } })),
  };
  if (sameAdjustmentAuthoringState(target, nextClip)) {
    throw mutationError(
      'MD7_ADJUSTMENT_NO_OP',
      `Adjustment ${target.id} already has the requested configuration`,
      [target.id],
    );
  }
  const nextClips = replaceClip(state.clips, nextClip);
  const candidateStack = buildAdjustmentStack(nextClips, state.tracks, state, compositionId);
  const candidateLayer = requireAdjustmentLayer(candidateStack, target.id);
  const semanticPlan = planConfigureMotionAdjustment(currentStack, {
    expectedRevision: currentStack.revision,
    layerId: target.id,
    enabled: candidateLayer.enabled,
    effects: candidateLayer.effects,
    mix: candidateLayer.mix,
  });
  assertPlannedStackMatchesCandidate(semanticPlan.apply, candidateStack);
  const previousIds = target.effects.map((effect) => effect.id);
  const nextIds = new Set(nextClip.effects.map((effect) => effect.id));

  return {
    operation: 'configure',
    clipId: target.id,
    nextClips,
    nextClipKeyframes: state.clipKeyframes,
    before: snapshotAdjustmentClip(target),
    after: snapshotAdjustmentClip(nextClip),
    createdEffectIds: parsedEffects?.createdEffectIds ?? [],
    removedEffectIds: parsedEffects
      ? previousIds.filter((effectId) => !nextIds.has(effectId))
      : [],
    plannerKinds: ['configure'],
    contractRevisionAfter: semanticPlan.apply.nextRevision,
    historyLabel: semanticPlan.history.label,
  };
}

function planMove(
  args: Record<string, unknown>,
  state: TimelineStore,
  compositionId: string,
): PlannedTimelineMutation {
  assertAllowedKeys(args, [
    'operation', 'expectedRevision', 'clipId', 'trackId', 'startTime',
  ]);
  if (args.trackId === undefined && args.startTime === undefined) {
    throw mutationError('MD7_ADJUSTMENT_INVALID_INPUT', 'move requires trackId or startTime');
  }
  const target = requireMutableAdjustmentClip(args.clipId, state);
  const sourceTrack = state.tracks.find((track) => track.id === target.trackId);
  if (sourceTrack?.locked === true) {
    throw mutationError('MD7_ADJUSTMENT_TRACK_LOCKED', `Track is locked: ${sourceTrack.id}`, [target.id]);
  }
  const targetTrack = args.trackId === undefined
    ? requireUnlockedVideoTrack(target.trackId, state)
    : resolveUnlockedVideoTrack(args.trackId, state);
  const startTime = args.startTime === undefined
    ? target.startTime
    : finiteNumber(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
  if (target.trackId === targetTrack.id && target.startTime === startTime) {
    throw mutationError('MD7_ADJUSTMENT_NO_OP', `Adjustment ${target.id} is already at that position`, [target.id]);
  }
  const nextClip: TimelineClip = { ...target, trackId: targetTrack.id, startTime };
  const nextClips = replaceClip(state.clips, nextClip);
  const currentStack = buildAdjustmentStack(state.clips, state.tracks, state, compositionId);
  const candidateStack = buildAdjustmentStack(nextClips, state.tracks, state, compositionId);
  let workingStack = currentStack;
  const plans: MotionAdjustmentMutationPlan[] = [];
  const currentLayer = requireAdjustmentLayer(currentStack, target.id);
  const candidateLayer = requireAdjustmentLayer(candidateStack, target.id);
  if (
    currentLayer.activeRange.start !== candidateLayer.activeRange.start
    || currentLayer.activeRange.end !== candidateLayer.activeRange.end
  ) {
    const trimPlan = planTrimMotionAdjustment(workingStack, {
      expectedRevision: workingStack.revision,
      layerId: target.id,
      activeRange: candidateLayer.activeRange,
    });
    plans.push(trimPlan);
    workingStack = trimPlan.apply.stack;
  }
  const beforeIndex = workingStack.layers.findIndex((layer) => layer.layerId === target.id);
  const afterIndex = candidateStack.layers.findIndex((layer) => layer.layerId === target.id);
  if (beforeIndex !== afterIndex) {
    const movePlan = planMoveMotionAdjustment(workingStack, {
      expectedRevision: workingStack.revision,
      layerId: target.id,
      toIndex: afterIndex,
    });
    plans.push(movePlan);
    workingStack = movePlan.apply.stack;
  }
  const contractRevisionAfter = plans.length > 0
    ? plans[plans.length - 1]!.apply.nextRevision
    : currentStack.revision + 1;
  const admittedCandidate = { ...candidateStack, revision: contractRevisionAfter };
  planMotionAdjustmentOperations(admittedCandidate);
  assertStackPayloadMatches(workingStack, admittedCandidate);

  return {
    operation: 'move',
    clipId: target.id,
    nextClips,
    nextClipKeyframes: state.clipKeyframes,
    before: snapshotAdjustmentClip(target),
    after: snapshotAdjustmentClip(nextClip),
    createdEffectIds: [],
    removedEffectIds: [],
    plannerKinds: plans.length > 0
      ? plans.map((plan) => plan.kind)
      : ['admit-stack'],
    contractRevisionAfter,
    historyLabel: 'Move Adjustment Layer',
  };
}

function planTrim(
  args: Record<string, unknown>,
  state: TimelineStore,
  compositionId: string,
): PlannedTimelineMutation {
  assertAllowedKeys(args, [
    'operation', 'expectedRevision', 'clipId', 'startTime', 'duration',
  ]);
  if (args.startTime === undefined && args.duration === undefined) {
    throw mutationError('MD7_ADJUSTMENT_INVALID_INPUT', 'trim requires startTime or duration');
  }
  const target = requireMutableAdjustmentClip(args.clipId, state);
  const startTime = args.startTime === undefined
    ? target.startTime
    : finiteNumber(args.startTime, 'startTime', 0, Number.MAX_SAFE_INTEGER);
  const duration = args.duration === undefined
    ? target.duration
    : finiteNumber(args.duration, 'duration', 0.001, Number.MAX_SAFE_INTEGER);
  if (target.startTime === startTime && target.duration === duration) {
    throw mutationError('MD7_ADJUSTMENT_NO_OP', `Adjustment ${target.id} already has that range`, [target.id]);
  }
  const nextClip: TimelineClip = {
    ...target,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { ...target.source!, naturalDuration: duration },
  };
  const nextClips = replaceClip(state.clips, nextClip);
  const currentStack = buildAdjustmentStack(state.clips, state.tracks, state, compositionId);
  const candidateStack = buildAdjustmentStack(nextClips, state.tracks, state, compositionId);
  const candidateLayer = requireAdjustmentLayer(candidateStack, target.id);
  const semanticPlan = planTrimMotionAdjustment(currentStack, {
    expectedRevision: currentStack.revision,
    layerId: target.id,
    activeRange: candidateLayer.activeRange,
  });
  assertPlannedStackMatchesCandidate(semanticPlan.apply, candidateStack);

  return {
    operation: 'trim',
    clipId: target.id,
    nextClips,
    nextClipKeyframes: state.clipKeyframes,
    before: snapshotAdjustmentClip(target),
    after: snapshotAdjustmentClip(nextClip),
    createdEffectIds: [],
    removedEffectIds: [],
    plannerKinds: ['trim'],
    contractRevisionAfter: semanticPlan.apply.nextRevision,
    historyLabel: semanticPlan.history.label,
  };
}

function planRemove(
  args: Record<string, unknown>,
  state: TimelineStore,
  compositionId: string,
): PlannedTimelineMutation {
  assertAllowedKeys(args, ['operation', 'expectedRevision', 'clipId']);
  const target = requireMutableAdjustmentClip(args.clipId, state);
  const linkedChildIds = state.clips
    .filter((clip) => clip.parentClipId === target.id)
    .map((clip) => clip.id);
  if (target.parentClipId || linkedChildIds.length > 0) {
    throw mutationError(
      'MD7_ADJUSTMENT_STRUCTURE_CONFLICT',
      'Remove the adjustment parenting links before deleting the layer',
      [target.id, ...linkedChildIds],
    );
  }
  const currentStack = buildAdjustmentStack(state.clips, state.tracks, state, compositionId);
  const semanticPlan = planRemoveMotionAdjustment(currentStack, {
    expectedRevision: currentStack.revision,
    layerId: target.id,
  });
  const nextClips = state.clips.filter((clip) => clip.id !== target.id);
  const candidateStack = buildAdjustmentStack(nextClips, state.tracks, state, compositionId);
  assertPlannedStackMatchesCandidate(semanticPlan.apply, candidateStack);
  const nextClipKeyframes = new Map(state.clipKeyframes);
  nextClipKeyframes.delete(target.id);

  return {
    operation: 'remove',
    clipId: target.id,
    nextClips,
    nextClipKeyframes,
    before: snapshotAdjustmentClip(target),
    after: null,
    createdEffectIds: [],
    removedEffectIds: target.effects.map((effect) => effect.id),
    plannerKinds: ['remove'],
    contractRevisionAfter: semanticPlan.apply.nextRevision,
    historyLabel: semanticPlan.history.label,
  };
}

function applyPlannedTimelineMutation(
  plan: PlannedTimelineMutation,
  state: TimelineStore,
): void {
  const batch = startBatch(plan.historyLabel);
  const before = {
    clips: state.clips,
    clipKeyframes: state.clipKeyframes,
    duration: state.duration,
    selectedClipIds: state.selectedClipIds,
    primarySelectedClipId: state.primarySelectedClipId,
  };
  const selectedClipIds = plan.operation === 'remove'
    ? new Set([...state.selectedClipIds].filter((clipId) => clipId !== plan.clipId))
    : new Set([plan.clipId]);
  const primarySelectedClipId = plan.operation === 'remove'
    ? (state.primarySelectedClipId === plan.clipId
        ? [...selectedClipIds][0] ?? null
        : state.primarySelectedClipId)
    : plan.clipId;

  try {
    useTimelineStore.setState({
      clips: plan.nextClips,
      clipKeyframes: plan.nextClipKeyframes,
      duration: state.durationLocked
        ? state.duration
        : calculateTimelineDuration(plan.nextClips),
      selectedClipIds,
      primarySelectedClipId,
    });
    const nextState = useTimelineStore.getState();
    const actualAfter = findAdjustmentSnapshot(plan.clipId, nextState);
    const reachedPostcondition = plan.operation === 'remove'
      ? actualAfter === null
      : actualAfter !== null && JSON.stringify(actualAfter) === JSON.stringify(plan.after);
    if (!reachedPostcondition) {
      throw mutationError(
        'MD7_ADJUSTMENT_POSTCONDITION_FAILED',
        `Adjustment ${plan.operation} did not reach its requested final state`,
        [plan.clipId],
      );
    }
    nextState.invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestRender();
  } catch (error) {
    useTimelineStore.setState(before);
    if (batch.opened) cancelHistoryBatch();
    throw error;
  }
  if (batch.opened) endBatch();
}

function buildAdjustmentStack(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  state: TimelineStore,
  compositionId: string,
): MotionAdjustmentStackContract {
  const trackIndices = new Map(tracks.map((track, index) => [track.id, index]));
  const clipIndices = new Map(clips.map((clip, index) => [clip.id, index]));
  const layers = clips
    .filter((clip) => clip.source?.type === 'motion-adjustment')
    .sort((left, right) => (
      (trackIndices.get(left.trackId) ?? Number.MAX_SAFE_INTEGER)
      - (trackIndices.get(right.trackId) ?? Number.MAX_SAFE_INTEGER)
      || (clipIndices.get(left.id) ?? 0) - (clipIndices.get(right.id) ?? 0)
    ))
    .map((clip) => timelineClipToAdjustmentLayer(clip, state));
  const stack: MotionAdjustmentStackContract = {
    contractVersion: MOTION_ADJUSTMENT_STACK_CONTRACT_VERSION,
    revision: state.timelineRevision,
    compositionId,
    evaluationTime: getPlayheadPosition(state.playheadPosition),
    inputOrder: 'top-to-bottom',
    layers,
  };
  planMotionAdjustmentOperations(stack);
  return stack;
}

function timelineClipToAdjustmentLayer(
  clip: TimelineClip,
  state: TimelineStore,
): MotionAdjustmentLayerContract {
  if (clip.source?.type !== 'motion-adjustment' || clip.motion?.kind !== 'adjustment') {
    throw mutationError(
      'MD7_ADJUSTMENT_INVALID_CLIP',
      `Clip is not a native Motion Adjustment: ${clip.id}`,
      [clip.id],
    );
  }
  if (
    clip.is3D === true
    || clip.sourceRect !== undefined
    || clip.transitionRender !== undefined
    || clip.colorCorrection !== undefined
    || clip.nodeGraph !== undefined
    || clip.parentClipId !== undefined
  ) {
    throw mutationError(
      'MD7_ADJUSTMENT_UNSUPPORTED_STATE',
      `Adjustment ${clip.id} uses unsupported v1 layer state`,
      [clip.id],
    );
  }
  const transform = clip.transform;
  const identity = IDENTITY_ADJUSTMENT_TRANSFORM;
  if (
    transform.position.x !== identity.x
    || transform.position.y !== identity.y
    || transform.position.z !== 0
    || transform.scale.x !== identity.scaleX
    || transform.scale.y !== identity.scaleY
    || (transform.scale.z ?? 1) !== 1
    || transform.rotation.x !== 0
    || transform.rotation.y !== 0
    || transform.rotation.z !== identity.rotation
  ) {
    throw mutationError(
      'MD7_ADJUSTMENT_NON_IDENTITY_TRANSFORM',
      `Adjustment ${clip.id} must keep the identity transform in v1`,
      [clip.id],
    );
  }
  const effects = adaptTimelineEffectsToMotionAdjustmentContracts({
    layerId: clip.id,
    effects: clip.effects.map((effect) => ({
      id: effect.id,
      name: effect.name,
      type: effect.type,
      enabled: effect.enabled,
      params: effect.params as JsonObject,
    })),
  });
  const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
  if (!track || track.type !== 'video') {
    throw mutationError(
      'MD7_ADJUSTMENT_TRACK_INVALID',
      `Adjustment ${clip.id} is not on a video track`,
      [clip.id],
    );
  }
  const mix = {
    opacity: finiteNumber(transform.opacity, 'opacity', 0, 1),
    blendMode: parseBlendMode(transform.blendMode),
    masks: (clip.masks ?? []).filter((mask) => mask.enabled).map((mask) => {
      if (!mask.closed || Object.keys(mask.edgeFeathers ?? {}).length > 0) {
        throw mutationError(
          'MD7_ADJUSTMENT_UNSUPPORTED_MASK',
          `Adjustment ${clip.id} has a mask outside the v1 contract`,
          [clip.id],
        );
      }
      return {
        id: mask.id,
        mode: mask.mode,
        inverted: mask.inverted,
        opacity: mask.opacity,
        feather: mask.feather,
        points: mask.vertices.map((point) => ({
          x: point.x + mask.position.x,
          y: point.y + mask.position.y,
        })),
      };
    }),
  } satisfies MotionAdjustmentLayerContract['mix'];
  const layer: MotionAdjustmentLayerContract = {
    ...createDefaultMotionAdjustmentLayer(clip.id, {
      start: clip.startTime,
      end: clip.startTime + clip.duration,
    }),
    enabled: track.visible !== false,
    mix,
    effects,
  };
  return layer;
}

function parseEffectList(value: unknown): ParsedEffectList {
  if (!Array.isArray(value)) {
    throw mutationError('MD7_ADJUSTMENT_INVALID_EFFECT', 'effects must be an array');
  }
  const contracts: MotionAdjustmentEffectContract[] = [];
  const timelineEffects: Effect[] = [];
  const createdEffectIds: string[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const effect = value[index];
    if (!isPlainRecord(effect)) {
      throw mutationError('MD7_ADJUSTMENT_INVALID_EFFECT', `effects[${index}] must be an object`);
    }
    assertAllowedKeys(effect, ['id', 'type', 'enabled', 'parameters']);
    const effectType = nonEmptyString(effect.type, `effects[${index}].type`);
    if (!isSupportedAdjustmentEffectType(effectType)) {
      throw mutationError(
        'MD7_ADJUSTMENT_UNSUPPORTED_EFFECT',
        `Unsupported Adjustment 1.0 effect: ${effectType}. Supported: ${SUPPORTED_ADJUSTMENT_EFFECT_TYPES.join(', ')}`,
      );
    }
    const suppliedId = effect.id === undefined
      ? undefined
      : nonEmptyString(effect.id, `effects[${index}].id`);
    const effectId = suppliedId ?? generateEffectId();
    if (!isMotionAdjustmentStableId(effectId)) {
      throw mutationError('MD7_ADJUSTMENT_INVALID_EFFECT', `Invalid stable effect id: ${effectId}`);
    }
    if (ids.has(effectId)) {
      throw mutationError('MD7_ADJUSTMENT_INVALID_EFFECT', `Duplicate adjustment effect id: ${effectId}`);
    }
    ids.add(effectId);
    const enabled = effect.enabled === undefined
      ? true
      : booleanValue(effect.enabled, `effects[${index}].enabled`);
    const parameters = normalizeAdjustmentEffectParameters(
      effectType,
      effect.parameters ?? {},
    );
    const contract: MotionAdjustmentEffectContract = {
      id: effectId,
      effectType,
      enabled,
      parameters,
    };
    contracts.push(contract);
    timelineEffects.push({
      id: effectId,
      name: adjustmentEffectName(effectType),
      type: effectType,
      enabled,
      params: { ...parameters },
    });
    if (!suppliedId) createdEffectIds.push(effectId);
  }
  // The frozen adapter is the final timeline-shape admission gate as well.
  adaptTimelineEffectsToMotionAdjustmentContracts({
    layerId: 'adjustment:ai-preflight',
    effects: timelineEffects.map((effect) => ({
      id: effect.id,
      name: effect.name,
      type: effect.type,
      enabled: effect.enabled,
      params: effect.params as JsonObject,
    })),
  });
  return { contracts, timelineEffects, createdEffectIds };
}

function requireMutableAdjustmentClip(value: unknown, state: TimelineStore): TimelineClip {
  const clipId = nonEmptyString(value, 'clipId');
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw mutationError('MD7_ADJUSTMENT_NOT_FOUND', `Clip not found: ${clipId}`, [clipId]);
  }
  if (clip.source?.type !== 'motion-adjustment' || clip.motion?.kind !== 'adjustment') {
    throw mutationError(
      'MD7_ADJUSTMENT_INVALID_CLIP',
      `Clip is not a native Motion Adjustment: ${clipId}`,
      [clipId],
    );
  }
  const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
  if (!track || track.type !== 'video') {
    throw mutationError('MD7_ADJUSTMENT_TRACK_INVALID', `Adjustment track is invalid: ${clip.trackId}`, [clipId]);
  }
  if (track.locked === true) {
    throw mutationError('MD7_ADJUSTMENT_TRACK_LOCKED', `Track is locked: ${track.id}`, [clipId]);
  }
  return clip;
}

function resolveUnlockedVideoTrack(value: unknown, state: TimelineStore): TimelineTrack {
  if (value === undefined) {
    const track = state.tracks.find((candidate) => (
      candidate.type === 'video' && candidate.visible !== false && candidate.locked !== true
    )) ?? state.tracks.find((candidate) => (
      candidate.type === 'video' && candidate.locked !== true
    ));
    if (!track) {
      throw mutationError('MD7_ADJUSTMENT_TRACK_INVALID', 'No unlocked video track is available');
    }
    return track;
  }
  return requireUnlockedVideoTrack(nonEmptyString(value, 'trackId'), state);
}

function requireUnlockedVideoTrack(trackId: string, state: TimelineStore): TimelineTrack {
  const track = state.tracks.find((candidate) => candidate.id === trackId);
  if (!track || track.type !== 'video') {
    throw mutationError('MD7_ADJUSTMENT_TRACK_INVALID', `Video track not found: ${trackId}`);
  }
  if (track.locked === true) {
    throw mutationError('MD7_ADJUSTMENT_TRACK_LOCKED', `Track is locked: ${trackId}`);
  }
  return track;
}

function requireAdjustmentLayer(
  stack: MotionAdjustmentStackContract,
  clipId: string,
): MotionAdjustmentLayerContract {
  const layer = stack.layers.find((candidate) => candidate.layerId === clipId);
  if (!layer || layer.kind !== 'adjustment') {
    throw mutationError('MD7_ADJUSTMENT_PLAN_REJECTED', `Adjustment layer missing from contract: ${clipId}`);
  }
  return layer;
}

function snapshotAdjustmentClip(clip: TimelineClip): TimelineMotionAdjustmentSnapshot {
  const effects = adaptTimelineEffectsToMotionAdjustmentContracts({
    layerId: clip.id,
    effects: clip.effects.map((effect) => ({
      id: effect.id,
      name: effect.name,
      type: effect.type,
      enabled: effect.enabled,
      params: effect.params as JsonObject,
    })),
  });
  return {
    clipId: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    opacity: clip.transform.opacity,
    blendMode: parseBlendMode(clip.transform.blendMode),
    effects,
  };
}

function findAdjustmentSnapshot(
  clipId: string,
  state: TimelineStore,
): TimelineMotionAdjustmentSnapshot | null {
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  return clip?.source?.type === 'motion-adjustment'
    ? snapshotAdjustmentClip(clip)
    : null;
}

function assertPlannedStackMatchesCandidate(
  direction: MotionAdjustmentMutationDirection,
  candidate: MotionAdjustmentStackContract,
): void {
  assertStackPayloadMatches(direction.stack, candidate);
}

function assertStackPayloadMatches(
  actual: MotionAdjustmentStackContract,
  candidate: MotionAdjustmentStackContract,
): void {
  if (
    actual.compositionId !== candidate.compositionId
    || actual.evaluationTime !== candidate.evaluationTime
    || JSON.stringify(actual.layers) !== JSON.stringify(candidate.layers)
  ) {
    throw mutationError(
      'MD7_ADJUSTMENT_PLAN_REJECTED',
      'Frozen adjustment planner output diverged from the timeline candidate',
    );
  }
}

function calculateTimelineDuration(clips: readonly TimelineClip[]): number {
  if (clips.length === 0) return 60;
  return Math.max(60, Math.max(...clips.map((clip) => clip.startTime + clip.duration)) + 10);
}

function replaceClip(clips: readonly TimelineClip[], nextClip: TimelineClip): TimelineClip[] {
  return clips.map((clip) => clip.id === nextClip.id ? nextClip : clip);
}

function sameAdjustmentAuthoringState(left: TimelineClip, right: TimelineClip): boolean {
  return left.transform.opacity === right.transform.opacity
    && left.transform.blendMode === right.transform.blendMode
    && JSON.stringify(left.effects) === JSON.stringify(right.effects);
}

function hasEffectKeyframes(state: TimelineStore, clipId: string): boolean {
  return (state.clipKeyframes.get(clipId) ?? []).some((keyframe) => (
    typeof keyframe.property === 'string' && keyframe.property.startsWith('effect.')
  ));
}

function assertNoForeignEffectIds(
  effects: readonly Effect[],
  state: TimelineStore,
  ownerClipId?: string,
): void {
  const foreignEffectIds = new Set(state.clips.flatMap((clip) => (
    clip.id === ownerClipId ? [] : clip.effects.map((effect) => effect.id)
  )));
  const collision = effects.find((effect) => foreignEffectIds.has(effect.id));
  if (collision) {
    throw mutationError(
      'MD7_ADJUSTMENT_INVALID_EFFECT',
      `Adjustment effect id is already owned by another clip: ${collision.id}`,
      ownerClipId ? [ownerClipId] : [],
    );
  }
}

function hasPropertyKeyframes(
  state: TimelineStore,
  clipId: string,
  property: string,
): boolean {
  return (state.clipKeyframes.get(clipId) ?? []).some((keyframe) => keyframe.property === property);
}

function resolveCompositionId(): string {
  const compositionId = useMediaStore.getState().activeCompositionId ?? 'timeline:active';
  if (!isMotionAdjustmentStableId(compositionId)) {
    throw mutationError(
      'MD7_ADJUSTMENT_COMPOSITION_INVALID',
      'Active composition id is outside the Adjustment 1.0 stable-id contract',
    );
  }
  return compositionId;
}

function parseOperation(value: unknown): TimelineMotionAdjustmentOperation {
  if (
    value === 'create'
    || value === 'configure'
    || value === 'move'
    || value === 'trim'
    || value === 'remove'
  ) {
    return value;
  }
  throw mutationError(
    'MD7_ADJUSTMENT_INVALID_INPUT',
    'operation must be one of: create, configure, move, trim, remove',
  );
}

function parseOptionalRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw mutationError('MD7_ADJUSTMENT_INVALID_INPUT', 'expectedRevision must be a non-negative safe integer');
  }
  return value as number;
}

function parseBlendMode(value: unknown): MotionAdjustmentBlendMode {
  if (typeof value === 'string' && ADJUSTMENT_BLEND_MODES.includes(
    value as MotionAdjustmentBlendMode,
  )) {
    return value as MotionAdjustmentBlendMode;
  }
  throw mutationError(
    'MD7_ADJUSTMENT_UNSUPPORTED_BLEND_MODE',
    `blendMode must be one of: ${ADJUSTMENT_BLEND_MODES.join(', ')}`,
  );
}

function finiteNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    throw mutationError(
      'MD7_ADJUSTMENT_INVALID_INPUT',
      `${field} must be a finite number from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw mutationError('MD7_ADJUSTMENT_INVALID_INPUT', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw mutationError('MD7_ADJUSTMENT_INVALID_INPUT', `${field} must be a boolean`);
  }
  return value;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unknownKey = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknownKey) {
    throw mutationError('MD7_ADJUSTMENT_INVALID_INPUT', `Unsupported field: ${unknownKey}`);
  }
}

function adjustmentEffectName(effectType: string): string {
  return effectType.split('-').map((part) => (
    `${part.charAt(0).toUpperCase()}${part.slice(1)}`
  )).join(' ');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mutationError(
  code: string,
  message: string,
  affectedClipIds: readonly string[] = [],
): TimelineMotionAdjustmentMutationError {
  return new TimelineMotionAdjustmentMutationError(code, message, affectedClipIds);
}

function normalizeMutationError(error: unknown): TimelineMotionAdjustmentMutationError {
  if (error instanceof TimelineMotionAdjustmentMutationError) return error;
  if (error instanceof Error) {
    const code = typeof (error as Error & { code?: unknown }).code === 'string'
      ? String((error as Error & { code: string }).code)
      : 'MD7_ADJUSTMENT_PLAN_REJECTED';
    return mutationError(code, error.message);
  }
  return mutationError('MD7_ADJUSTMENT_PLAN_REJECTED', String(error));
}
