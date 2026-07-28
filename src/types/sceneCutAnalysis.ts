export const SCENE_CUT_ANALYSIS_SCHEMA_VERSION = 1 as const;
export const SCENE_CUT_DETECTOR_VERSION = 'content-adaptive-160x90-v2' as const;
export const SCENE_CUT_ANALYSIS_WIDTH = 160 as const;
export const SCENE_CUT_ANALYSIS_HEIGHT = 90 as const;

export type SceneCutAnalysisStatus = 'none' | 'analyzing' | 'ready' | 'error';

export interface SceneCutPoint {
  /** Presentation timestamp of the first frame after the cut, in source seconds. */
  timestamp: number;
  /** Zero-based decoded presentation-frame index. */
  frameNumber: number;
  /** Combined detector score, normalized to 0-1. */
  score: number;
  /** Fraction of analysis pixels with a material luma or chroma change. */
  changedRatio: number;
  /** Mean per-pixel luma/chroma difference, normalized to 0-1. */
  meanPixelDifference: number;
  /** Global Y/Cb/Cr histogram distance, normalized to 0-1. */
  histogramDifference: number;
  /** Edge-change ratio after one-pixel motion tolerance, normalized to 0-1. */
  edgeChangeRatio: number;
  /** Best luma difference after compensating translations up to eight analysis pixels. */
  motionCompensatedDifference: number;
  /** Detector confidence, normalized to 0-1. */
  confidence: number;
}

export interface SceneCutAnalysis {
  schemaVersion: typeof SCENE_CUT_ANALYSIS_SCHEMA_VERSION;
  detectorVersion: typeof SCENE_CUT_DETECTOR_VERSION;
  analysisWidth: typeof SCENE_CUT_ANALYSIS_WIDTH;
  analysisHeight: typeof SCENE_CUT_ANALYSIS_HEIGHT;
  sourceFrameCount: number;
  expectedSourceFrameCount: number;
  duration: number;
  sourceFingerprint: {
    size: number;
    lastModified: number;
  };
  cuts: SceneCutPoint[];
  completedAt: number;
}
