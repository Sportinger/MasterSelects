// Optical flow statistics math
// Pure parsing, classification, and pyramid-plan helpers for the GPU
// optical flow analyzer. No GPU handles or device access live here.

// Motion analysis result
export interface MotionResult {
  total: number;       // Overall motion 0-1
  global: number;      // Camera/scene motion 0-1
  local: number;       // Object motion 0-1
  isSceneCut: boolean; // True if likely a scene cut
}

// Flow statistics from GPU
export interface FlowStats {
  meanMagnitude: number;
  magnitudeVariance: number;
  meanVx: number;
  meanVy: number;
  directionCoherence: number;
  coverageRatio: number;
  maxMagnitude: number;
}

// Analysis resolution (lower = faster, sufficient for statistics)
export const ANALYSIS_WIDTH = 160;
export const ANALYSIS_HEIGHT = 90;
export const PYRAMID_LEVELS = 3;

// Motion thresholds
export const MOTION_THRESHOLD = 0.5;        // Minimum flow magnitude to count as motion
const SCENE_CUT_THRESHOLD = 8.0;     // Flow magnitude indicating scene cut
const COHERENCE_THRESHOLD = 0.6;     // Direction coherence for global motion
const COVERAGE_THRESHOLD = 0.7;      // Coverage ratio for scene cut

/**
 * Parse the raw stats readback (fixed-point, scaled by 1000) into FlowStats.
 */
export function parseFlowStats(data: Uint32Array): FlowStats {
  // Parse fixed-point values (scaled by 1000)
  const sumMagnitude = data[0] / 1000;
  const sumMagnitudeSq = data[1] / 1000;
  const sumVx = new Int32Array([data[2]])[0] / 1000;
  const sumVy = new Int32Array([data[3]])[0] / 1000;
  const pixelCount = data[4];
  const significantPixels = data[5];
  const maxMagnitude = data[6] / 1000;

  // Direction histogram (8 bins)
  const directionHist: number[] = [];
  for (let i = 0; i < 8; i++) {
    directionHist.push(data[7 + i]);
  }

  if (pixelCount === 0) {
    return {
      meanMagnitude: 0,
      magnitudeVariance: 0,
      meanVx: 0,
      meanVy: 0,
      directionCoherence: 0,
      coverageRatio: 0,
      maxMagnitude: 0,
    };
  }

  const meanMagnitude = sumMagnitude / pixelCount;
  const meanMagnitudeSq = sumMagnitudeSq / pixelCount;
  const magnitudeVariance = meanMagnitudeSq - meanMagnitude * meanMagnitude;

  const meanVxNorm = sumVx / pixelCount;
  const meanVyNorm = sumVy / pixelCount;

  // Direction coherence: how aligned are the flow vectors?
  // If all vectors point same direction, mean vector magnitude ≈ mean of magnitudes
  const meanVectorMagnitude = Math.sqrt(meanVxNorm * meanVxNorm + meanVyNorm * meanVyNorm);
  const directionCoherence = meanMagnitude > 0.01 ? meanVectorMagnitude / meanMagnitude : 0;

  // Coverage: fraction of pixels with significant motion
  const totalPixels = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
  const coverageRatio = significantPixels / totalPixels;

  return {
    meanMagnitude,
    magnitudeVariance,
    meanVx: meanVxNorm,
    meanVy: meanVyNorm,
    directionCoherence: Math.min(1, directionCoherence),
    coverageRatio,
    maxMagnitude,
  };
}

/**
 * Classify parsed flow statistics into total/global/local motion and scene cuts.
 */
export function classifyMotion(stats: FlowStats): MotionResult {
  // Normalize motion magnitude (typical range 0-20 pixels/frame → 0-1)
  const normalizedMean = Math.min(1, stats.meanMagnitude / 10);

  // Scene cut detection: sudden high motion across most of the frame
  const isSceneCut = stats.meanMagnitude > SCENE_CUT_THRESHOLD &&
                     stats.coverageRatio > COVERAGE_THRESHOLD;

  // Global vs local motion classification
  // High coherence = vectors aligned = camera/global motion
  // Low coherence = vectors in different directions = local/object motion
  const coherence = stats.directionCoherence;

  let globalMotion: number;
  let localMotion: number;

  if (isSceneCut) {
    // Scene cuts are global motion
    globalMotion = normalizedMean;
    localMotion = 0;
  } else if (coherence > COHERENCE_THRESHOLD) {
    // High coherence = mostly global motion
    globalMotion = normalizedMean * coherence;
    localMotion = normalizedMean * (1 - coherence);
  } else {
    // Low coherence = mostly local motion
    // Use variance to estimate local motion intensity
    const varianceNorm = Math.min(1, Math.sqrt(stats.magnitudeVariance) / 5);
    globalMotion = normalizedMean * coherence;
    localMotion = Math.max(normalizedMean * (1 - coherence), varianceNorm);
  }

  return {
    total: normalizedMean,
    global: Math.min(1, globalMotion),
    local: Math.min(1, localMotion),
    isSceneCut,
  };
}

/**
 * Dimensions of a pyramid level derived from the analysis resolution.
 */
export function getPyramidDimensions(level: number): { w: number; h: number } {
  let w = ANALYSIS_WIDTH;
  let h = ANALYSIS_HEIGHT;
  for (let i = 0; i < level; i++) {
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  return { w, h };
}
