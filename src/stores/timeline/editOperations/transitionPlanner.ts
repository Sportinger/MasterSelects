import type { TimelineClip } from '../../../types';
import { getTransition, type TransitionDefinition, type TransitionType } from '../../../transitions';

export type TransitionPlacement = 'center' | 'end-at-cut' | 'start-at-cut';
export type TransitionEdgePolicy = 'hold' | 'require-handles';
export type TransitionParticipantRole = 'outgoing' | 'incoming';
export type TransitionCoverageKind = 'visible' | 'real-handle' | 'hold';
export type TransitionHoldFrame = 'first-frame' | 'last-frame';

export const DEFAULT_TRANSITION_PLACEMENT: TransitionPlacement = 'center';

export interface TransitionTimelineRange {
  startTime: number;
  endTime: number;
}

export interface TransitionCoverageRange extends TransitionTimelineRange {
  kind: TransitionCoverageKind;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
  holdFrame?: TransitionHoldFrame;
}

export interface TransitionParticipantPlan extends TransitionTimelineRange {
  clipId: string;
  trackId: string;
  role: TransitionParticipantRole;
  handleNeeded: number;
  handleAvailable: number;
  realHandleDuration: number;
  holdDuration: number;
  coverage: TransitionCoverageRange[];
}

export interface TransitionPlanBlockedReason {
  code: 'unsupported' | 'invalid-duration' | 'invalid-placement' | 'require-handles';
  message: string;
}

export interface TransitionPlan {
  transitionType: TransitionType;
  definition: TransitionDefinition;
  placement: TransitionPlacement;
  edgePolicy: TransitionEdgePolicy;
  requestedDuration: number;
  resolvedDuration: number;
  bodyOffset: number;
  junctionTime: number;
  bodyStart: number;
  bodyEnd: number;
  timingChanges: readonly [];
  outgoing: TransitionParticipantPlan;
  incoming: TransitionParticipantPlan;
  blockedReason?: TransitionPlanBlockedReason;
}

export interface ActiveTransitionPlan {
  plan: TransitionPlan;
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
}

export interface PlanTransitionInput {
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  transitionType: string;
  requestedDuration: number;
  placement?: TransitionPlacement;
  edgePolicy?: TransitionEdgePolicy;
  junctionTime?: number;
  bodyOffset?: number;
  getMediaDuration?: TransitionSourceDurationResolver;
}

export interface FindActiveTransitionPlanInput {
  clips: readonly TimelineClip[];
  trackId: string;
  time: number;
  placement?: TransitionPlacement;
  edgePolicy?: TransitionEdgePolicy;
  getMediaDuration?: TransitionSourceDurationResolver;
}

const EPSILON = 1e-6;
const HOLD_FRAME_SAMPLE_EPSILON_SECONDS = 1 / 120;

export type TransitionSourceDurationResolver = (mediaFileId: string) => number | undefined;

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function getLastHoldSourceTime(clip: TimelineClip, sourceEnd = clip.outPoint): number {
  return Math.max(clip.inPoint, sourceEnd - HOLD_FRAME_SAMPLE_EPSILON_SECONDS);
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function getSourceDuration(
  clip: TimelineClip,
  getMediaDuration?: TransitionSourceDurationResolver,
): number {
  const mediaFileId = getClipMediaFileId(clip);
  const mediaDuration = mediaFileId ? getMediaDuration?.(mediaFileId) : undefined;
  if (Number.isFinite(mediaDuration) && mediaDuration && mediaDuration > 0) {
    return mediaDuration;
  }

  return Math.max(
    0,
    clip.source?.naturalDuration
      ?? Math.max(clip.outPoint, clip.inPoint + clip.duration)
  );
}

function getBodyRange(
  placement: TransitionPlacement,
  junctionTime: number,
  duration: number,
): TransitionTimelineRange {
  if (placement === 'end-at-cut') {
    return { startTime: junctionTime - duration, endTime: junctionTime };
  }
  if (placement === 'start-at-cut') {
    return { startTime: junctionTime, endTime: junctionTime + duration };
  }
  const halfDuration = duration * 0.5;
  return { startTime: junctionTime - halfDuration, endTime: junctionTime + halfDuration };
}

function addCoverage(
  coverage: TransitionCoverageRange[],
  kind: TransitionCoverageKind,
  startTime: number,
  endTime: number,
  sourceStart: number,
  sourceEnd: number,
  holdFrame?: TransitionHoldFrame,
): void {
  const duration = Math.max(0, endTime - startTime);
  if (duration <= EPSILON) return;
  coverage.push({
    kind,
    startTime,
    endTime,
    duration,
    sourceStart,
    sourceEnd,
    ...(holdFrame ? { holdFrame } : {}),
  });
}

function createBaseParticipant(
  clip: TimelineClip,
  role: TransitionParticipantRole,
  body: TransitionTimelineRange,
): TransitionParticipantPlan {
  return {
    clipId: clip.id,
    trackId: clip.trackId,
    role,
    startTime: body.startTime,
    endTime: body.endTime,
    handleNeeded: 0,
    handleAvailable: 0,
    realHandleDuration: 0,
    holdDuration: 0,
    coverage: [],
  };
}

function addIncomingLeftHandleCoverage(
  participant: TransitionParticipantPlan,
  clip: TimelineClip,
  handleStart: number,
  handleEnd: number,
  needed: number,
): void {
  const available = Math.max(0, clip.inPoint);
  const realDuration = Math.min(needed, available);
  const holdDuration = Math.max(0, needed - realDuration);
  const firstAvailableSourceTime = Math.max(0, clip.inPoint - realDuration);

  participant.handleNeeded += needed;
  participant.handleAvailable = Math.max(participant.handleAvailable, available);
  participant.realHandleDuration += realDuration;
  participant.holdDuration += holdDuration;

  if (holdDuration > EPSILON) {
    addCoverage(
      participant.coverage,
      'hold',
      handleStart,
      handleStart + holdDuration,
      firstAvailableSourceTime,
      firstAvailableSourceTime,
      'first-frame'
    );
  }

  if (realDuration > EPSILON) {
    addCoverage(
      participant.coverage,
      'real-handle',
      handleEnd - realDuration,
      handleEnd,
      clip.inPoint - realDuration,
      clip.inPoint
    );
  }
}

function addOutgoingRightHandleCoverage(
  participant: TransitionParticipantPlan,
  clip: TimelineClip,
  handleStart: number,
  handleEnd: number,
  needed: number,
  getMediaDuration?: TransitionSourceDurationResolver,
): void {
  const available = Math.max(0, getSourceDuration(clip, getMediaDuration) - clip.outPoint);
  const realDuration = Math.min(needed, available);
  const holdDuration = Math.max(0, needed - realDuration);

  participant.handleNeeded += needed;
  participant.handleAvailable = Math.max(participant.handleAvailable, available);
  participant.realHandleDuration += realDuration;
  participant.holdDuration += holdDuration;

  if (realDuration > EPSILON) {
    addCoverage(
      participant.coverage,
      'real-handle',
      handleStart,
      handleStart + realDuration,
      clip.outPoint,
      clip.outPoint + realDuration
    );
  }

  if (holdDuration > EPSILON) {
    const holdSourceTime = getLastHoldSourceTime(clip, clip.outPoint + realDuration);
    addCoverage(
      participant.coverage,
      'hold',
      handleEnd - holdDuration,
      handleEnd,
      holdSourceTime,
      holdSourceTime,
      'last-frame'
    );
  }
}

function addVisibleCoverageForGaps(
  participant: TransitionParticipantPlan,
  clip: TimelineClip,
  body: TransitionTimelineRange,
): void {
  const covered = participant.coverage.toSorted((a, b) => a.startTime - b.startTime);
  let cursor = body.startTime;

  for (const range of covered) {
    if (range.startTime > cursor + EPSILON) {
      addTimelineClipBodyCoverage(participant.coverage, clip, cursor, range.startTime);
    }
    cursor = Math.max(cursor, range.endTime);
  }

  if (cursor < body.endTime - EPSILON) {
    addTimelineClipBodyCoverage(participant.coverage, clip, cursor, body.endTime);
  }

  participant.coverage = participant.coverage.toSorted((a, b) => a.startTime - b.startTime);
}

function addTimelineClipBodyCoverage(
  coverage: TransitionCoverageRange[],
  clip: TimelineClip,
  startTime: number,
  endTime: number,
): void {
  const clipStart = clip.startTime;
  const clipEnd = getClipEnd(clip);
  const visibleStart = Math.max(startTime, clipStart);
  const visibleEnd = Math.min(endTime, clipEnd);

  if (startTime < visibleStart - EPSILON) {
    addCoverage(
      coverage,
      'hold',
      startTime,
      visibleStart,
      clip.inPoint,
      clip.inPoint,
      'first-frame',
    );
  }

  if (visibleStart < visibleEnd - EPSILON) {
    const sourceStart = clip.inPoint + Math.max(0, visibleStart - clipStart);
    const sourceEnd = sourceStart + (visibleEnd - visibleStart);
    addCoverage(coverage, 'visible', visibleStart, visibleEnd, sourceStart, sourceEnd);
  }

  if (visibleEnd < endTime - EPSILON) {
    const holdSourceTime = getLastHoldSourceTime(clip);
    addCoverage(
      coverage,
      'hold',
      visibleEnd,
      endTime,
      holdSourceTime,
      holdSourceTime,
      'last-frame',
    );
  }
}

function applyPlacementCoverage(
  placement: TransitionPlacement,
  outgoingClip: TimelineClip,
  incomingClip: TimelineClip,
  outgoing: TransitionParticipantPlan,
  incoming: TransitionParticipantPlan,
  body: TransitionTimelineRange,
  junctionTime: number,
  getMediaDuration?: TransitionSourceDurationResolver,
): void {
  incoming.handleAvailable = Math.max(incoming.handleAvailable, Math.max(0, incomingClip.inPoint));
  outgoing.handleAvailable = Math.max(
    outgoing.handleAvailable,
    Math.max(0, getSourceDuration(outgoingClip, getMediaDuration) - outgoingClip.outPoint),
  );

  if (placement === 'end-at-cut') {
    addIncomingLeftHandleCoverage(incoming, incomingClip, body.startTime, body.endTime, body.endTime - body.startTime);
  } else if (placement === 'start-at-cut') {
    addOutgoingRightHandleCoverage(outgoing, outgoingClip, body.startTime, body.endTime, body.endTime - body.startTime, getMediaDuration);
  } else {
    const incomingHandleEnd = Math.min(body.endTime, junctionTime);
    if (body.startTime < incomingHandleEnd - EPSILON) {
      addIncomingLeftHandleCoverage(
        incoming,
        incomingClip,
        body.startTime,
        incomingHandleEnd,
        incomingHandleEnd - body.startTime,
      );
    }

    const outgoingHandleStart = Math.max(body.startTime, junctionTime);
    if (outgoingHandleStart < body.endTime - EPSILON) {
      addOutgoingRightHandleCoverage(
        outgoing,
        outgoingClip,
        outgoingHandleStart,
        body.endTime,
        body.endTime - outgoingHandleStart,
        getMediaDuration,
      );
    }
  }

  addVisibleCoverageForGaps(outgoing, outgoingClip, body);
  addVisibleCoverageForGaps(incoming, incomingClip, body);
}

function findCoverageAtTime(
  participant: TransitionParticipantPlan,
  playheadPosition: number,
): TransitionCoverageRange | undefined {
  return participant.coverage.find((range) =>
    playheadPosition >= range.startTime &&
    playheadPosition <= range.endTime + EPSILON
  );
}

export function getTransitionSourceTimeForParticipant(
  participant: TransitionParticipantPlan,
  playheadPosition: number,
  fallback: number,
): number {
  const coverage = findCoverageAtTime(participant, playheadPosition);
  if (!coverage) return fallback;
  if (coverage.kind === 'hold') return coverage.sourceStart;
  return coverage.sourceStart + Math.max(0, playheadPosition - coverage.startTime);
}

function isClipNormallyVisible(clip: TimelineClip, playheadPosition: number): boolean {
  return playheadPosition >= clip.startTime && playheadPosition < clip.startTime + clip.duration;
}

export function createTransitionSourceClip(
  clip: TimelineClip,
  participant: TransitionParticipantPlan,
  playheadPosition: number,
): TimelineClip {
  const coverage = findCoverageAtTime(participant, playheadPosition);
  if (coverage?.kind === 'visible' && isClipNormallyVisible(clip, playheadPosition)) {
    return clip;
  }
  if (coverage) {
    const sourceTime = getTransitionSourceTimeForParticipant(
      participant,
      playheadPosition,
      coverage.sourceStart,
    );
    return {
      ...clip,
      startTime: coverage.startTime,
      inPoint: coverage.sourceStart,
      outPoint: Math.max(coverage.sourceStart, coverage.sourceEnd),
      transitionSourceTimeOverride: sourceTime,
      transitionSourceHold: coverage.kind === 'hold',
    };
  }

  return {
    ...clip,
    startTime: playheadPosition,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    transitionSourceTimeOverride: clip.inPoint,
    transitionSourceHold: true,
  };
}

function getBlockedReason(
  outgoing: TransitionParticipantPlan,
  incoming: TransitionParticipantPlan,
  edgePolicy: TransitionEdgePolicy,
): TransitionPlanBlockedReason | undefined {
  if (edgePolicy !== 'require-handles') return undefined;

  if (outgoing.holdDuration > EPSILON || incoming.holdDuration > EPSILON) {
    return {
      code: 'require-handles',
      message: 'Transition requires more source handle than the selected clips provide.',
    };
  }

  return undefined;
}

export function planTransition(input: PlanTransitionInput): TransitionPlan | null {
  const definition = getTransition(input.transitionType as TransitionType);
  if (!definition) return null;
  if (!Number.isFinite(input.requestedDuration) || input.requestedDuration <= 0) return null;

  const placement = input.placement ?? DEFAULT_TRANSITION_PLACEMENT;
  const edgePolicy = input.edgePolicy ?? 'hold';
  const resolvedDuration = Math.max(definition.minDuration, input.requestedDuration);
  const junctionTime = input.junctionTime ?? getClipEnd(input.outgoingClip);
  const bodyOffset = Number.isFinite(input.bodyOffset) ? input.bodyOffset ?? 0 : 0;
  const body = getBodyRange(placement, junctionTime + bodyOffset, resolvedDuration);
  const outgoing = createBaseParticipant(input.outgoingClip, 'outgoing', body);
  const incoming = createBaseParticipant(input.incomingClip, 'incoming', body);

  applyPlacementCoverage(
    placement,
    input.outgoingClip,
    input.incomingClip,
    outgoing,
    incoming,
    body,
    junctionTime,
    input.getMediaDuration,
  );

  return {
    transitionType: definition.id,
    definition,
    placement,
    edgePolicy,
    requestedDuration: input.requestedDuration,
    resolvedDuration,
    bodyOffset,
    junctionTime,
    bodyStart: body.startTime,
    bodyEnd: body.endTime,
    timingChanges: [],
    outgoing,
    incoming,
    blockedReason: getBlockedReason(outgoing, incoming, edgePolicy),
  };
}

export function findActiveTransitionPlanForTrack(
  input: FindActiveTransitionPlanInput,
): ActiveTransitionPlan | null {
  const trackClips = input.clips
    .filter(clip => clip.trackId === input.trackId && clip.transitionOut)
    .toSorted((a, b) => a.startTime - b.startTime);

  for (const outgoingClip of trackClips) {
    const transition = outgoingClip.transitionOut;
    if (!transition) continue;

    const incomingClip = input.clips.find(clip => clip.id === transition.linkedClipId);
    if (!incomingClip) continue;

    const junctionTime = getClipEnd(outgoingClip);
    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: transition.type,
      requestedDuration: transition.duration,
      placement: input.placement ?? DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: input.edgePolicy ?? 'hold',
      junctionTime,
      bodyOffset: transition.offset ?? 0,
      getMediaDuration: input.getMediaDuration,
    });
    if (!plan) continue;

    if (input.time >= plan.bodyStart && input.time < plan.bodyEnd) {
      return { plan, outgoingClip, incomingClip };
    }
  }

  return null;
}
