import {
  MOTION_MEDIA_MAX_RENDER_DIMENSION,
  MOTION_MEDIA_MAX_SOURCE_DURATION_SECONDS,
  MOTION_MEDIA_MAX_TILE_REPEAT_PER_AXIS,
  MOTION_MEDIA_MAX_TIMEBASE_TICKS_PER_SECOND,
  type MotionMediaDecoderPoolIdentity,
  type MotionMediaFramePoolIdentity,
  type MotionMediaRenderParameters,
  type MotionMediaResolvedTime,
} from './contracts';
import {
  assertMotionMediaBindingRevision,
  assertMotionMediaSourceId,
} from './sourceReferencePlanner';
import { assertMotionMediaInertJson } from './contractSafety';

const REUSE_KEY_VERSION = 'motion-media-reuse/v1';
const FRAME_IDENTITY_VERSION = 'motion-media-frame-identity/v1';
const DECODER_IDENTITY_VERSION = 'motion-media-decoder-identity/v1';

export function buildMotionMediaReuseKey(
  sourceId: string,
  resolvedTime: MotionMediaResolvedTime,
  renderParameters: MotionMediaRenderParameters,
): string {
  assertMotionMediaSourceId(sourceId);
  assertMotionMediaResolvedTime(resolvedTime);
  assertMotionMediaRenderParameters(renderParameters);

  // Fixed insertion order is the canonical wire representation for the tuple.
  return `${REUSE_KEY_VERSION}:${JSON.stringify({
    sourceId,
    resolvedTime: {
      ticks: resolvedTime.ticks,
      ticksPerSecond: resolvedTime.ticksPerSecond,
    },
    renderParameters: {
      targetWidth: renderParameters.targetWidth,
      targetHeight: renderParameters.targetHeight,
      pixelRatio: renderParameters.pixelRatio,
      fitMode: renderParameters.fitMode,
      positionX: renderParameters.positionX,
      positionY: renderParameters.positionY,
      scaleX: renderParameters.scaleX,
      scaleY: renderParameters.scaleY,
      rotationDegrees: renderParameters.rotationDegrees,
      tileRepeatX: renderParameters.tileRepeatX,
      tileRepeatY: renderParameters.tileRepeatY,
      tileOffsetX: renderParameters.tileOffsetX,
      tileOffsetY: renderParameters.tileOffsetY,
      sampling: renderParameters.sampling,
    },
  })}`;
}

export function buildMotionMediaFramePoolIdentity(
  sourceId: string,
  reuseKey: string,
  bindingRevision: string,
): MotionMediaFramePoolIdentity {
  assertMotionMediaSourceId(sourceId);
  assertMotionMediaReuseKey(reuseKey);
  assertMotionMediaBindingRevision(bindingRevision);
  return {
    identityKey: `${FRAME_IDENTITY_VERSION}:${JSON.stringify({
      sourceId,
      reuseKey,
      bindingRevision,
    })}`,
    sourceId,
    reuseKey,
    bindingRevision,
  };
}

export function buildMotionMediaDecoderPoolIdentity(
  sourceId: string,
  bindingRevision: string,
): MotionMediaDecoderPoolIdentity {
  assertMotionMediaSourceId(sourceId);
  assertMotionMediaBindingRevision(bindingRevision);
  return {
    identityKey: `${DECODER_IDENTITY_VERSION}:${JSON.stringify({
      sourceId,
      bindingRevision,
    })}`,
    sourceId,
    bindingRevision,
  };
}

export function assertMotionMediaRenderParameters(
  value: unknown,
): asserts value is MotionMediaRenderParameters {
  assertMotionMediaInertJson(value);
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      'targetWidth',
      'targetHeight',
      'pixelRatio',
      'fitMode',
      'positionX',
      'positionY',
      'scaleX',
      'scaleY',
      'rotationDegrees',
      'tileRepeatX',
      'tileRepeatY',
      'tileOffsetX',
      'tileOffsetY',
      'sampling',
    ])
    || !isPositiveIntegerInRange(value.targetWidth, MOTION_MEDIA_MAX_RENDER_DIMENSION)
    || !isPositiveIntegerInRange(value.targetHeight, MOTION_MEDIA_MAX_RENDER_DIMENSION)
    || !isFiniteNumber(value.pixelRatio)
    || value.pixelRatio <= 0
    || value.pixelRatio > 8
    || !['fit', 'fill', 'stretch', 'tile'].includes(String(value.fitMode))
    || !isFiniteNumber(value.positionX)
    || !isFiniteNumber(value.positionY)
    || !isFiniteNumber(value.scaleX)
    || !isFiniteNumber(value.scaleY)
    || value.scaleX === 0
    || value.scaleY === 0
    || !isFiniteNumber(value.rotationDegrees)
    || !isPositiveIntegerInRange(
      value.tileRepeatX,
      MOTION_MEDIA_MAX_TILE_REPEAT_PER_AXIS,
    )
    || !isPositiveIntegerInRange(
      value.tileRepeatY,
      MOTION_MEDIA_MAX_TILE_REPEAT_PER_AXIS,
    )
    || !isFiniteNumber(value.tileOffsetX)
    || !isFiniteNumber(value.tileOffsetY)
    || (value.sampling !== 'linear' && value.sampling !== 'nearest')
  ) {
    throw new Error('Invalid motion media render parameters');
  }
}

export function assertMotionMediaResolvedTime(
  value: unknown,
): asserts value is MotionMediaResolvedTime {
  assertMotionMediaInertJson(value);
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ['ticks', 'ticksPerSecond', 'seconds'])
    || !isNonNegativeInteger(value.ticks)
    || !isPositiveIntegerInRange(
      value.ticksPerSecond,
      MOTION_MEDIA_MAX_TIMEBASE_TICKS_PER_SECOND,
    )
    || !isFiniteNumber(value.seconds)
    || value.seconds > MOTION_MEDIA_MAX_SOURCE_DURATION_SECONDS
    || value.seconds !== value.ticks / value.ticksPerSecond
  ) {
    throw new Error('Invalid resolved motion media time');
  }
}

function assertMotionMediaReuseKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || !value.startsWith(`${REUSE_KEY_VERSION}:`)
  ) {
    throw new Error('Invalid motion media tuple reuse key');
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveIntegerInRange(value: unknown, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= maximum;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === allowed.size
    && actual.every((key) => allowed.has(key));
}
