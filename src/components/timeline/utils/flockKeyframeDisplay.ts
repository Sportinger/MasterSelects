import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import { isFlockProperty, parseFlockProperty, type FlockDefinition } from '../../../types/flock';
import { resolveFlockParamDescriptor } from '../../../services/flock/flockPropertyValues';
import { getFlockOperator } from '../../../services/flock/operators/flockOperatorRegistry';
import {
  toClipLocalKeyframes,
  type SourceOffsetResolver,
} from '../../../services/flock/time/flockKeyframeTime';

/**
 * Timeline display adapter for source-time keyframes. Flock graph parameters
 * store keyframe times in simulation source seconds; every timeline surface
 * that positions or hit-tests keyframes works in clip-local seconds. Store
 * mutations (addKeyframe / moveKeyframe / moveKeyframes) convert clip-local
 * input back to source time, so UI code keeps passing clip-local times.
 */

export type FlockDisplayClipTiming = Pick<TimelineClip, 'id' | 'inPoint' | 'outPoint' | 'duration' | 'reversed' | 'speed'>;

export function hasSourceTimeKeyframes(keyframes: readonly { property: string }[] | undefined): boolean {
  return !!keyframes?.some((keyframe) => isFlockProperty(keyframe.property));
}

/** Clip-local keyframes for one clip; returns the input array untouched when it has no flock keys. */
export function getDisplayKeyframesForClip<T extends Keyframe>(
  clip: FlockDisplayClipTiming | null | undefined,
  keyframes: readonly T[],
  resolveSourceOffset?: SourceOffsetResolver,
): T[] {
  if (!clip || !hasSourceTimeKeyframes(keyframes)) return keyframes as T[];
  return toClipLocalKeyframes(clip, keyframes, resolveSourceOffset) as T[];
}

/**
 * Display copy of the keyframe map. Fast path: the original map object is
 * returned when no clip carries flock keys, so memoized consumers do not
 * re-render and non-flock timelines behave exactly as before.
 */
export function buildFlockDisplayClipKeyframes(
  clips: readonly FlockDisplayClipTiming[],
  clipKeyframes: Map<string, Keyframe[]>,
  resolveSourceOffset?: SourceOffsetResolver,
): Map<string, Keyframe[]> {
  let next: Map<string, Keyframe[]> | null = null;
  let clipsById: Map<string, FlockDisplayClipTiming> | null = null;
  for (const [clipId, keyframes] of clipKeyframes) {
    if (!hasSourceTimeKeyframes(keyframes)) continue;
    clipsById ??= new Map(clips.map((clip) => [clip.id, clip]));
    const clip = clipsById.get(clipId);
    if (!clip) continue;
    next ??= new Map(clipKeyframes);
    next.set(clipId, toClipLocalKeyframes(clip, keyframes, resolveSourceOffset));
  }
  return next ?? clipKeyframes;
}

const COMPONENT_LABELS: Record<string, string> = { x: 'X', y: 'Y', z: 'Z', r: 'R', g: 'G', b: 'B' };

/** Readable "<node> / <param>" label for a flock property row. */
export function getFlockPropertyLabel(property: string, definition?: FlockDefinition | null): string {
  const parsed = parseFlockProperty(property);
  if (!parsed) return property;
  const node = definition?.nodes.find((candidate) => candidate.id === parsed.nodeId);
  const nodeLabel = node?.label
    ?? (node ? getFlockOperator(node.operator)?.label : undefined)
    ?? 'Flock';
  const descriptor = definition ? resolveFlockParamDescriptor(definition, parsed.nodeId, parsed.param) : undefined;
  let paramLabel = descriptor?.label ?? parsed.param;
  const separator = parsed.param.indexOf('__');
  if (node?.groupRef && separator > 0) {
    const group = definition?.groups.find((candidate) => candidate.id === node.groupRef);
    const inner = group?.nodes.find((candidate) => candidate.id === parsed.param.slice(0, separator));
    const innerLabel = inner?.label ?? (inner ? getFlockOperator(inner.operator)?.label : undefined);
    if (innerLabel) paramLabel = `${innerLabel} ${paramLabel}`;
  }
  const suffix = parsed.component ? ` ${COMPONENT_LABELS[parsed.component] ?? parsed.component}` : '';
  return `${nodeLabel} / ${paramLabel}${suffix}`;
}
