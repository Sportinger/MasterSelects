import type { BlendMode } from '../../types/blendMode';
import type { Keyframe } from '../../types/keyframes';
import {
  isCameraProperty,
  isMaskEdgeFeatherProperty,
  isMaskNumericProperty,
  isMaskPathProperty,
  isTextBoundsNumericProperty,
  isTextBoundsPathProperty,
} from '../../types/animationProperties';
import { isMotionProperty } from '../../types/motionDesign';
import {
  parseVectorAnimationDataBindingProperty,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../types/vectorAnimation';
import type {
  TransitionRecipeBlendWindow,
  TransitionSourceMap,
  TransitionSourceMapSegment,
  TransitionSourceMapV2,
  TransitionSourceMapV2Segment,
} from '../../types/timelineCore';
import { calculateSourceTime, getSpeedAtTime } from '../../utils/speedIntegration';

export interface ResolvedTransitionSourceTime {
  sourceTime: number;
  sourceRate: number;
  isHold: boolean;
  /** Present for v2 maps: original parent-local animation time. */
  animationTime?: number;
}

const MEDIA_BOUND_EPSILON = 1e-9;

const BLEND_MODES = new Set([
  'normal', 'dissolve', 'dancing-dissolve',
  'darken', 'multiply', 'color-burn', 'classic-color-burn', 'linear-burn', 'darker-color',
  'add', 'lighten', 'screen', 'color-dodge', 'classic-color-dodge', 'linear-dodge', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'linear-light', 'vivid-light', 'pin-light', 'hard-mix',
  'difference', 'classic-difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
  'stencil-alpha', 'stencil-luma', 'silhouette-alpha', 'silhouette-luma', 'alpha-add',
]);
const EASING_TYPES = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier']);
const ROTATION_INTERPOLATION_MODES = new Set(['shortest', 'continuous']);
const HANDLE_MODES = new Set(['none', 'mirrored', 'split']);
const TRANSFORM_PROPERTIES = new Set([
  'opacity', 'speed',
  'position.x', 'position.y', 'position.z',
  'scale.all', 'scale.x', 'scale.y', 'scale.z',
  'rotation.x', 'rotation.y', 'rotation.z',
]);

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasFiniteFields<T extends string>(
  value: PlainRecord,
  fields: readonly T[],
): value is PlainRecord & Record<T, number> {
  return fields.every((field) => Number.isFinite(value[field]));
}

function isFiniteHandle(value: unknown): boolean {
  return isPlainRecord(value) && hasFiniteFields(value, ['x', 'y']);
}

function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && BLEND_MODES.has(value);
}

function isAnimatableProperty(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  return TRANSFORM_PROPERTIES.has(value) ||
    isCameraProperty(value) ||
    /^effect\.[^.]+\..+$/.test(value) ||
    /^node\.[^.]+\..+$/.test(value) ||
    /^color\.[^.]+\.[^.]+\..+$/.test(value) ||
    isMaskPathProperty(value) ||
    isMaskNumericProperty(value) ||
    isMaskEdgeFeatherProperty(value) ||
    isTextBoundsPathProperty(value) ||
    isTextBoundsNumericProperty(value) ||
    value === 'transitionRender.progress' ||
    parseVectorAnimationInputProperty(value) !== null ||
    parseVectorAnimationStateProperty(value) !== null ||
    parseVectorAnimationDataBindingProperty(value) !== null ||
    isMotionProperty(value);
}

function isValidPathValue(value: unknown): boolean {
  return isPlainRecord(value) &&
    typeof value.closed === 'boolean' &&
    Array.isArray(value.vertices) &&
    value.vertices.every((vertex) =>
      isPlainRecord(vertex) &&
      typeof vertex.id === 'string' &&
      hasFiniteFields(vertex, ['x', 'y']) &&
      isFiniteHandle(vertex.handleIn) &&
      isFiniteHandle(vertex.handleOut) &&
      (vertex.handleMode === undefined ||
        (typeof vertex.handleMode === 'string' && HANDLE_MODES.has(vertex.handleMode)))
    );
}

function isValidKeyframe(value: unknown): value is Keyframe {
  if (!isPlainRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.clipId !== 'string' ||
    !isAnimatableProperty(value.property) ||
    typeof value.easing !== 'string' || !EASING_TYPES.has(value.easing) ||
    !hasFiniteFields(value, ['time', 'value'])) {
    return false;
  }

  return (value.handleIn === undefined || isFiniteHandle(value.handleIn)) &&
    (value.handleOut === undefined || isFiniteHandle(value.handleOut)) &&
    (value.pathValue === undefined || isValidPathValue(value.pathValue)) &&
    (value.rotationInterpolation === undefined ||
      (typeof value.rotationInterpolation === 'string' &&
        ROTATION_INTERPOLATION_MODES.has(value.rotationInterpolation)));
}

function isValidBaseTransform(value: unknown): boolean {
  if (!isPlainRecord(value) || !isBlendMode(value.blendMode) || !Number.isFinite(value.opacity) ||
    !isPlainRecord(value.position) || !isPlainRecord(value.scale) || !isPlainRecord(value.rotation) ||
    !hasFiniteFields(value.position, ['x', 'y', 'z']) ||
    !hasFiniteFields(value.scale, ['x', 'y']) ||
    !hasFiniteFields(value.rotation, ['x', 'y', 'z'])) {
    return false;
  }

  return (value.scale.all === undefined || Number.isFinite(value.scale.all)) &&
    (value.scale.z === undefined || Number.isFinite(value.scale.z));
}

function isValidV2Segment(segment: unknown): segment is TransitionSourceMapV2Segment {
  if (!isPlainRecord(segment) ||
    typeof segment.compStart !== 'number' || typeof segment.compEnd !== 'number' ||
    !Number.isFinite(segment.compStart) || !Number.isFinite(segment.compEnd) ||
    segment.compEnd <= segment.compStart) {
    return false;
  }

  return segment.kind === 'parent-linear'
    ? hasFiniteFields(segment, ['parentStart', 'parentEnd'])
    : segment.kind === 'parent-hold' && Number.isFinite(segment.parentTime);
}

function areContiguous(segments: readonly { compStart: number; compEnd: number }[]): boolean {
  return segments.every((segment, index) =>
    index === 0 || segment.compStart === segments[index - 1].compEnd
  );
}

function isValidSegment(segment: unknown): segment is TransitionSourceMapSegment {
  if (!isPlainRecord(segment) ||
    !hasFiniteFields(segment, ['compStart', 'compEnd']) ||
    segment.compEnd <= segment.compStart) {
    return false;
  }

  return segment.kind === 'linear'
    ? hasFiniteFields(segment, ['sourceStart', 'sourceEnd'])
    : segment.kind === 'hold' && Number.isFinite(segment.sourceTime);
}

export function isValidTransitionSourceMap(
  sourceMap: unknown,
): sourceMap is TransitionSourceMap {
  if (!isPlainRecord(sourceMap) ||
    !Array.isArray(sourceMap.segments) || sourceMap.segments.length === 0) {
    return false;
  }

  if (sourceMap.version === 1) {
    let previousEnd: number | undefined;
    for (const segment of sourceMap.segments) {
      if (!isValidSegment(segment) || (previousEnd !== undefined && segment.compStart !== previousEnd)) {
        return false;
      }
      previousEnd = segment.compEnd;
    }
    return true;
  }

  if (!isPlainRecord(sourceMap) || sourceMap.version !== 2 ||
    !hasFiniteFields(sourceMap, ['mediaDuration']) || sourceMap.mediaDuration <= 0 ||
    !isPlainRecord(sourceMap.parent) ||
    !hasFiniteFields(sourceMap.parent, ['duration', 'inPoint', 'outPoint', 'defaultSpeed']) ||
    sourceMap.parent.duration <= 0 ||
    sourceMap.parent.inPoint < 0 || sourceMap.parent.inPoint > sourceMap.parent.outPoint ||
    sourceMap.parent.outPoint > sourceMap.mediaDuration ||
    !isPlainRecord(sourceMap.parent.animation) ||
    !isValidBaseTransform(sourceMap.parent.animation.baseTransform) ||
    !Array.isArray(sourceMap.parent.animation.keyframes) ||
    !sourceMap.parent.animation.keyframes.every(isValidKeyframe) ||
    !Array.isArray(sourceMap.parent.animation.sourceEffectIds) ||
    !sourceMap.parent.animation.sourceEffectIds.every((id) => typeof id === 'string') ||
    !Array.isArray(sourceMap.parent.animation.sourceMaskIds) ||
    !sourceMap.parent.animation.sourceMaskIds.every((id) => typeof id === 'string') ||
    !sourceMap.segments.every(isValidV2Segment)) {
    return false;
  }

  return areContiguous(sourceMap.segments);
}

function resolveSegmentTime(
  segment: TransitionSourceMapSegment,
  compTime: number,
): ResolvedTransitionSourceTime | null {
  if (segment.kind === 'hold') {
    return { sourceTime: segment.sourceTime, sourceRate: 0, isHold: true };
  }

  const compDuration = segment.compEnd - segment.compStart;
  const sourceRate = (segment.sourceEnd - segment.sourceStart) / compDuration;
  if (!Number.isFinite(sourceRate)) return null;
  const progress = (compTime - segment.compStart) / compDuration;
  const sourceTime = segment.sourceStart + (segment.sourceEnd - segment.sourceStart) * progress;
  return Number.isFinite(sourceTime)
    ? { sourceTime, sourceRate, isHold: sourceRate === 0 }
    : null;
}

function getSegmentAtTime<T extends { compStart: number; compEnd: number }>(
  segments: readonly T[],
  compTime: number,
): { segment: T; time: number } | null {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const time = Math.min(Math.max(compTime, first.compStart), last.compEnd);
  const segment = time === last.compEnd
    ? last
    : segments.find((candidate) => time >= candidate.compStart && time < candidate.compEnd);
  return segment ? { segment, time } : null;
}

function getCanonicalSpeed(map: TransitionSourceMapV2, parentTime: number): number {
  const { duration, defaultSpeed, animation } = map.parent;
  const endpoint = parentTime < 0 ? 0 : parentTime > duration ? duration : parentTime;
  return getSpeedAtTime(animation.keyframes, endpoint, defaultSpeed);
}

function getCanonicalSourceIntegral(map: TransitionSourceMapV2, parentTime: number): number {
  const { duration, defaultSpeed, animation } = map.parent;
  const speedAtStart = getCanonicalSpeed(map, 0);
  if (parentTime < 0) return parentTime * speedAtStart;

  const sourceAtEnd = calculateSourceTime(animation.keyframes, duration, defaultSpeed);
  if (parentTime > duration) {
    return sourceAtEnd + (parentTime - duration) * getCanonicalSpeed(map, duration);
  }
  return calculateSourceTime(animation.keyframes, parentTime, defaultSpeed);
}

function resolveV2SegmentTime(
  map: TransitionSourceMapV2,
  segment: TransitionSourceMapV2Segment,
  compTime: number,
): ResolvedTransitionSourceTime | null {
  const compDuration = segment.compEnd - segment.compStart;
  const parentTime = segment.kind === 'parent-hold'
    ? segment.parentTime
    : segment.parentStart + (compTime - segment.compStart) / compDuration * (segment.parentEnd - segment.parentStart);
  const parentRate = segment.kind === 'parent-hold'
    ? 0
    : (segment.parentEnd - segment.parentStart) / compDuration;
  const speed = getCanonicalSpeed(map, parentTime);
  const { inPoint, outPoint } = map.parent;
  const rawSourceTime = (getCanonicalSpeed(map, 0) >= 0 ? inPoint : outPoint) +
    getCanonicalSourceIntegral(map, parentTime);
  const sourceTime = Math.min(Math.max(rawSourceTime, 0), map.mediaDuration);
  let sourceRate = parentRate * speed;
  const isGenuinelyOutside = rawSourceTime < -MEDIA_BOUND_EPSILON ||
    rawSourceTime > map.mediaDuration + MEDIA_BOUND_EPSILON;
  const isOutwardAtBound =
    (Math.abs(rawSourceTime) <= MEDIA_BOUND_EPSILON && sourceRate < 0) ||
    (Math.abs(rawSourceTime - map.mediaDuration) <= MEDIA_BOUND_EPSILON && sourceRate > 0);
  const isHold = segment.kind === 'parent-hold' || sourceRate === 0 ||
    isGenuinelyOutside || isOutwardAtBound;
  if (isHold) sourceRate = 0;

  return Number.isFinite(parentTime) && Number.isFinite(rawSourceTime) && Number.isFinite(sourceRate)
    ? { sourceTime, sourceRate, isHold, animationTime: parentTime }
    : null;
}

/** Returns null for an absent or invalid map rather than fabricating source time. */
export function resolveTransitionSourceMapTime(
  sourceMap: unknown,
  compTime: number,
): ResolvedTransitionSourceTime | null {
  if (!Number.isFinite(compTime) || !isValidTransitionSourceMap(sourceMap)) {
    return null;
  }

  if (sourceMap.version === 1) {
    const resolvedSegment = getSegmentAtTime(sourceMap.segments, compTime);
    return resolvedSegment ? resolveSegmentTime(resolvedSegment.segment, resolvedSegment.time) : null;
  }

  const resolvedSegment = getSegmentAtTime(sourceMap.segments, compTime);
  return resolvedSegment ? resolveV2SegmentTime(sourceMap, resolvedSegment.segment, resolvedSegment.time) : null;
}

/** Uses half-open windows, so an exact shared boundary belongs to the next window. */
export function resolveTransitionRecipeBlendMode(
  windows: readonly TransitionRecipeBlendWindow[] | undefined,
  compTime: number,
  baseBlendMode: BlendMode,
): BlendMode {
  if (!Number.isFinite(compTime)) return baseBlendMode;

  return windows?.find((window) =>
    Number.isFinite(window.compStart) &&
    Number.isFinite(window.compEnd) &&
    window.compEnd > window.compStart &&
    compTime >= window.compStart &&
    compTime < window.compEnd
  )?.blendMode ?? baseBlendMode;
}
