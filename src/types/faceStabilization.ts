import type { NodeGraphLayout } from './nodeGraph';

/** Serializable provenance; landmark samples and runtime handles remain outside the project. */
export interface FaceStabilizationBake {
  version: 1;
  target: 'face' | 'lips';
  lockCenter: boolean;
  smoothing: number;
  sourceId: string;
  trackingCreatedAt: number;
  bakedAt: number;
  frameRate: number;
  sampleCount: number;
  detectedSamples: number;
  inputSignature: string;
  curveSignature: string;
}

export interface ClipStabilizationGraph {
  bake?: FaceStabilizationBake;
  layouts?: Partial<Record<'solve' | 'keyframes', NodeGraphLayout>>;
}
