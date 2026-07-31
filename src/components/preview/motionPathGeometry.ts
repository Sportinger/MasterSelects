import type { Keyframe } from '../../types/keyframes';
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
