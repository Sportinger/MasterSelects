import {
  MOTION_MEDIA_REQUEST_VERSION,
  type MotionMediaEvaluationRequest,
  type MotionMediaFitMode,
  type MotionMediaSourceKind,
  type MotionMediaTimingMode,
} from './contracts';
import { createAvailableMotionMediaBinding } from './sourceReferencePlanner';
import { createMotionMediaSourceReference } from './sourceReferencePlanner';

export function createMotionMediaRequestFixture(
  overrides: {
    kind?: MotionMediaSourceKind;
    stableAssetId?: string;
    durationSeconds?: number | null;
    mode?: MotionMediaTimingMode;
    fitMode?: MotionMediaFitMode;
    clipLocalTimeSeconds?: number;
    instanceIndex?: number;
    perInstanceOffsetSeconds?: number;
    ticksPerSecond?: number;
  } = {},
): MotionMediaEvaluationRequest {
  const kind = overrides.kind ?? 'video';
  const durationSeconds = overrides.durationSeconds
    ?? (kind === 'image' ? null : 12);
  const source = createMotionMediaSourceReference(
    kind,
    overrides.stableAssetId ?? 'asset-fixture-01',
    durationSeconds,
  );
  const image = kind === 'image';
  return {
    contractVersion: MOTION_MEDIA_REQUEST_VERSION,
    binding: createAvailableMotionMediaBinding(source, 'binding-revision-1'),
    clipLocalTimeSeconds: overrides.clipLocalTimeSeconds ?? 2.25,
    instanceIndex: overrides.instanceIndex ?? 0,
    timing: {
      mode: overrides.mode ?? 'forward',
      sourceInSeconds: 0,
      sourceOutSeconds: image ? 0 : durationSeconds as number,
      freezeTimeSeconds: image ? 0 : 3,
      playbackRate: 1,
      perInstanceOffsetSeconds: overrides.perInstanceOffsetSeconds ?? 0,
    },
    quantization: {
      ticksPerSecond: overrides.ticksPerSecond ?? 1_000,
      rounding: 'nearest-half-up',
    },
    renderParameters: {
      targetWidth: 1_920,
      targetHeight: 1_080,
      pixelRatio: 1,
      fitMode: overrides.fitMode ?? 'fit',
      positionX: 0,
      positionY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDegrees: 0,
      tileRepeatX: 1,
      tileRepeatY: 1,
      tileOffsetX: 0,
      tileOffsetY: 0,
      sampling: 'linear',
    },
  };
}
