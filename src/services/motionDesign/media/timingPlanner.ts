import {
  MOTION_MEDIA_MAX_ABSOLUTE_CLIP_LOCAL_TIME_SECONDS,
  MOTION_MEDIA_MAX_ABSOLUTE_INSTANCE_OFFSET_SECONDS,
  MOTION_MEDIA_MAX_PLAYBACK_RATE,
  MOTION_MEDIA_MAX_STABLE_INSTANCE_COUNT,
  MOTION_MEDIA_MAX_TIMEBASE_TICKS_PER_SECOND,
  type MotionMediaResolvedTime,
  type MotionMediaSourceReference,
  type MotionMediaTimeQuantizationContract,
  type MotionMediaTimingContract,
} from './contracts';
import { assertMotionMediaSourceReference } from './sourceReferencePlanner';
import { assertMotionMediaInertJson } from './contractSafety';

export function resolveMotionMediaSourceTime(
  source: MotionMediaSourceReference,
  timing: MotionMediaTimingContract,
  quantization: MotionMediaTimeQuantizationContract,
  clipLocalTimeSeconds: number,
  instanceIndex: number,
): MotionMediaResolvedTime {
  assertMotionMediaTimingInputs(
    source,
    timing,
    quantization,
    clipLocalTimeSeconds,
    instanceIndex,
  );

  if (source.kind === 'image') {
    return {
      ticks: 0,
      ticksPerSecond: quantization.ticksPerSecond,
      seconds: 0,
    };
  }

  const span = timing.sourceOutSeconds - timing.sourceInSeconds;
  const drivenTime = (clipLocalTimeSeconds * timing.playbackRate)
    + (instanceIndex * timing.perInstanceOffsetSeconds);
  let sourceTime: number;

  switch (timing.mode) {
    case 'freeze':
      sourceTime = timing.freezeTimeSeconds;
      break;
    case 'forward':
      sourceTime = timing.sourceInSeconds + clamp(drivenTime, 0, span);
      break;
    case 'reverse':
      sourceTime = timing.sourceOutSeconds - clamp(drivenTime, 0, span);
      break;
    case 'loop':
      sourceTime = timing.sourceInSeconds + euclideanModulo(drivenTime, span);
      break;
    case 'pingpong': {
      const phase = euclideanModulo(drivenTime, span * 2);
      sourceTime = phase <= span
        ? timing.sourceInSeconds + phase
        : timing.sourceOutSeconds - (phase - span);
      break;
    }
  }

  return quantizeWithinWindow(
    sourceTime,
    timing.sourceInSeconds,
    timing.sourceOutSeconds,
    quantization.ticksPerSecond,
  );
}

export function assertMotionMediaTimingInputs(
  source: MotionMediaSourceReference,
  timing: MotionMediaTimingContract,
  quantization: MotionMediaTimeQuantizationContract,
  clipLocalTimeSeconds: number,
  instanceIndex: number,
): void {
  assertMotionMediaSourceReference(source);
  assertMotionMediaInertJson(timing);
  assertMotionMediaInertJson(quantization);
  if (
    !isPlainRecord(timing)
    || !hasExactKeys(timing, [
      'mode',
      'sourceInSeconds',
      'sourceOutSeconds',
      'freezeTimeSeconds',
      'playbackRate',
      'perInstanceOffsetSeconds',
    ])
    || !isTimingMode(timing.mode)
    || !isFiniteNumber(timing.sourceInSeconds)
    || !isFiniteNumber(timing.sourceOutSeconds)
    || !isFiniteNumber(timing.freezeTimeSeconds)
    || !isFiniteNumber(timing.playbackRate)
    || timing.playbackRate <= 0
    || timing.playbackRate > MOTION_MEDIA_MAX_PLAYBACK_RATE
    || !isFiniteNumber(timing.perInstanceOffsetSeconds)
    || Math.abs(timing.perInstanceOffsetSeconds)
      > MOTION_MEDIA_MAX_ABSOLUTE_INSTANCE_OFFSET_SECONDS
  ) {
    throw new Error('Invalid motion media timing contract');
  }
  if (
    !isPlainRecord(quantization)
    || !hasExactKeys(quantization, ['ticksPerSecond', 'rounding'])
    || !Number.isInteger(quantization.ticksPerSecond)
    || quantization.ticksPerSecond < 1
    || quantization.ticksPerSecond > MOTION_MEDIA_MAX_TIMEBASE_TICKS_PER_SECOND
    || quantization.rounding !== 'nearest-half-up'
  ) {
    throw new Error('Invalid motion media time quantization contract');
  }
  if (
    !isFiniteNumber(clipLocalTimeSeconds)
    || Math.abs(clipLocalTimeSeconds)
      > MOTION_MEDIA_MAX_ABSOLUTE_CLIP_LOCAL_TIME_SECONDS
    || !Number.isInteger(instanceIndex)
    || instanceIndex < 0
    || instanceIndex >= MOTION_MEDIA_MAX_STABLE_INSTANCE_COUNT
  ) {
    throw new Error('Motion media clip-local time or instance index is out of bounds');
  }

  if (source.kind === 'image') {
    if (
      timing.sourceInSeconds !== 0
      || timing.sourceOutSeconds !== 0
      || timing.freezeTimeSeconds !== 0
    ) {
      throw new Error('Image timing endpoints must remain fixed at zero');
    }
    return;
  }

  const sourceDurationSeconds = source.durationSeconds;
  if (
    !isFiniteNumber(sourceDurationSeconds)
    || sourceDurationSeconds <= 0
    || timing.sourceInSeconds < 0
    || timing.sourceOutSeconds > sourceDurationSeconds
    || timing.sourceOutSeconds <= timing.sourceInSeconds
    || timing.freezeTimeSeconds < timing.sourceInSeconds
    || timing.freezeTimeSeconds > timing.sourceOutSeconds
  ) {
    throw new Error('Motion media source timing endpoints are out of bounds');
  }
  const firstRepresentableTick = Math.ceil(
    timing.sourceInSeconds * quantization.ticksPerSecond,
  );
  const lastRepresentableTick = Math.floor(
    timing.sourceOutSeconds * quantization.ticksPerSecond,
  );
  if (firstRepresentableTick > lastRepresentableTick) {
    throw new Error('Motion media source window has no representable quantized time');
  }
}

function quantizeWithinWindow(
  seconds: number,
  sourceInSeconds: number,
  sourceOutSeconds: number,
  ticksPerSecond: number,
): MotionMediaResolvedTime {
  const firstTick = Math.ceil(sourceInSeconds * ticksPerSecond);
  const lastTick = Math.floor(sourceOutSeconds * ticksPerSecond);
  const nearestTick = Math.floor((seconds * ticksPerSecond) + 0.5);
  const ticks = clamp(nearestTick, firstTick, lastTick);
  return {
    ticks,
    ticksPerSecond,
    seconds: ticks / ticksPerSecond,
  };
}

function euclideanModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isTimingMode(value: unknown): value is MotionMediaTimingContract['mode'] {
  return value === 'forward'
    || value === 'freeze'
    || value === 'reverse'
    || value === 'loop'
    || value === 'pingpong';
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
