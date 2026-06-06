import type { TimelineClip, TimelineTrack, TimelineTransition } from '../../../types';
import { getTransition, type TransitionType } from '../../../transitions';
import type {
  TransitionApplyOperation,
  TransitionJunctionGeometryReference,
  TransitionRemoveOperation,
  TransitionUpdateDurationOperation,
} from './transactionTypes';
import type { TimelineEditWarning } from './types';

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

  const resolvedDuration = resolveTransitionDuration(operation.transitionType, operation.requestedDuration, clipA!, clipB!);
  if (resolvedDuration === null) {
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
    resolvedDuration,
    operation.id,
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
        ? { ...candidate, startTime: linkedClip ? getClipEnd(linkedClip) : candidate.startTime, transitionIn: undefined }
        : { ...candidate, transitionOut: undefined };
    }
    if (candidate.id === transition.linkedClipId) {
      return operation.edge === 'in'
        ? { ...candidate, transitionOut: undefined }
        : { ...candidate, startTime: getClipEnd(clip), transitionIn: undefined };
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

  const resolvedDuration = resolveTransitionDuration(transition.type, operation.requestedDuration, clipA!, clipB!);
  if (resolvedDuration === null) {
    return unchanged(clips, [{
      code: 'invalid-range',
      message: 'Transition duration cannot be resolved for the selected clips.',
      clipId: operation.clipId,
      trackId: clip.trackId,
    }]);
  }

  return applyTransitionBetweenClips(clips, clipAId, clipBId, transition.type, resolvedDuration, transition.id);
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

function resolveTransitionDuration(
  transitionType: string,
  requestedDuration: number,
  clipA: TimelineClip,
  clipB: TimelineClip,
): number | null {
  const transitionDef = getTransition(transitionType as TransitionType);
  if (!transitionDef) return null;
  const maxDuration = Math.min(transitionDef.maxDuration, clipA.duration * 0.5, clipB.duration * 0.5);
  if (maxDuration <= 0) return null;
  return Math.min(Math.max(requestedDuration, transitionDef.minDuration), maxDuration);
}

function applyTransitionBetweenClips(
  clips: readonly TimelineClip[],
  clipAId: string,
  clipBId: string,
  transitionType: string,
  duration: number,
  transitionIdSource: string,
): TransitionOperationApplyResult {
  const clipA = clips.find(clip => clip.id === clipAId);
  const clipB = clips.find(clip => clip.id === clipBId);
  if (!clipA || !clipB) return unchanged(clips, []);

  const transitionId = transitionIdSource.startsWith('transition-')
    ? transitionIdSource
    : `transition-${transitionIdSource}`;
  const transitionOut: TimelineTransition = {
    id: transitionId,
    type: transitionType,
    duration,
    linkedClipId: clipBId,
  };
  const transitionIn: TimelineTransition = {
    id: transitionId,
    type: transitionType,
    duration,
    linkedClipId: clipAId,
  };

  const oldLinkedClipIds = [
    clipA.transitionOut?.linkedClipId,
    clipB.transitionIn?.linkedClipId,
  ].filter((clipId): clipId is string => Boolean(clipId));
  const changedClipIds = uniqueIds([clipAId, clipBId, ...oldLinkedClipIds]);
  const clipAEnd = getClipEnd(clipA);
  const clipBStart = clipAEnd - duration;

  return {
    clips: clips.map(candidate => {
      if (candidate.id === clipAId) {
        return { ...candidate, transitionOut };
      }
      if (candidate.id === clipBId) {
        return { ...candidate, startTime: clipBStart, transitionIn };
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

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
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
