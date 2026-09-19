export type BrushTrainingPreset = 'preview' | 'mobile' | 'balanced' | 'quality';

export type BrushTrainingPhase =
  | 'loading-runtime'
  | 'loading-dataset'
  | 'training'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface BrushTrainingSnapshot {
  phase: BrushTrainingPhase;
  iteration: number;
  totalIterations: number;
  splatCount: number;
  trainViews: number;
  evalViews: number;
  elapsedMs: number;
  psnr: number | null;
  ssim: number | null;
  warning: string | null;
}

export interface BrushDatasetEntry {
  path: string;
  file: File;
}

export interface BrushPresetConfig {
  totalIterations: number;
  refineEvery: number;
  growthStopIteration: number;
  growthGradientThreshold: number;
  growthSelectFraction: number;
  splitAtScreenSize: number;
  maxResolution: number;
  frameStride: number;
  maxFrames: number | null;
  maxSplats: number;
  cacheBytes: number;
  shDegree: number;
  meanNoiseWeight: number;
  ssimWeight: number;
}

export const BRUSH_PRESET_CONFIG: Record<BrushTrainingPreset, BrushPresetConfig> = {
  preview: {
    totalIterations: 500,
    refineEvery: 50,
    growthStopIteration: 400,
    growthGradientThreshold: 0.0025,
    growthSelectFraction: 0.2,
    splitAtScreenSize: 0.5,
    maxResolution: 720,
    frameStride: 4,
    maxFrames: 48,
    maxSplats: 40_000,
    cacheBytes: 256 * 1024 * 1024,
    shDegree: 0,
    meanNoiseWeight: 0,
    ssimWeight: 0,
  },
  mobile: {
    totalIterations: 1_200,
    refineEvery: 80,
    growthStopIteration: 960,
    growthGradientThreshold: 0.0025,
    growthSelectFraction: 0.2,
    splitAtScreenSize: 0.5,
    maxResolution: 720,
    frameStride: 3,
    maxFrames: 72,
    maxSplats: 60_000,
    cacheBytes: 192 * 1024 * 1024,
    shDegree: 0,
    meanNoiseWeight: 0,
    ssimWeight: 0.1,
  },
  balanced: {
    totalIterations: 3_000,
    refineEvery: 100,
    growthStopIteration: 2_400,
    growthGradientThreshold: 0.0025,
    growthSelectFraction: 0.25,
    splitAtScreenSize: 0.5,
    maxResolution: 960,
    frameStride: 2,
    maxFrames: 120,
    maxSplats: 100_000,
    cacheBytes: 512 * 1024 * 1024,
    shDegree: 0,
    meanNoiseWeight: 0,
    ssimWeight: 0.15,
  },
  quality: {
    totalIterations: 6_000,
    refineEvery: 150,
    growthStopIteration: 4_800,
    growthGradientThreshold: 0.0025,
    growthSelectFraction: 0.25,
    splitAtScreenSize: 0.5,
    maxResolution: 1_080,
    frameStride: 1,
    maxFrames: 180,
    maxSplats: 120_000,
    cacheBytes: 768 * 1024 * 1024,
    shDegree: 0,
    meanNoiseWeight: 0,
    ssimWeight: 0.2,
  },
};

export type BrushWorkerRequest =
  | {
      type: 'start';
      assetBaseUrl: string;
      entries: BrushDatasetEntry[];
      preset: BrushTrainingPreset;
    }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | { type: 'export-ply'; requestId: number };

export type BrushWorkerResponse =
  | { type: 'started' }
  | { type: 'snapshot'; snapshot: BrushTrainingSnapshot }
  | { type: 'finished' }
  | { type: 'export-ply'; requestId: number; bytes: ArrayBuffer }
  | { type: 'export-error'; requestId: number; message: string }
  | { type: 'error'; message: string };
