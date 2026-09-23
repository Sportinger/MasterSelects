/** Durable provenance for a grayscale depth video. Times address the original source, not the timeline. */
export interface DepthMapMetadata {
  version: 1;
  sourceMediaId: string;
  sourceFingerprint: string;
  sourceStart: number;
  sourceEnd: number;
  fps: number;
  nearIsWhite: boolean;
  model: string;
  modelRevision: string;
  edge: number;
  rangeSmoothing: number;
}
