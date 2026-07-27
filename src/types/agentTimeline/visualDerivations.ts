import type {
  AgentTimelineEventBase,
  AgentTimelineProvenance,
  CameraMotionEventData,
  NormalizedBox,
  ShotEventData,
} from './manifest';

export const CAMERA_MOTION_DERIVATION_VERSION = 'camera-motion-derivation/v1' as const;
export const SHOT_FRAMING_DERIVATION_VERSION = 'shot-framing-derivation/v1' as const;

export interface CameraMotionSample {
  time: number;
  end?: number;
  globalMotion: number;
  localMotion: number;
  meanMagnitude?: number;
  meanX?: number;
  meanY?: number;
  directionCoherence?: number;
  coverageRatio?: number;
  vectorConvention?: 'camera-motion' | 'image-flow';
  isSceneCut?: boolean;
}

export interface CameraMotionThresholds {
  staticMaxGlobalMotion: number;
  staticMaxLocalMotion: number;
  staticMaxMeanMagnitude: number;
  directionalMinMeanMagnitude: number;
  directionalMinCoherence: number;
  directionalMinCoverage: number;
  dominantAxisRatio: number;
  handheldMinLocalMotion: number;
  handheldMaxCoherence: number;
}

export type CameraMotionReason =
  | 'scene-cut-excluded'
  | 'below-static-thresholds'
  | 'missing-directional-measurements'
  | 'low-coherence-local-activity'
  | 'horizontal-coherent-flow'
  | 'vertical-coherent-flow'
  | 'diagonal-or-weak-global-flow';

export interface DerivedCameraMotionData extends CameraMotionEventData {
  reason: CameraMotionReason;
  measurements: {
    globalMotion: number;
    localMotion: number;
    meanMagnitude?: number;
    meanX?: number;
    meanY?: number;
    coverageRatio?: number;
  };
}

export type DerivedCameraMotionEvent = AgentTimelineEventBase<'camera-motion', DerivedCameraMotionData>;

export interface CameraMotionDerivationOptions {
  defaultSampleDuration: number;
  thresholds?: Partial<CameraMotionThresholds>;
  provenance?: AgentTimelineProvenance[];
  range?: { start: number; end: number };
}

export interface VisualFaceObservation {
  id: string;
  sourcePersonId: string;
  confidence: number;
  identityEligible: boolean;
  box: NormalizedBox;
}

export interface ShotFaceFrameSample {
  time: number;
  faces: VisualFaceObservation[];
}

export interface ShotBoundaryInput {
  shotId: string;
  start: number;
  end: number;
  index?: number;
  setupId?: string;
}

export interface ShotFramingThresholds {
  minimumFaceConfidence: number;
  minimumFaceHeight: number;
  minimumFaceFrameCoverage: number;
  extremeCloseUpMinHeight: number;
  closeUpMinHeight: number;
  mediumMinHeight: number;
  mediumWideMinHeight: number;
  leftMaxCenterX: number;
  rightMinCenterX: number;
}

export type ShotFramingReason =
  | 'no-reliable-face'
  | 'insufficient-face-coverage'
  | 'derived-from-face-boxes';

export interface DerivedShotFramingData extends ShotEventData {
  framingReason: ShotFramingReason;
  dominantFacePosition: 'left' | 'center' | 'right' | 'unknown';
  dominantFaceHeight?: number;
  headroom?: number;
  edgeProximity?: number;
  reliableFaceFrameCoverage: number;
}

export type DerivedShotFramingEvent = AgentTimelineEventBase<'shot', DerivedShotFramingData>;

export interface ShotFramingDerivationOptions {
  thresholds?: Partial<ShotFramingThresholds>;
  provenance?: AgentTimelineProvenance[];
}
