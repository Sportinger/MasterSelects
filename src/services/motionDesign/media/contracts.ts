export const MOTION_MEDIA_REQUEST_VERSION = 'motion-media-request/v1' as const;
export const MOTION_MEDIA_EVALUATION_VERSION =
  'motion-media-evaluation/v1' as const;
export const MOTION_MEDIA_POOL_PLAN_VERSION =
  'motion-media-pool-plan/v1' as const;

export const MOTION_MEDIA_MAX_SOURCE_ID_LENGTH = 512;
export const MOTION_MEDIA_MAX_SOURCE_DURATION_SECONDS = 604_800;
export const MOTION_MEDIA_MAX_ABSOLUTE_CLIP_LOCAL_TIME_SECONDS = 604_800;
export const MOTION_MEDIA_MAX_ABSOLUTE_INSTANCE_OFFSET_SECONDS = 86_400;
export const MOTION_MEDIA_MAX_PLAYBACK_RATE = 64;
export const MOTION_MEDIA_MAX_TIMEBASE_TICKS_PER_SECOND = 1_000_000;
export const MOTION_MEDIA_MAX_JSON_DEPTH = 32;
export const MOTION_MEDIA_MAX_RENDER_DIMENSION = 16_384;
export const MOTION_MEDIA_MAX_TILE_REPEAT_PER_AXIS = 1_024;
export const MOTION_MEDIA_MAX_STABLE_INSTANCE_COUNT = 100_000;
export const MOTION_MEDIA_MAX_EVALUATIONS_PER_POOL_PLAN = 10_000;

/** Hard planning caps. These are admission limits, not allocation instructions. */
export const MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES = 256;
export const MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES = 512 * 1024 * 1024;
export const MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES = 8;

export type MotionMediaSourceKind = 'image' | 'video' | 'nested-composition';
export type MotionMediaFitMode = 'fit' | 'fill' | 'stretch' | 'tile';
export type MotionMediaTimingMode =
  | 'forward'
  | 'freeze'
  | 'reverse'
  | 'loop'
  | 'pingpong';

export interface MotionMediaSourceReference {
  kind: MotionMediaSourceKind;
  sourceId: string;
  /** Null is reserved for still-image sources. */
  durationSeconds: number | null;
}

export type MotionMediaSourceAvailability =
  | {
    state: 'available';
    bindingRevision: string;
  }
  | {
    state: 'missing';
    reason: 'not-found' | 'offline' | 'permission-denied';
    lastBindingRevision: string | null;
  }
  | {
    state: 'relinked';
    bindingRevision: string;
    relinkedFromRevision: string | null;
  };

/**
 * The stable intent remains untouched when availability changes. Runtime leases,
 * paths, decoder objects, frame objects, and textures never enter this envelope.
 */
export interface MotionMediaSourceBinding {
  intent: MotionMediaSourceReference;
  availability: MotionMediaSourceAvailability;
}

export interface MotionMediaTimingContract {
  mode: MotionMediaTimingMode;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  freezeTimeSeconds: number;
  playbackRate: number;
  perInstanceOffsetSeconds: number;
}

export interface MotionMediaTimeQuantizationContract {
  ticksPerSecond: number;
  rounding: 'nearest-half-up';
}

export interface MotionMediaRenderParameters {
  targetWidth: number;
  targetHeight: number;
  pixelRatio: number;
  fitMode: MotionMediaFitMode;
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  rotationDegrees: number;
  tileRepeatX: number;
  tileRepeatY: number;
  tileOffsetX: number;
  tileOffsetY: number;
  sampling: 'linear' | 'nearest';
}

export interface MotionMediaEvaluationRequest {
  contractVersion: typeof MOTION_MEDIA_REQUEST_VERSION;
  binding: MotionMediaSourceBinding;
  /** Always clip-local seconds. Parent composition time is not accepted here. */
  clipLocalTimeSeconds: number;
  /** Zero-based, non-negative, stable Replicator instance index. */
  instanceIndex: number;
  timing: MotionMediaTimingContract;
  quantization: MotionMediaTimeQuantizationContract;
  renderParameters: MotionMediaRenderParameters;
}

export interface MotionMediaResolvedTime {
  ticks: number;
  ticksPerSecond: number;
  seconds: number;
}

export type MotionMediaDiagnosticCode =
  | 'SOURCE_MISSING'
  | 'FRAME_POOL_BUDGET_EXCEEDED'
  | 'DECODER_POOL_BUDGET_EXCEEDED';

export interface MotionMediaDiagnostic {
  code: MotionMediaDiagnosticCode;
  sourceId: string;
  message: string;
}

interface MotionMediaFrameEvaluationBase {
  contractVersion: typeof MOTION_MEDIA_EVALUATION_VERSION;
  sourceId: string;
  sourceKind: MotionMediaSourceKind;
  bindingRevision: string | null;
  clipLocalTimeSeconds: number;
  instanceIndex: number;
  renderParameters: MotionMediaRenderParameters;
}

export interface ReadyMotionMediaFrameEvaluation
  extends MotionMediaFrameEvaluationBase {
  status: 'ready';
  bindingRevision: string;
  resolvedTime: MotionMediaResolvedTime;
  reuseKey: string;
  diagnostics: [];
}

export interface UnavailableMotionMediaFrameEvaluation
  extends MotionMediaFrameEvaluationBase {
  status: 'unavailable';
  resolvedTime: null;
  reuseKey: null;
  diagnostics: [MotionMediaDiagnostic];
}

export type MotionMediaFrameEvaluation =
  | ReadyMotionMediaFrameEvaluation
  | UnavailableMotionMediaFrameEvaluation;

export interface MotionMediaPoolRequestPlan {
  requestIndex: number;
  sourceId: string;
  sourceKind: MotionMediaSourceKind;
  bindingRevision: string | null;
  reuseKey: string | null;
  frameIdentityKey: string | null;
  decoderIdentityKey: string | null;
  status: 'admitted' | 'unavailable' | 'rejected';
  reusesFrame: boolean;
  reusesDecoder: boolean;
  diagnostics: MotionMediaDiagnostic[];
}

export interface MotionMediaFramePoolIdentity {
  identityKey: string;
  sourceId: string;
  reuseKey: string;
  bindingRevision: string;
}

export interface MotionMediaDecoderPoolIdentity {
  identityKey: string;
  sourceId: string;
  bindingRevision: string;
}

export interface MotionMediaResourcePoolPlan {
  contractVersion: typeof MOTION_MEDIA_POOL_PLAN_VERSION;
  framePool: {
    hardLimit: typeof MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES;
    hardEstimatedByteLimit: typeof MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES;
    uniqueIdentitiesRequested: number;
    admittedEstimatedBytes: number;
    admittedFrames: MotionMediaFramePoolIdentity[];
  };
  decoderPool: {
    hardLimit: typeof MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES;
    uniqueBindingsRequested: number;
    admittedDecoders: MotionMediaDecoderPoolIdentity[];
  };
  requests: MotionMediaPoolRequestPlan[];
}

/** Frozen v1 time-domain semantics, suitable for UI/help and fixture assertions. */
export const MOTION_MEDIA_TIME_SEMANTICS = {
  inputBasis: 'clip-local-seconds',
  instanceIndexBasis: 'zero-based',
  activeWindow: 'source-in-inclusive-source-out-inclusive',
  forwardNegativeTime: 'clamp-to-source-in',
  reverseNegativeTime: 'clamp-to-source-out',
  loopEndpoint: 'source-out-wraps-to-source-in',
  pingpongEndpoint: 'source-out-emitted-on-turnaround',
  quantization: 'nearest-half-up-after-time-mode-resolution',
} as const;
