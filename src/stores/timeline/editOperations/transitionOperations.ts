import type { TimelineClip, TimelineTrack, TimelineTransition } from '../../../types';
import {
  getDefaultTransitionParams,
  getTransition,
  type TransitionParamValue,
  type TransitionType,
} from '../../../transitions';
import type { TimelinePropertiesSelection } from '../storeTypes/toolTypes';
import type { TransitionSourceDurationResolver } from './transitionPlanner';
import type {
  TransitionApplyOperation,
  TransitionJunctionGeometryReference,
  TransitionRemoveOperation,
  TransitionUpdateDurationOperation,
  TransitionUpdateOffsetOperation,
  TransitionUpdateTypeOperation,
  TransitionUpdateParamsOperation,
} from './transactionTypes';
import type { TimelineEditWarning } from './types';
import { DEFAULT_TRANSITION_PLACEMENT, planTransition } from './transitionPlanner';

interface TransitionOperationApplyResult {
  clips: TimelineClip[];
  changedClipIds: string[];
  warnings: TimelineEditWarning[];
  resolvedDuration?: number;
}

interface CreateTransitionJunctionReferenceInput {
  operationId: string;
  trackId: string;
  clipAId: string;
  clipBId: string;
  junctionTime: number;
  thresholdSeconds: number;
  thresholdPx?: number;
  geometrySnapshotId?: string;
}

const EPSILON = 1e-6;
const TRANSITION_JUNCTION_EPSILON = 0.0001;

interface TransitionPruneResult {
  clips: TimelineClip[];
  changedClipIds: string[];
}

export function createTransitionJunctionGeometryReference({
  operationId,
  trackId,
  clipAId,
  clipBId,
  junctionTime,
  thresholdSeconds,
  thresholdPx,
  geometrySnapshotId = `transition-geometry:${operationId}`,
}: CreateTransitionJunctionReferenceInput): TransitionJunctionGeometryReference {
  return {
    geometrySnapshotId,
    trackId,
    clipAId,
    clipBId,
    junctionTime,
    junctionRect: {
      geometrySnapshotId,
      rectId: `${operationId}:junction`,
      kind: 'transition-junction',
    },
    dropZoneRect: {
      geometrySnapshotId,
      rectId: `${operationId}:drop-zone`,
      kind: 'transition-drop-zone',
    },
    transitionBodyRect: {
      geometrySnapshotId,
      rectId: `${operationId}:body`,
      kind: 'transition-body',
    },
    thresholdSeconds,
    ...(thresholdPx !== undefined ? { thresholdPx } : {}),
  };
}

export function applyTransitionApplyOperation(
  operation: TransitionApplyOperation,
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  getMediaDuration?: TransitionSourceDurationResolver,
): TransitionOperationApplyResult {
  const clipA = clips.find(clip => clip.id === operation.clipAId);
  const clipB = clips.find(clip => clip.id === operation.clipBId);
  const warnings = validateTransitionPair(
    clips,
    tracks,
    {
      clipA,
      clipB,
      clipAId: operation.clipAId,
      clipBId: operation.clipBId,
      transitionType: operation.transitionType,
      requestedDuration: operation.requestedDuration,
    },
  );
  if (warnings.length > 0) return unchanged(clips, warnings);

  const plan = planTransition({
    outgoingClip: clipA!,
    incomingClip: clipB!,
    transitionType: operation.transitionType,
    requestedDuration: operation.requestedDuration,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    junctionTime: operation.junction.junctionTime,
    getMediaDuration,
  });
  if (!plan) {
    return unchanged(clips, [{
      code: 'invalid-range',
      message: 'Transition duration cannot be resolved for the selected clips.',
      clipId: operation.clipAId,
      trackId: clipA!.trackId,
    }]);
  }

  return applyTransitionBetweenClips(
    clips,
    operation.clipAId,
    operation.clipBId,
    operation.transitionType,
    plan.resolvedDuration,
    operation.id,
    0,
    operation.params,
  );
}

export function applyTransitionRemoveOperation(
  operation: TransitionRemoveOperation,
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
): TransitionOperationApplyResult {
  const clip = clips.find(candidate => candidate.id === operation.clipId);
  if (!clip) {
    return unchanged(clips, [{
      code: 'clip-not-found',
      message: `Clip not found: ${operation.clipId}`,
      clipId: operation.clipId,
    }]);
  }

  const transition = operation.edge === 'in' ? clip.transitionIn : clip.transitionOut;
  if (!transition) {
    return unchanged(clips, [{
      code: 'no-op',
      message: `Clip has no ${operation.edge} transition.`,
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  if (operation.transitionId && transition.id !== operation.transitionId) {
    return unchanged(clips, [{
      code: 'no-op',
      message: 'Transition id did not match the requested clip edge.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  const linkedClip = clips.find(candidate => candidate.id === transition.linkedClipId);
  const lockedWarning = getTransitionLockedWarning(clips, tracks, [clip.id, transition.linkedClipId]);
  if (lockedWarning) return unchanged(clips, [lockedWarning]);

  const changedClipIds = uniqueIds([clip.id, ...(linkedClip ? [linkedClip.id] : [])]);
  const nextClips = clips.map(candidate => {
    if (candidate.id === clip.id) {
      return operation.edge === 'in'
        ? { ...candidate, transitionIn: undefined }
        : { ...candidate, transitionOut: undefined };
    }
    if (candidate.id === transition.linkedClipId) {
      return operation.edge === 'in'
        ? { ...candidate, transitionOut: undefined }
        : { ...candidate, transitionIn: undefined };
    }
    return candidate;
  });

  return {
    clips: nextClips,
    changedClipIds,
    warnings: linkedClip ? [] : [{
      code: 'clip-not-found',
      message: `Linked transition clip not found: ${transition.linkedClipId}`,
      clipId: transition.linkedClipId,
    }],
  };
}

export function applyTransitionUpdateDurationOperation(
  operation: TransitionUpdateDurationOperation,
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  getMediaDuration?: TransitionSourceDurationResolver,
): TransitionOperationApplyResult {
  const clip = clips.find(candidate => candidate.id === operation.clipId);
  if (!clip) {
    return unchanged(clips, [{
      code: 'clip-not-found',
      message: `Clip not found: ${operation.clipId}`,
      clipId: operation.clipId,
    }]);
  }

  const transition = operation.edge === 'in' ? clip.transitionIn : clip.transitionOut;
  if (!transition) {
    return unchanged(clips, [{
      code: 'no-op',
      message: `Clip has no ${operation.edge} transition.`,
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  if (operation.transitionId && transition.id !== operation.transitionId) {
    return unchanged(clips, [{
      code: 'no-op',
      message: 'Transition id did not match the requested clip edge.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  const clipAId = operation.edge === 'in' ? transition.linkedClipId : operation.clipId;
  const clipBId = operation.edge === 'in' ? operation.clipId : transition.linkedClipId;
  const clipA = clips.find(candidate => candidate.id === clipAId);
  const clipB = clips.find(candidate => candidate.id === clipBId);
  const warnings = validateTransitionPair(
    clips,
    tracks,
    {
      clipA,
      clipB,
      clipAId,
      clipBId,
      transitionType: transition.type,
      requestedDuration: operation.requestedDuration,
    },
  );
  if (warnings.length > 0) return unchanged(clips, warnings);

  const plan = planTransition({
    outgoingClip: clipA!,
    incomingClip: clipB!,
    transitionType: transition.type,
    requestedDuration: operation.requestedDuration,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    junctionTime: operation.junction?.junctionTime,
    bodyOffset: transition.offset ?? 0,
    getMediaDuration,
  });
  if (!plan) {
    return unchanged(clips, [{
      code: 'invalid-range',
      message: 'Transition duration cannot be resolved for the selected clips.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  return applyTransitionBetweenClips(
    clips,
    clipAId,
    clipBId,
    transition.type,
    plan.resolvedDuration,
    transition.id,
    plan.bodyOffset,
    transition.params,
  );
}

export function applyTransitionUpdateOffsetOperation(
  operation: TransitionUpdateOffsetOperation,
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  getMediaDuration?: TransitionSourceDurationResolver,
): TransitionOperationApplyResult {
  const clip = clips.find(candidate => candidate.id === operation.clipId);
  if (!clip) {
    return unchanged(clips, [{
      code: 'clip-not-found',
      message: `Clip not found: ${operation.clipId}`,
      clipId: operation.clipId,
    }]);
  }

  const transition = operation.edge === 'in' ? clip.transitionIn : clip.transitionOut;
  if (!transition) {
    return unchanged(clips, [{
      code: 'no-op',
      message: `Clip has no ${operation.edge} transition.`,
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  if (operation.transitionId && transition.id !== operation.transitionId) {
    return unchanged(clips, [{
      code: 'no-op',
      message: 'Transition id did not match the requested clip edge.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  if (!Number.isFinite(operation.requestedOffset)) {
    return unchanged(clips, [{
      code: 'invalid-range',
      message: 'Transition offset must be a finite number.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  const clipAId = operation.edge === 'in' ? transition.linkedClipId : operation.clipId;
  const clipBId = operation.edge === 'in' ? operation.clipId : transition.linkedClipId;
  const clipA = clips.find(candidate => candidate.id === clipAId);
  const clipB = clips.find(candidate => candidate.id === clipBId);
  const warnings = validateTransitionPair(
    clips,
    tracks,
    {
      clipA,
      clipB,
      clipAId,
      clipBId,
      transitionType: transition.type,
      requestedDuration: transition.duration,
    },
  );
  if (warnings.length > 0) return unchanged(clips, warnings);

  const plan = planTransition({
    outgoingClip: clipA!,
    incomingClip: clipB!,
    transitionType: transition.type,
    requestedDuration: transition.duration,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    junctionTime: operation.junction?.junctionTime,
    bodyOffset: operation.requestedOffset,
    getMediaDuration,
  });
  if (!plan) {
    return unchanged(clips, [{
      code: 'invalid-range',
      message: 'Transition offset cannot be resolved for the selected clips.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  return applyTransitionBetweenClips(
    clips,
    clipAId,
    clipBId,
    transition.type,
    transition.duration,
    transition.id,
    plan.bodyOffset,
    transition.params,
  );
}

export function applyTransitionUpdateTypeOperation(
  operation: TransitionUpdateTypeOperation,
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  getMediaDuration?: TransitionSourceDurationResolver,
): TransitionOperationApplyResult {
  const clip = clips.find(candidate => candidate.id === operation.clipId);
  if (!clip) {
    return unchanged(clips, [{
      code: 'clip-not-found',
      message: `Clip not found: ${operation.clipId}`,
      clipId: operation.clipId,
    }]);
  }

  const transition = operation.edge === 'in' ? clip.transitionIn : clip.transitionOut;
  if (!transition) {
    return unchanged(clips, [{
      code: 'no-op',
      message: `Clip has no ${operation.edge} transition.`,
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  if (operation.transitionId && transition.id !== operation.transitionId) {
    return unchanged(clips, [{
      code: 'no-op',
      message: 'Transition id did not match the requested clip edge.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  const clipAId = operation.edge === 'in' ? transition.linkedClipId : operation.clipId;
  const clipBId = operation.edge === 'in' ? operation.clipId : transition.linkedClipId;
  const clipA = clips.find(candidate => candidate.id === clipAId);
  const clipB = clips.find(candidate => candidate.id === clipBId);
  const warnings = validateTransitionPair(
    clips,
    tracks,
    {
      clipA,
      clipB,
      clipAId,
      clipBId,
      transitionType: operation.transitionType,
      requestedDuration: transition.duration,
    },
  );
  if (warnings.length > 0) return unchanged(clips, warnings);

  const plan = planTransition({
    outgoingClip: clipA!,
    incomingClip: clipB!,
    transitionType: operation.transitionType,
    requestedDuration: transition.duration,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    junctionTime: clipA!.startTime + clipA!.duration,
    bodyOffset: transition.offset ?? 0,
    getMediaDuration,
  });
  if (!plan) {
    return unchanged(clips, [{
      code: 'invalid-range',
      message: 'Transition type cannot be resolved for the selected clips.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  return applyTransitionBetweenClips(
    clips,
    clipAId,
    clipBId,
    operation.transitionType,
    plan.resolvedDuration,
    transition.id,
    plan.bodyOffset,
    operation.params,
  );
}

export function applyTransitionUpdateParamsOperation(
  operation: TransitionUpdateParamsOperation,
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
): TransitionOperationApplyResult {
  const clip = clips.find(candidate => candidate.id === operation.clipId);
  if (!clip) {
    return unchanged(clips, [{
      code: 'clip-not-found',
      message: `Clip not found: ${operation.clipId}`,
      clipId: operation.clipId,
    }]);
  }

  const transition = operation.edge === 'in' ? clip.transitionIn : clip.transitionOut;
  if (!transition) {
    return unchanged(clips, [{
      code: 'no-op',
      message: `Clip has no ${operation.edge} transition.`,
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  if (operation.transitionId && transition.id !== operation.transitionId) {
    return unchanged(clips, [{
      code: 'no-op',
      message: 'Transition id did not match the requested clip edge.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  const linkedClip = clips.find(candidate => candidate.id === transition.linkedClipId);
  const lockedWarning = getTransitionLockedWarning(clips, tracks, [clip.id, transition.linkedClipId]);
  if (lockedWarning) return unchanged(clips, [lockedWarning]);

  const params = normalizeTransitionParams(transition.type, operation.params, transition.params);
  const changedClipIds = uniqueIds([clip.id, ...(linkedClip ? [linkedClip.id] : [])]);
  const nextClips = clips.map(candidate => {
    if (candidate.id === clip.id) {
      const nextTransition = { ...transition, params };
      return operation.edge === 'in'
        ? { ...candidate, transitionIn: nextTransition }
        : { ...candidate, transitionOut: nextTransition };
    }
    if (candidate.id === transition.linkedClipId) {
      const reciprocal = operation.edge === 'in'
        ? candidate.transitionOut
        : candidate.transitionIn;
      if (reciprocal?.id !== transition.id) return candidate;
      const nextReciprocal = { ...reciprocal, params };
      return operation.edge === 'in'
        ? { ...candidate, transitionOut: nextReciprocal }
        : { ...candidate, transitionIn: nextReciprocal };
    }
    return candidate;
  });

  return {
    clips: nextClips,
    changedClipIds,
    warnings: linkedClip ? [] : [{
      code: 'clip-not-found',
      message: `Linked transition clip not found: ${transition.linkedClipId}`,
      clipId: transition.linkedClipId,
    }],
  };
}

export function pruneInvalidClipTransitions(clips: readonly TimelineClip[]): TransitionPruneResult {
  const clipById = new Map(clips.map(clip => [clip.id, clip]));
  const removeTransitionInClipIds = new Set<string>();
  const removeTransitionOutClipIds = new Set<string>();
  const changedClipIds = new Set<string>();

  const markTransitionForRemoval = (
    clip: TimelineClip,
    edge: 'in' | 'out',
    transition: TimelineTransition,
  ) => {
    if (edge === 'in') {
      removeTransitionInClipIds.add(clip.id);
    } else {
      removeTransitionOutClipIds.add(clip.id);
    }
    changedClipIds.add(clip.id);

    const linkedClip = clipById.get(transition.linkedClipId);
    if (!linkedClip) return;

    const reciprocalEdge = edge === 'in' ? 'out' : 'in';
    const reciprocalTransition = reciprocalEdge === 'in'
      ? linkedClip.transitionIn
      : linkedClip.transitionOut;
    if (reciprocalTransition?.id !== transition.id) return;

    if (reciprocalEdge === 'in') {
      removeTransitionInClipIds.add(linkedClip.id);
    } else {
      removeTransitionOutClipIds.add(linkedClip.id);
    }
    changedClipIds.add(linkedClip.id);
  };

  for (const clip of clips) {
    const transitionOut = clip.transitionOut;
    if (transitionOut && !isValidTransitionOut(clip, transitionOut, clipById)) {
      markTransitionForRemoval(clip, 'out', transitionOut);
    }

    const transitionIn = clip.transitionIn;
    if (transitionIn && !isValidTransitionIn(clip, transitionIn, clipById)) {
      markTransitionForRemoval(clip, 'in', transitionIn);
    }
  }

  if (changedClipIds.size === 0) {
    return { clips: [...clips], changedClipIds: [] };
  }

  return {
    clips: clips.map(clip => {
      const removeIn = removeTransitionInClipIds.has(clip.id);
      const removeOut = removeTransitionOutClipIds.has(clip.id);
      if (!removeIn && !removeOut) return clip;

      return {
        ...clip,
        ...(removeIn ? { transitionIn: undefined } : {}),
        ...(removeOut ? { transitionOut: undefined } : {}),
      };
    }),
    changedClipIds: [...changedClipIds],
  };
}

export function shouldClearTransitionPropertiesSelection(
  selection: TimelinePropertiesSelection,
  clips: readonly TimelineClip[],
): boolean {
  if (selection?.kind !== 'transition') return false;

  const clip = clips.find(candidate => candidate.id === selection.clipId);
  if (!clip) return true;

  const transition = selection.edge === 'in' ? clip.transitionIn : clip.transitionOut;
  return transition?.id !== selection.transitionId;
}

function validateTransitionPair(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  input: {
    clipA: TimelineClip | undefined;
    clipB: TimelineClip | undefined;
    clipAId: string;
    clipBId: string;
    transitionType: string;
    requestedDuration: number;
  },
): TimelineEditWarning[] {
  if (!input.clipA) {
    return [{
      code: 'clip-not-found',
      message: `Clip not found: ${input.clipAId}`,
      clipId: input.clipAId,
    }];
  }
  if (!input.clipB) {
    return [{
      code: 'clip-not-found',
      message: `Clip not found: ${input.clipBId}`,
      clipId: input.clipBId,
    }];
  }

  if (input.clipA.id === input.clipB.id) {
    return [{
      code: 'invalid-range',
      message: 'Cannot apply a transition to the same clip.',
      clipId: input.clipA.id,
      trackId: input.clipA.trackId,
    }];
  }

  if (input.clipA.trackId !== input.clipB.trackId) {
    return [{
      code: 'invalid-range',
      message: 'Transitions require both clips to be on the same track.',
      clipId: input.clipA.id,
      trackId: input.clipA.trackId,
    }];
  }

  const track = tracks.find(candidate => candidate.id === input.clipA!.trackId);
  const clipAIsAudio = isAudioClip(input.clipA);
  const clipBIsAudio = isAudioClip(input.clipB);
  if (track?.type === 'audio' || clipAIsAudio || clipBIsAudio) {
    if (track?.type !== 'audio' || !clipAIsAudio || !clipBIsAudio || input.transitionType !== 'crossfade') {
      return [{
        code: 'unsupported',
        message: 'Audio clips only support crossfade transitions.',
        clipId: input.clipA.id,
        trackId: input.clipA.trackId,
      }];
    }
  } else if (track?.type !== 'video') {
    return [{
      code: 'unsupported',
      message: 'Transitions require video clips or an audio crossfade.',
      clipId: input.clipA.id,
      trackId: input.clipA.trackId,
    }];
  }

  if (input.clipB.startTime < input.clipA.startTime - EPSILON) {
    return [{
      code: 'invalid-range',
      message: 'Incoming transition clip must start after the outgoing clip.',
      clipId: input.clipB.id,
      trackId: input.clipB.trackId,
    }];
  }

  const lockedWarning = getTransitionLockedWarning(clips, tracks, [input.clipA.id, input.clipB.id]);
  if (lockedWarning) return [lockedWarning];

  if (!getTransition(input.transitionType as TransitionType)) {
    return [{
      code: 'unsupported',
      message: `Unsupported transition type: ${input.transitionType}`,
      clipId: input.clipA.id,
      trackId: input.clipA.trackId,
    }];
  }

  if (!Number.isFinite(input.requestedDuration) || input.requestedDuration <= 0) {
    return [{
      code: 'invalid-range',
      message: 'Transition duration must be a positive number.',
      clipId: input.clipA.id,
      trackId: input.clipA.trackId,
    }];
  }

  return [];
}

function isAudioClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'audio' || clip.file?.type?.startsWith('audio/') === true;
}

function isValidTransitionOut(
  outgoingClip: TimelineClip,
  transition: TimelineTransition,
  clipById: ReadonlyMap<string, TimelineClip>,
): boolean {
  const incomingClip = clipById.get(transition.linkedClipId);
  if (!incomingClip) return false;
  return incomingClip.transitionIn?.id === transition.id &&
    incomingClip.transitionIn.linkedClipId === outgoingClip.id &&
    areTransitionClipsAdjacent(outgoingClip, incomingClip);
}

function isValidTransitionIn(
  incomingClip: TimelineClip,
  transition: TimelineTransition,
  clipById: ReadonlyMap<string, TimelineClip>,
): boolean {
  const outgoingClip = clipById.get(transition.linkedClipId);
  if (!outgoingClip) return false;
  return outgoingClip.transitionOut?.id === transition.id &&
    outgoingClip.transitionOut.linkedClipId === incomingClip.id &&
    areTransitionClipsAdjacent(outgoingClip, incomingClip);
}

function areTransitionClipsAdjacent(outgoingClip: TimelineClip, incomingClip: TimelineClip): boolean {
  if (outgoingClip.trackId !== incomingClip.trackId) return false;
  const outgoingEndTime = outgoingClip.startTime + outgoingClip.duration;
  return Math.abs(outgoingEndTime - incomingClip.startTime) <= TRANSITION_JUNCTION_EPSILON;
}

function applyTransitionBetweenClips(
  clips: readonly TimelineClip[],
  clipAId: string,
  clipBId: string,
  transitionType: string,
  duration: number,
  transitionIdSource: string,
  offset = 0,
  params?: Record<string, TransitionParamValue>,
): TransitionOperationApplyResult {
  const clipA = clips.find(clip => clip.id === clipAId);
  const clipB = clips.find(clip => clip.id === clipBId);
  if (!clipA || !clipB) return unchanged(clips, []);

  const transitionId = transitionIdSource.startsWith('transition-')
    ? transitionIdSource
    : `transition-${transitionIdSource}`;
  const normalizedParams = normalizeTransitionParams(transitionType, params);
  const transitionOut: TimelineTransition = {
    id: transitionId,
    type: transitionType,
    duration,
    ...(Math.abs(offset) > EPSILON ? { offset } : {}),
    ...(normalizedParams ? { params: normalizedParams } : {}),
    linkedClipId: clipBId,
  };
  const transitionIn: TimelineTransition = {
    id: transitionId,
    type: transitionType,
    duration,
    ...(Math.abs(offset) > EPSILON ? { offset } : {}),
    ...(normalizedParams ? { params: normalizedParams } : {}),
    linkedClipId: clipAId,
  };

  const oldLinkedClipIds = [
    clipA.transitionOut?.linkedClipId,
    clipB.transitionIn?.linkedClipId,
  ].filter((clipId): clipId is string => Boolean(clipId));
  const changedClipIds = uniqueIds([clipAId, clipBId, ...oldLinkedClipIds]);

  return {
    clips: clips.map(candidate => {
      if (candidate.id === clipAId) {
        return { ...candidate, transitionOut };
      }
      if (candidate.id === clipBId) {
        return { ...candidate, transitionIn };
      }
      if (candidate.id === clipA.transitionOut?.linkedClipId) {
        return { ...candidate, transitionIn: undefined };
      }
      if (candidate.id === clipB.transitionIn?.linkedClipId) {
        return { ...candidate, transitionOut: undefined };
      }
      return candidate;
    }),
    changedClipIds,
    warnings: [],
    resolvedDuration: duration,
  };
}

function getTransitionLockedWarning(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipIds: readonly string[],
): TimelineEditWarning | null {
  for (const clipId of uniqueIds(clipIds)) {
    const clip = clips.find(candidate => candidate.id === clipId);
    if (!clip) continue;
    const track = tracks.find(candidate => candidate.id === clip.trackId);
    if (track?.locked) {
      return {
        code: 'track-locked',
        message: 'Cannot edit transitions on locked tracks.',
        clipId,
        trackId: track.id,
      };
    }
  }
  return null;
}

function unchanged(
  clips: readonly TimelineClip[],
  warnings: TimelineEditWarning[],
): TransitionOperationApplyResult {
  return {
    clips: [...clips],
    changedClipIds: [],
    warnings,
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function normalizeTransitionParams(
  transitionType: string,
  patch: Record<string, TransitionParamValue> | undefined,
  base?: Record<string, TransitionParamValue>,
): Record<string, TransitionParamValue> | undefined {
  const definition = getTransition(transitionType as TransitionType);
  const defaultParams = getDefaultTransitionParams(definition);
  const schema = definition?.params;
  if (!schema) return undefined;

  const nextParams: Record<string, TransitionParamValue> = {
    ...(defaultParams ?? {}),
    ...(base ?? {}),
  };
  for (const [paramId, value] of Object.entries(patch ?? {})) {
    const param = schema[paramId];
    if (!param) continue;
    if (param.type === 'boolean') {
      nextParams[paramId] = value === true;
    } else if (param.type === 'number') {
      const numericValue = typeof value === 'number' && Number.isFinite(value) ? value : Number(param.defaultValue);
      const min = typeof param.min === 'number' ? param.min : -Infinity;
      const max = typeof param.max === 'number' ? param.max : Infinity;
      nextParams[paramId] = Math.max(min, Math.min(max, numericValue));
    } else {
      nextParams[paramId] = value;
    }
  }

  return Object.keys(nextParams).length > 0 ? nextParams : undefined;
}
