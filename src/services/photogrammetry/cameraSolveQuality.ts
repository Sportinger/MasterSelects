export type CameraSolveSamplingPreset = 'fast' | 'balanced' | 'detailed' | 'maximum';
export type CameraSolveResolutionPreset = 'efficient' | 'balanced' | 'high' | 'full';

export interface CameraSolvePlan {
  frameCount: number;
  sourceImageMaxSide: number;
  featureImageMaxSide: number;
}

export interface CameraSolveSamplingOption {
  id: CameraSolveSamplingPreset;
  label: string;
  targetFrames: number;
}

export interface CameraSolveResolutionOption {
  id: CameraSolveResolutionPreset;
  label: string;
  sourceImageMaxSide: number;
  featureImageMaxSide: number;
}

const MAXIMUM_STABLE_SAMPLE_COUNT = 96;
const FULL_RESOLUTION_FEATURE_MAX_SIDE = 960;

export const CAMERA_SOLVE_SAMPLING_OPTIONS: CameraSolveSamplingOption[] = [
  { id: 'fast', label: 'Fast - 24', targetFrames: 24 },
  { id: 'balanced', label: 'Balanced - 48', targetFrames: 48 },
  { id: 'detailed', label: 'Detailed - 72', targetFrames: 72 },
  { id: 'maximum', label: 'Maximum stable - 96', targetFrames: MAXIMUM_STABLE_SAMPLE_COUNT },
];

export const CAMERA_SOLVE_RESOLUTION_OPTIONS: CameraSolveResolutionOption[] = [
  { id: 'efficient', label: 'Efficient - 512 / 960 px', sourceImageMaxSide: 960, featureImageMaxSide: 512 },
  { id: 'balanced', label: 'Balanced - 720 / 1600 px', sourceImageMaxSide: 1_600, featureImageMaxSide: 720 },
  { id: 'high', label: 'High - 960 / 1920 px', sourceImageMaxSide: 1_920, featureImageMaxSide: 960 },
  {
    id: 'full',
    label: 'Full source / 960 px solve',
    sourceImageMaxSide: 8_192,
    featureImageMaxSide: FULL_RESOLUTION_FEATURE_MAX_SIDE,
  },
];

export function planCameraSolve(
  sampling: CameraSolveSamplingPreset,
  resolution: CameraSolveResolutionPreset,
  sourceDuration: number,
  sourceFps = 30,
): CameraSolvePlan {
  const samplingOption = CAMERA_SOLVE_SAMPLING_OPTIONS.find((candidate) => candidate.id === sampling)
    ?? CAMERA_SOLVE_SAMPLING_OPTIONS[1];
  const resolutionOption = CAMERA_SOLVE_RESOLUTION_OPTIONS.find((candidate) => candidate.id === resolution)
    ?? CAMERA_SOLVE_RESOLUTION_OPTIONS[1];
  const availableFrames = Math.max(8, Math.round(
    Math.max(0.001, sourceDuration) * Math.max(1, sourceFps),
  ));
  const frameCount = Math.max(8, Math.min(samplingOption.targetFrames, availableFrames));
  return {
    frameCount,
    sourceImageMaxSide: resolutionOption.sourceImageMaxSide,
    featureImageMaxSide: resolutionOption.featureImageMaxSide,
  };
}
