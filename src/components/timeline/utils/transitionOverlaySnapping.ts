import type { TimelineClip } from '../../../types/timeline';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  planTransition,
  type TransitionSourceDurationResolver,
} from '../../../stores/timeline/editOperations/transitionPlanner';

const TRANSITION_SNAP_PX = 10;
const TRANSITION_SNAP_SECONDS_MIN = 1 / 120;
const TRANSITION_SNAP_SECONDS_MAX = 0.12;

export interface TransitionHandleSnapLimits {
  incomingHandleAvailable: number;
  outgoingHandleAvailable: number;
}

interface TransitionSnapTimesInput {
  clips: readonly TimelineClip[];
  currentTransitionId: string;
  getMediaDuration: TransitionSourceDurationResolver;
}

export function clampTransitionDuration(value: number, minDuration: number): number {
  return Math.max(minDuration, value);
}

export function getTransitionSnapThresholdSeconds(pixelsPerSecond: number): number {
  return Math.min(
    TRANSITION_SNAP_SECONDS_MAX,
    Math.max(TRANSITION_SNAP_SECONDS_MIN, TRANSITION_SNAP_PX / pixelsPerSecond),
  );
}

function uniqueFiniteTargets(targets: readonly number[]): number[] {
  const result: number[] = [];
  for (const target of targets) {
    if (!Number.isFinite(target)) continue;
    if (result.some(candidate => Math.abs(candidate - target) < 0.0005)) continue;
    result.push(Math.abs(target) < 0.0005 ? 0 : target);
  }
  return result;
}

export function snapTransitionToTargets(value: number, targets: readonly number[], threshold: number): number {
  let snapped = value;
  let bestDistance = threshold;

  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance > bestDistance) continue;

    bestDistance = distance;
    snapped = Math.abs(target) < 0.0005 ? 0 : target;
  }

  return snapped;
}

export function getOtherTransitionSnapTimes({
  clips,
  currentTransitionId,
  getMediaDuration,
}: TransitionSnapTimesInput): number[] {
  const targets: number[] = [];

  for (const outgoingClip of clips) {
    const transition = outgoingClip.transitionOut;
    if (!transition || transition.id === currentTransitionId) continue;

    const incomingClip = clips.find(candidate => candidate.id === transition.linkedClipId);
    if (!incomingClip) continue;

    const plan = planTransition({
      outgoingClip,
      incomingClip,
      transitionType: transition.type,
      requestedDuration: transition.duration,
      params: transition.params,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime: outgoingClip.startTime + outgoingClip.duration,
      bodyOffset: transition.offset ?? 0,
      getMediaDuration,
    });
    if (!plan) continue;

    targets.push(
      plan.bodyStart,
      (plan.bodyStart + plan.bodyEnd) * 0.5,
      plan.bodyEnd,
    );
  }

  return uniqueFiniteTargets(targets);
}

export function getTransitionHandleSnapLimits(
  outgoingClip: TimelineClip,
  incomingClip: TimelineClip,
  transitionType: string,
  requestedDuration: number,
  junctionTime: number,
  getMediaDuration: TransitionSourceDurationResolver,
): TransitionHandleSnapLimits {
  const plan = planTransition({
    outgoingClip,
    incomingClip,
    transitionType,
    requestedDuration,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    junctionTime,
    bodyOffset: 0,
    getMediaDuration,
  });

  return {
    incomingHandleAvailable: Math.max(0, plan?.incoming.handleAvailable ?? 0),
    outgoingHandleAvailable: Math.max(0, plan?.outgoing.handleAvailable ?? 0),
  };
}

export function getOffsetSnapTargets(
  duration: number,
  limits: TransitionHandleSnapLimits,
  junctionTime: number,
  otherTransitionTimes: readonly number[],
): number[] {
  const halfDuration = duration * 0.5;
  return uniqueFiniteTargets([
    0,
    halfDuration - limits.incomingHandleAvailable,
    limits.outgoingHandleAvailable - halfDuration,
    ...otherTransitionTimes.flatMap(targetTime => [
      targetTime - junctionTime + halfDuration,
      targetTime - junctionTime,
      targetTime - junctionTime - halfDuration,
    ]),
  ]);
}

export function getDurationSnapTargets(
  offset: number,
  minDuration: number,
  limits: TransitionHandleSnapLimits,
  junctionTime: number,
  resizeEdge: 'start' | 'end',
  otherTransitionTimes: readonly number[],
): number[] {
  const transitionCenter = junctionTime + offset;
  const transitionTimeTargets = otherTransitionTimes.map(targetTime =>
    resizeEdge === 'start'
      ? 2 * (transitionCenter - targetTime)
      : 2 * (targetTime - transitionCenter)
  );

  return uniqueFiniteTargets([
    2 * (offset + limits.incomingHandleAvailable),
    2 * (limits.outgoingHandleAvailable - offset),
    ...transitionTimeTargets,
  ]).filter(target => target >= minDuration);
}
