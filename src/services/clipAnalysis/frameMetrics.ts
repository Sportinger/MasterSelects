// Clip analysis frame metrics
// Pure per-frame scoring math (CPU motion, sharpness, face count) used by
// the clip analyzer. Operates on ImageData only — no stores, DOM, or GPU.

import type { MotionResult } from '../../engine/analysis/opticalFlow/flowStatsMath';

/**
 * Analyze motion between two frames using grid-based analysis
 * Distinguishes between:
 * - Global motion: Camera movement, pans, scene cuts (whole frame changes uniformly)
 * - Local motion: Object movement (only parts of frame change)
 */
export function analyzeMotion(
  currentFrame: ImageData,
  previousFrame: ImageData | null
): MotionResult {
  if (!previousFrame) {
    return { total: 0, global: 0, local: 0, isSceneCut: false };
  }

  const { width, height, data: curr } = currentFrame;
  const prev = previousFrame.data;

  // Divide frame into a 4x4 grid (16 regions)
  const gridSize = 4;
  const regionWidth = Math.floor(width / gridSize);
  const regionHeight = Math.floor(height / gridSize);
  const regionMotion: number[] = [];

  // Calculate motion for each region
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      let regionDiff = 0;
      let regionPixels = 0;

      const startX = gx * regionWidth;
      const startY = gy * regionHeight;
      const endX = Math.min(startX + regionWidth, width);
      const endY = Math.min(startY + regionHeight, height);

      // Sample every 2nd pixel in each region for performance
      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
          const idx = (y * width + x) * 4;
          const currLum = curr[idx] * 0.299 + curr[idx + 1] * 0.587 + curr[idx + 2] * 0.114;
          const prevLum = prev[idx] * 0.299 + prev[idx + 1] * 0.587 + prev[idx + 2] * 0.114;
          regionDiff += Math.abs(currLum - prevLum);
          regionPixels++;
        }
      }

      // Normalize region motion to 0-1
      const normalizedRegion = regionPixels > 0 ? (regionDiff / regionPixels) / 255 : 0;
      regionMotion.push(Math.min(1, normalizedRegion * 5));
    }
  }

  // Calculate statistics across regions
  const avgMotion = regionMotion.reduce((a, b) => a + b, 0) / regionMotion.length;
  const motionVariance = regionMotion.reduce((acc, m) => acc + Math.pow(m - avgMotion, 2), 0) / regionMotion.length;
  const motionStdDev = Math.sqrt(motionVariance);

  // Determine motion type:
  // - Low variance + high motion = Global motion (camera/scene change)
  // - High variance = Local motion (objects moving)
  // Threshold: if std dev < 0.15 and avg motion > 0.1, it's mostly global

  const varianceThreshold = 0.15;
  const isUniform = motionStdDev < varianceThreshold;
  const sceneCutThreshold = 0.6;
  const isSceneCut = avgMotion > sceneCutThreshold;

  let globalMotion: number;
  let localMotion: number;

  if (isUniform) {
    // Uniform motion across frame = camera/global motion
    globalMotion = avgMotion;
    localMotion = 0;
  } else {
    // Non-uniform = mix of global and local
    // Global component is the minimum motion (background)
    const minRegionMotion = Math.min(...regionMotion);
    globalMotion = minRegionMotion;

    // Local component is the excess above the global baseline
    const maxRegionMotion = Math.max(...regionMotion);
    localMotion = maxRegionMotion - minRegionMotion;
  }

  // For scene cuts, mark as high global motion
  if (isSceneCut) {
    globalMotion = avgMotion;
    localMotion = 0;
  }

  return {
    total: avgMotion,
    global: Math.min(1, globalMotion),
    local: Math.min(1, localMotion),
    isSceneCut,
  };
}

/**
 * Analyze sharpness/focus using Laplacian variance
 * Returns 0-1 (blurry to sharp)
 */
export function analyzeSharpness(frame: ImageData): number {
  const { width, height, data } = frame;
  let variance = 0;
  let mean = 0;
  const values: number[] = [];

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = (y * width + x) * 4;
      const c = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;

      const t = data[((y - 1) * width + x) * 4] * 0.299 +
                data[((y - 1) * width + x) * 4 + 1] * 0.587 +
                data[((y - 1) * width + x) * 4 + 2] * 0.114;
      const b = data[((y + 1) * width + x) * 4] * 0.299 +
                data[((y + 1) * width + x) * 4 + 1] * 0.587 +
                data[((y + 1) * width + x) * 4 + 2] * 0.114;
      const l = data[(y * width + (x - 1)) * 4] * 0.299 +
                data[(y * width + (x - 1)) * 4 + 1] * 0.587 +
                data[(y * width + (x - 1)) * 4 + 2] * 0.114;
      const r = data[(y * width + (x + 1)) * 4] * 0.299 +
                data[(y * width + (x + 1)) * 4 + 1] * 0.587 +
                data[(y * width + (x + 1)) * 4 + 2] * 0.114;

      const lap = 4 * c - t - b - l - r;
      values.push(lap);
      mean += lap;
    }
  }

  mean /= values.length;
  for (const v of values) {
    variance += (v - mean) ** 2;
  }
  variance /= values.length;

  return Math.min(1, Math.sqrt(variance) / 50);
}

/**
 * Detect faces in a frame (placeholder - returns 0 for now)
 * TODO: Implement with TensorFlow.js face detection model
 */
export function detectFaceCount(_frame: ImageData): number {
  return 0;
}
