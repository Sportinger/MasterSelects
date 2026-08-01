import type { Keyframe } from '../../types/keyframes';
import type { BezierHandle } from '../../types/animationProperties';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import type { Layer } from '../../types/layers';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import {
  calculateLayerOverlayBounds,
  resolvePositionDeltaForCanvasDelta,
  type OverlayPoint,
} from './editModeOverlayMath';
import {
  getLayerSourceSize,
  withClipProjectionTransform,
} from './maskOverlay/maskOverlayProjectionPlans';

const POSITION_X = 'position.x' as const;
const POSITION_Y = 'position.y' as const;
const DEFAULT_SAMPLES_PER_SEGMENT = 12;
const HANDLE_TIME_EPSILON = 0.000001;

export interface MotionPathPosition {
  x: number;
  y: number;
}

export interface MotionPathKeyframeGroups {
  x: Keyframe[];
  y: Keyframe[];
}

export interface MotionPathNode extends MotionPathPosition {
  id: string;
  time: number;
  xKeyframeId: string | null;
  yKeyframeId: string | null;
  xEasing: Keyframe['easing'] | null;
  yEasing: Keyframe['easing'] | null;
}

export type MotionPathHandleDirection = 'in' | 'out';

export interface MotionPathSpatialHandle {
  id: string;
  nodeId: string;
  nodeTime: number;
  direction: MotionPathHandleDirection;
  nodePosition: MotionPathPosition;
  position: MotionPathPosition;
  temporalOffset: number;
  xKeyframeId: string;
  yKeyframeId: string;
}

export interface MotionPathSample extends MotionPathPosition {
  time: number;
}

export interface MotionPathOnionPosition extends MotionPathSample {
  direction: 'previous' | 'next';
  frameOffset: number;
}

export interface MotionPathProjectionContext {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  scale: MotionPathPosition;
  rotation: number;
}

export interface CreateMotionPathProjectionContextInput {
  layer: Layer;
  projectionTransform?: ClipTransform | null;
  effectiveResolution: { width: number; height: number };
  canvasSize: { width: number; height: number };
}

export type MotionPathIneligibilityReason =
  | 'disabled'
  | 'missing-clip'
  | 'source-monitor'
  | 'non-editable-source'
  | 'playback'
  | 'mask-mode'
  | 'text-mode'
  | 'locked-track'
  | 'camera-layer'
  | 'three-dimensional-layer'
  | 'missing-projection';

export type MotionPathEligibility =
  | { eligible: true; reason: null }
  | { eligible: false; reason: MotionPathIneligibilityReason };

export interface MotionPathEligibilityInput {
  enabled: boolean;
  clip: Pick<TimelineClip, 'is3D' | 'source'> | null;
  editableSource: boolean;
  sourceMonitorActive: boolean;
  playbackActive: boolean;
  maskModeActive: boolean;
  textModeActive: boolean;
  trackLocked?: boolean;
  hasProjection: boolean;
}

/**
 * Preview layer arrays can be transiently sparse while the render graph is
 * rebuilding. Resolve the selected clip's layer without dereferencing those
 * temporary holes.
 */
export function findMotionPathLayer(
  layers: readonly (Layer | null | undefined)[],
  selectedLayerId: string | null,
  clipId: string | null,
): Layer | null {
  if (!clipId) return null;
  const selectedLayer = layers.find(
    (layer): layer is Layer => layer?.id === selectedLayerId,
  );
  if (selectedLayer?.sourceClipId === clipId) return selectedLayer;
  return layers.find(
    (layer): layer is Layer => layer?.sourceClipId === clipId,
  ) ?? null;
}

function isFinitePositionKeyframe(keyframe: Keyframe): boolean {
  return (keyframe.property === POSITION_X || keyframe.property === POSITION_Y)
    && Number.isFinite(keyframe.time)
    && Number.isFinite(keyframe.value);
}

export function groupMotionPathPositionKeyframes(
  keyframes: readonly Keyframe[],
): MotionPathKeyframeGroups {
  const positionKeyframes = keyframes.filter(isFinitePositionKeyframe);
  return {
    x: positionKeyframes
      .filter((keyframe) => keyframe.property === POSITION_X)
      .sort((left, right) => left.time - right.time),
    y: positionKeyframes
      .filter((keyframe) => keyframe.property === POSITION_Y)
      .sort((left, right) => left.time - right.time),
  };
}

export function getMotionPathNodeTimes(
  keyframes: readonly Keyframe[] | MotionPathKeyframeGroups,
): number[] {
  const groups = Array.isArray(keyframes)
    ? groupMotionPathPositionKeyframes(keyframes)
    : keyframes as MotionPathKeyframeGroups;
  return [...new Set([
    ...groups.x.map((keyframe) => keyframe.time),
    ...groups.y.map((keyframe) => keyframe.time),
  ])].sort((left, right) => left - right);
}

export function sampleMotionPathPosition(
  keyframes: readonly Keyframe[],
  time: number,
  basePosition: MotionPathPosition,
): MotionPathPosition {
  const interpolationInput = [...keyframes];
  return {
    x: interpolateKeyframes(interpolationInput, POSITION_X, time, basePosition.x),
    y: interpolateKeyframes(interpolationInput, POSITION_Y, time, basePosition.y),
  };
}

export function buildMotionPathNodes(
  keyframes: readonly Keyframe[],
  basePosition: MotionPathPosition,
): MotionPathNode[] {
  const groups = groupMotionPathPositionKeyframes(keyframes);
  return getMotionPathNodeTimes(groups).map((time) => {
    const xKeyframe = groups.x.find((keyframe) => keyframe.time === time) ?? null;
    const yKeyframe = groups.y.find((keyframe) => keyframe.time === time) ?? null;
    return {
      id: `motion-path-node:${time}`,
      time,
      ...sampleMotionPathPosition(keyframes, time, basePosition),
      xKeyframeId: xKeyframe?.id ?? null,
      yKeyframeId: yKeyframe?.id ?? null,
      xEasing: xKeyframe?.easing ?? null,
      yEasing: yKeyframe?.easing ?? null,
    };
  });
}

function finiteBezierHandle(handle: BezierHandle | undefined): BezierHandle | null {
  return handle && Number.isFinite(handle.x) && Number.isFinite(handle.y)
    ? handle
    : null;
}

function clampHandleTime(
  direction: MotionPathHandleDirection,
  value: number,
  segmentDuration: number,
): number {
  const duration = Math.max(0, segmentDuration);
  return direction === 'in'
    ? Math.max(-duration, Math.min(0, value))
    : Math.max(0, Math.min(duration, value));
}

/**
 * Scalar position curves store their temporal handle offset independently.
 * A viewport spatial handle needs one shared time, so disagreement is resolved
 * deterministically and written back to both axes on the first drag update.
 */
export function resolveMotionPathHandleTemporalOffset({
  direction,
  segmentDuration,
  xSegmentDuration,
  ySegmentDuration,
  xHandle,
  yHandle,
}: {
  direction: MotionPathHandleDirection;
  segmentDuration?: number;
  xSegmentDuration?: number;
  ySegmentDuration?: number;
  xHandle?: BezierHandle;
  yHandle?: BezierHandle;
}): number {
  const fallbackDuration = Number.isFinite(segmentDuration) ? Math.max(0, segmentDuration ?? 0) : 0;
  const xDuration = Number.isFinite(xSegmentDuration)
    ? Math.max(0, xSegmentDuration ?? 0)
    : fallbackDuration;
  const yDuration = Number.isFinite(ySegmentDuration)
    ? Math.max(0, ySegmentDuration ?? 0)
    : fallbackDuration;
  const commonDuration = Math.min(xDuration, yDuration);
  const finiteX = finiteBezierHandle(xHandle);
  const finiteY = finiteBezierHandle(yHandle);
  const clampedX = finiteX ? clampHandleTime(direction, finiteX.x, xDuration) : null;
  const clampedY = finiteY ? clampHandleTime(direction, finiteY.x, yDuration) : null;
  const fallback = (direction === 'in' ? -1 : 1) * commonDuration / 3;
  let resolved = fallback;

  if (clampedX !== null && clampedY !== null) {
    resolved = Math.abs(clampedX - clampedY) <= HANDLE_TIME_EPSILON
      ? clampedX
      : (clampedX + clampedY) / 2;
  } else if (clampedX !== null) {
    resolved = clampedX;
  } else if (clampedY !== null) {
    resolved = clampedY;
  }

  return clampHandleTime(direction, resolved, commonDuration);
}

function keyframeIndexAtTime(keyframes: readonly Keyframe[], time: number): number {
  return keyframes.findIndex((keyframe) => keyframe.time === time);
}

function buildSpatialHandle(
  node: MotionPathNode,
  direction: MotionPathHandleDirection,
  groups: MotionPathKeyframeGroups,
): MotionPathSpatialHandle | null {
  if (!node.xKeyframeId || !node.yKeyframeId) return null;
  const xIndex = keyframeIndexAtTime(groups.x, node.time);
  const yIndex = keyframeIndexAtTime(groups.y, node.time);
  if (xIndex < 0 || yIndex < 0) return null;

  const xKeyframe = groups.x[xIndex]!;
  const yKeyframe = groups.y[yIndex]!;
  const neighborOffset = direction === 'in' ? -1 : 1;
  const xNeighbor = groups.x[xIndex + neighborOffset];
  const yNeighbor = groups.y[yIndex + neighborOffset];
  if (!xNeighbor || !yNeighbor) return null;

  const xDuration = Math.abs(xNeighbor.time - node.time);
  const yDuration = Math.abs(yNeighbor.time - node.time);
  if (!(xDuration > 0) || !(yDuration > 0)) return null;

  const xHandle = finiteBezierHandle(direction === 'in' ? xKeyframe.handleIn : xKeyframe.handleOut);
  const yHandle = finiteBezierHandle(direction === 'in' ? yKeyframe.handleIn : yKeyframe.handleOut);
  const xValueOffset = xHandle?.y ?? (xNeighbor.value - xKeyframe.value) / 3;
  const yValueOffset = yHandle?.y ?? (yNeighbor.value - yKeyframe.value) / 3;
  const xTemporalOffset = xHandle
    ? clampHandleTime(direction, xHandle.x, xDuration)
    : (direction === 'in' ? -xDuration : xDuration) / 3;
  const yTemporalOffset = yHandle
    ? clampHandleTime(direction, yHandle.x, yDuration)
    : (direction === 'in' ? -yDuration : yDuration) / 3;
  const temporalOffset = resolveMotionPathHandleTemporalOffset({
    direction,
    xSegmentDuration: xDuration,
    ySegmentDuration: yDuration,
    xHandle: xHandle ?? undefined,
    yHandle: yHandle ?? undefined,
  });
  const alignValueOffset = (valueOffset: number, scalarTemporalOffset: number) => {
    if (Math.abs(scalarTemporalOffset) <= HANDLE_TIME_EPSILON) {
      // A zero/opposite-sign scalar time has no finite spatial derivative.
      // Keep its visible endpoint continuous; the first edit explicitly aligns
      // that value offset to the valid shared temporal coordinate.
      return Math.abs(temporalOffset) <= HANDLE_TIME_EPSILON ? 0 : valueOffset;
    }
    return valueOffset * (temporalOffset / scalarTemporalOffset);
  };

  return {
    id: `${node.id}:${direction}`,
    nodeId: node.id,
    nodeTime: node.time,
    direction,
    nodePosition: { x: node.x, y: node.y },
    position: {
      x: node.x + alignValueOffset(xValueOffset, xTemporalOffset),
      y: node.y + alignValueOffset(yValueOffset, yTemporalOffset),
    },
    temporalOffset,
    xKeyframeId: node.xKeyframeId,
    yKeyframeId: node.yKeyframeId,
  };
}

/** Build spatial handles only for selected nodes with a complete X/Y pair. */
export function buildMotionPathSpatialHandles(
  keyframes: readonly Keyframe[],
  basePosition: MotionPathPosition,
  selectedKeyframeIds: ReadonlySet<string>,
): MotionPathSpatialHandle[] {
  const groups = groupMotionPathPositionKeyframes(keyframes);
  return buildMotionPathNodes(keyframes, basePosition).flatMap((node) => {
    const selected = (node.xKeyframeId !== null && selectedKeyframeIds.has(node.xKeyframeId))
      || (node.yKeyframeId !== null && selectedKeyframeIds.has(node.yKeyframeId));
    if (!selected || !node.xKeyframeId || !node.yKeyframeId) return [];
    return [
      buildSpatialHandle(node, 'in', groups),
      buildSpatialHandle(node, 'out', groups),
    ].filter((handle): handle is MotionPathSpatialHandle => handle !== null);
  });
}

export function sampleMotionPath(
  keyframes: readonly Keyframe[],
  basePosition: MotionPathPosition,
  samplesPerSegment: number = DEFAULT_SAMPLES_PER_SEGMENT,
): MotionPathSample[] {
  const times = getMotionPathNodeTimes(keyframes);
  if (times.length === 0) return [];
  if (times.length === 1) {
    return [{ time: times[0]!, ...sampleMotionPathPosition(keyframes, times[0]!, basePosition) }];
  }

  const segmentSamples = Math.max(1, Math.min(64, Math.round(samplesPerSegment)));
  const result: MotionPathSample[] = [];
  for (let segmentIndex = 0; segmentIndex < times.length - 1; segmentIndex += 1) {
    const start = times[segmentIndex]!;
    const end = times[segmentIndex + 1]!;
    for (let sampleIndex = 0; sampleIndex <= segmentSamples; sampleIndex += 1) {
      if (segmentIndex > 0 && sampleIndex === 0) continue;
      const time = start + ((end - start) * sampleIndex) / segmentSamples;
      result.push({ time, ...sampleMotionPathPosition(keyframes, time, basePosition) });
    }
  }
  return result;
}

export function sampleMotionPathOnionPositions({
  keyframes,
  basePosition,
  localTime,
  frameRate,
  frameOffset = 1,
  clipDuration,
}: {
  keyframes: readonly Keyframe[];
  basePosition: MotionPathPosition;
  localTime: number;
  frameRate: number;
  frameOffset?: number;
  clipDuration: number;
}): MotionPathOnionPosition[] {
  if (!Number.isFinite(localTime) || !Number.isFinite(frameRate) || frameRate <= 0) return [];
  if (!Number.isFinite(clipDuration) || clipDuration < 0) return [];

  const safeFrameOffset = Math.max(1, Math.round(frameOffset));
  const frameDelta = safeFrameOffset / frameRate;
  const candidates = [
    { direction: 'previous' as const, time: localTime - frameDelta, frameOffset: -safeFrameOffset },
    { direction: 'next' as const, time: localTime + frameDelta, frameOffset: safeFrameOffset },
  ];

  return candidates
    .filter(({ time }) => time >= 0 && time <= clipDuration)
    .map(({ direction, time, frameOffset: signedFrameOffset }) => ({
      direction,
      time,
      frameOffset: signedFrameOffset,
      ...sampleMotionPathPosition(keyframes, time, basePosition),
    }));
}

export function createMotionPathProjectionContext({
  layer,
  projectionTransform,
  effectiveResolution,
  canvasSize,
}: CreateMotionPathProjectionContextInput): MotionPathProjectionContext {
  const projectionLayer = withClipProjectionTransform(layer, projectionTransform) ?? layer;
  const sourceSize = getLayerSourceSize(projectionLayer, effectiveResolution);
  const rotation = typeof projectionLayer.rotation === 'number'
    ? projectionLayer.rotation
    : projectionLayer.rotation.z;
  return {
    sourceWidth: sourceSize.width,
    sourceHeight: sourceSize.height,
    outputWidth: effectiveResolution.width,
    outputHeight: effectiveResolution.height,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height,
    scale: { x: projectionLayer.scale.x, y: projectionLayer.scale.y },
    rotation,
  };
}

function positionBounds(
  position: MotionPathPosition,
  context: MotionPathProjectionContext,
) {
  return calculateLayerOverlayBounds({
    ...context,
    position,
  });
}

/**
 * Projects stored 2D position values into the preview canvas' local display
 * coordinates. The preview wrapper remains the single owner of pan and zoom.
 */
export function projectMotionPathPosition(
  position: MotionPathPosition,
  context: MotionPathProjectionContext,
): OverlayPoint {
  const bounds = positionBounds(position, context);
  return { x: bounds.x, y: bounds.y };
}

/** Resolves a canvas-local display delta back into stored position values. */
export function resolveMotionPathPositionDelta(
  basePosition: MotionPathPosition,
  canvasDelta: OverlayPoint,
  context: MotionPathProjectionContext,
): MotionPathPosition {
  const baseBounds = positionBounds(basePosition, context);
  const xPlusBounds = positionBounds({ x: basePosition.x + 1, y: basePosition.y }, context);
  const yPlusBounds = positionBounds({ x: basePosition.x, y: basePosition.y + 1 }, context);
  return resolvePositionDeltaForCanvasDelta(
    baseBounds,
    xPlusBounds,
    yPlusBounds,
    canvasDelta,
  );
}

export function unprojectMotionPathPosition(
  canvasPoint: OverlayPoint,
  referencePosition: MotionPathPosition,
  context: MotionPathProjectionContext,
): MotionPathPosition {
  const projectedReference = projectMotionPathPosition(referencePosition, context);
  const delta = resolveMotionPathPositionDelta(referencePosition, {
    x: canvasPoint.x - projectedReference.x,
    y: canvasPoint.y - projectedReference.y,
  }, context);
  return {
    x: referencePosition.x + delta.x,
    y: referencePosition.y + delta.y,
  };
}

export function resolveMotionPathEligibility(
  input: MotionPathEligibilityInput,
): MotionPathEligibility {
  if (!input.enabled) return { eligible: false, reason: 'disabled' };
  if (!input.clip) return { eligible: false, reason: 'missing-clip' };
  if (input.sourceMonitorActive) return { eligible: false, reason: 'source-monitor' };
  if (!input.editableSource) return { eligible: false, reason: 'non-editable-source' };
  if (input.playbackActive) return { eligible: false, reason: 'playback' };
  if (input.maskModeActive) return { eligible: false, reason: 'mask-mode' };
  if (input.textModeActive) return { eligible: false, reason: 'text-mode' };
  if (input.trackLocked) return { eligible: false, reason: 'locked-track' };
  if (input.clip.source?.type === 'camera') return { eligible: false, reason: 'camera-layer' };

  const sourceType = input.clip.source?.type;
  if (input.clip.is3D
    || sourceType === 'model'
    || sourceType === 'gaussian-splat'
    || sourceType === 'splat-effector'
    || sourceType === 'light') {
    return { eligible: false, reason: 'three-dimensional-layer' };
  }
  if (!input.hasProjection) return { eligible: false, reason: 'missing-projection' };
  return { eligible: true, reason: null };
}
