import {
  SCENE_CUT_ANALYSIS_HEIGHT,
  SCENE_CUT_ANALYSIS_SCHEMA_VERSION,
  SCENE_CUT_ANALYSIS_WIDTH,
  SCENE_CUT_DETECTOR_VERSION,
  type SceneCutAnalysis,
  type SceneCutPoint,
} from '../../types/sceneCutAnalysis';

const HISTOGRAM_BINS = 16;
const EDGE_THRESHOLD = 48;
const PIXEL_LUMA_THRESHOLD = 24;
const PIXEL_CHROMA_THRESHOLD = 28;
const HISTORY_WINDOW_SECONDS = 2;
const MIN_HISTORY_SCORES = 5;
// The absolute floor prevents low-amplitude noise from becoming a cut, while
// the rolling baseline below decides whether the current frame is exceptional.
// Requiring almost half the full frame to change misses shot/reverse-shot edits
// with a shared background and letterboxing, so the structural metrics provide
// the stronger guard instead.
const MIN_CUT_SCORE = 0.18;
const MIN_CHANGED_RATIO = 0.24;
const MIN_MEAN_DIFFERENCE = 0.05;
const MIN_GLOBAL_HISTOGRAM_DIFFERENCE = 0.065;
const MIN_EDGE_CHANGE_RATIO = 0.45;
const HIGH_UNSTRUCTURED_DIFFERENCE = 0.24;
const MIN_MOTION_COMPENSATED_DIFFERENCE = 0.075;
const MAX_TRANSLATION = 8;
const TRANSLATION_STEP = 2;
const TRANSLATION_SAMPLE_STEP = 4;

interface FrameFeatures {
  luma: Uint8Array;
  cb: Uint8Array;
  cr: Uint8Array;
  histogram: Uint32Array;
  edges: Uint8Array;
  edgeCount: number;
}

export interface SceneCutFrameMetrics {
  score: number;
  changedRatio: number;
  meanPixelDifference: number;
  histogramDifference: number;
  edgeChangeRatio: number;
  motionCompensatedDifference: number;
}

interface ScoreSample {
  timestamp: number;
  score: number;
}

interface PendingCut {
  before: FrameFeatures;
  point: SceneCutPoint;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function buildEdges(luma: Uint8Array, width: number, height: number): {
  edges: Uint8Array;
  edgeCount: number;
} {
  const edges = new Uint8Array(width * height);
  let edgeCount = 0;

  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const gradient =
        Math.abs(luma[index + 1] - luma[index - 1]) +
        Math.abs(luma[index + width] - luma[index - width]);
      if (gradient >= EDGE_THRESHOLD) {
        edges[index] = 1;
        edgeCount += 1;
      }
    }
  }

  return { edges, edgeCount };
}

function hasNearbyEdge(
  edges: Uint8Array,
  index: number,
  width: number,
): boolean {
  return edges[index] === 1 ||
    edges[index - 1] === 1 ||
    edges[index + 1] === 1 ||
    edges[index - width] === 1 ||
    edges[index + width] === 1 ||
    edges[index - width - 1] === 1 ||
    edges[index - width + 1] === 1 ||
    edges[index + width - 1] === 1 ||
    edges[index + width + 1] === 1;
}

function calculateEdgeChangeRatio(
  previous: FrameFeatures,
  current: FrameFeatures,
  width: number,
  height: number,
): number {
  if (previous.edgeCount === 0 && current.edgeCount === 0) return 0;

  let entering = 0;
  let exiting = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      if (current.edges[index] && !hasNearbyEdge(previous.edges, index, width)) {
        entering += 1;
      }
      if (previous.edges[index] && !hasNearbyEdge(current.edges, index, width)) {
        exiting += 1;
      }
    }
  }

  const enteringRatio = current.edgeCount > 0 ? entering / current.edgeCount : 0;
  const exitingRatio = previous.edgeCount > 0 ? exiting / previous.edgeCount : 0;
  return clamp01(Math.max(enteringRatio, exitingRatio));
}

function calculateMotionCompensatedDifference(
  previous: FrameFeatures,
  current: FrameFeatures,
  width: number,
  height: number,
): number {
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let offsetY = -MAX_TRANSLATION; offsetY <= MAX_TRANSLATION; offsetY += TRANSLATION_STEP) {
    const startY = Math.max(0, -offsetY);
    const endY = Math.min(height, height - offsetY);
    for (let offsetX = -MAX_TRANSLATION; offsetX <= MAX_TRANSLATION; offsetX += TRANSLATION_STEP) {
      const startX = Math.max(0, -offsetX);
      const endX = Math.min(width, width - offsetX);
      let difference = 0;
      let sampleCount = 0;

      for (let y = startY; y < endY; y += TRANSLATION_SAMPLE_STEP) {
        const previousRow = y * width;
        const currentRow = (y + offsetY) * width;
        for (let x = startX; x < endX; x += TRANSLATION_SAMPLE_STEP) {
          difference += Math.abs(
            previous.luma[previousRow + x] -
            current.luma[currentRow + x + offsetX],
          );
          sampleCount += 1;
        }
      }

      if (sampleCount > 0) {
        bestDifference = Math.min(bestDifference, difference / (sampleCount * 255));
      }
    }
  }

  return Number.isFinite(bestDifference) ? clamp01(bestDifference) : 1;
}

export function extractSceneCutFrameFeatures(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): FrameFeatures {
  const pixelCount = width * height;
  if (rgba.length < pixelCount * 4) {
    throw new Error('Scene-cut frame data is smaller than the declared dimensions.');
  }

  const luma = new Uint8Array(pixelCount);
  const cb = new Uint8Array(pixelCount);
  const cr = new Uint8Array(pixelCount);
  const histogram = new Uint32Array(HISTOGRAM_BINS * 3);

  for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    const y = Math.max(0, Math.min(255, Math.round(red * 0.299 + green * 0.587 + blue * 0.114)));
    const blueChroma = Math.max(0, Math.min(255, Math.round(128 - red * 0.168736 - green * 0.331264 + blue * 0.5)));
    const redChroma = Math.max(0, Math.min(255, Math.round(128 + red * 0.5 - green * 0.418688 - blue * 0.081312)));

    luma[pixel] = y;
    cb[pixel] = blueChroma;
    cr[pixel] = redChroma;
    histogram[Math.min(HISTOGRAM_BINS - 1, y >> 4)] += 1;
    histogram[HISTOGRAM_BINS + Math.min(HISTOGRAM_BINS - 1, blueChroma >> 4)] += 1;
    histogram[HISTOGRAM_BINS * 2 + Math.min(HISTOGRAM_BINS - 1, redChroma >> 4)] += 1;
  }

  const { edges, edgeCount } = buildEdges(luma, width, height);
  return { luma, cb, cr, histogram, edges, edgeCount };
}

export function compareSceneCutFrameFeatures(
  previous: FrameFeatures,
  current: FrameFeatures,
  width: number,
  height: number,
): SceneCutFrameMetrics {
  const pixelCount = width * height;
  let changedPixels = 0;
  let weightedDifference = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    const lumaDifference = Math.abs(current.luma[index] - previous.luma[index]);
    const cbDifference = Math.abs(current.cb[index] - previous.cb[index]);
    const crDifference = Math.abs(current.cr[index] - previous.cr[index]);
    weightedDifference += lumaDifference * 0.6 + cbDifference * 0.2 + crDifference * 0.2;
    if (
      lumaDifference >= PIXEL_LUMA_THRESHOLD ||
      cbDifference >= PIXEL_CHROMA_THRESHOLD ||
      crDifference >= PIXEL_CHROMA_THRESHOLD
    ) {
      changedPixels += 1;
    }
  }

  let histogramIntersection = 0;
  for (let index = 0; index < previous.histogram.length; index += 1) {
    histogramIntersection += Math.min(previous.histogram[index], current.histogram[index]);
  }

  const changedRatio = changedPixels / pixelCount;
  const meanPixelDifference = weightedDifference / (pixelCount * 255);
  const histogramDifference = 1 - histogramIntersection / (pixelCount * 3);
  const edgeChangeRatio = calculateEdgeChangeRatio(previous, current, width, height);
  const motionCompensatedDifference = calculateMotionCompensatedDifference(
    previous,
    current,
    width,
    height,
  );
  const score = clamp01(
    meanPixelDifference * 0.2 +
    histogramDifference * 0.25 +
    changedRatio * 0.15 +
    edgeChangeRatio * 0.2 +
    motionCompensatedDifference * 0.2,
  );

  return {
    score,
    changedRatio,
    meanPixelDifference,
    histogramDifference,
    edgeChangeRatio,
    motionCompensatedDifference,
  };
}

function isAbsoluteCutSignal(metrics: SceneCutFrameMetrics): boolean {
  const structuralSignal =
    metrics.histogramDifference >= MIN_GLOBAL_HISTOGRAM_DIFFERENCE ||
    (
      metrics.edgeChangeRatio >= MIN_EDGE_CHANGE_RATIO &&
      metrics.motionCompensatedDifference >= MIN_MOTION_COMPENSATED_DIFFERENCE
    ) ||
    (
      metrics.meanPixelDifference >= HIGH_UNSTRUCTURED_DIFFERENCE &&
      metrics.motionCompensatedDifference >= MIN_MOTION_COMPENSATED_DIFFERENCE
    );
  return metrics.score >= MIN_CUT_SCORE &&
    metrics.changedRatio >= MIN_CHANGED_RATIO &&
    metrics.meanPixelDifference >= MIN_MEAN_DIFFERENCE &&
    structuralSignal;
}

export class SceneCutDetector {
  private previous: FrameFeatures | null = null;
  private scoreHistory: ScoreSample[] = [];
  private pending: PendingCut | null = null;
  private cuts: SceneCutPoint[] = [];
  private sourceFrameCount = 0;
  private lastTimestamp = 0;
  private readonly width: number;
  private readonly height: number;

  constructor(
    width = SCENE_CUT_ANALYSIS_WIDTH,
    height = SCENE_CUT_ANALYSIS_HEIGHT,
  ) {
    this.width = width;
    this.height = height;
  }

  pushFrame(
    rgba: Uint8ClampedArray,
    timestamp: number,
    frameNumber = this.sourceFrameCount,
  ): void {
    const current = extractSceneCutFrameFeatures(rgba, this.width, this.height);
    const safeTimestamp = Number.isFinite(timestamp) ? Math.max(0, timestamp) : this.lastTimestamp;
    this.sourceFrameCount += 1;
    this.lastTimestamp = Math.max(this.lastTimestamp, safeTimestamp);

    if (!this.previous) {
      this.previous = current;
      return;
    }

    const metrics = compareSceneCutFrameFeatures(this.previous, current, this.width, this.height);
    let suppressCurrentCandidate = false;

    if (this.pending) {
      const returnMetrics = compareSceneCutFrameFeatures(
        this.pending.before,
        current,
        this.width,
        this.height,
      );
      const isolatedFlash =
        metrics.score >= MIN_CUT_SCORE &&
        returnMetrics.score < this.pending.point.score * 0.55 &&
        returnMetrics.meanPixelDifference < this.pending.point.meanPixelDifference * 0.6;
      if (isolatedFlash) {
        suppressCurrentCandidate = true;
      } else {
        this.cuts.push(this.pending.point);
      }
      this.pending = null;
    }

    this.pruneHistory(safeTimestamp);
    const threshold = this.getAdaptiveThreshold();
    if (
      !suppressCurrentCandidate &&
      isAbsoluteCutSignal(metrics) &&
      (
        this.scoreHistory.length < MIN_HISTORY_SCORES
          ? metrics.score >= 0.2
          : metrics.score >= threshold
      )
    ) {
      const confidence = clamp01(
        0.35 +
        Math.max(0, metrics.score - threshold) * 1.5 +
        metrics.changedRatio * 0.15 +
        metrics.edgeChangeRatio * 0.1,
      );
      this.pending = {
        before: this.previous,
        point: {
          timestamp: safeTimestamp,
          frameNumber,
          score: metrics.score,
          changedRatio: metrics.changedRatio,
          meanPixelDifference: metrics.meanPixelDifference,
          histogramDifference: metrics.histogramDifference,
          edgeChangeRatio: metrics.edgeChangeRatio,
          motionCompensatedDifference: metrics.motionCompensatedDifference,
          confidence,
        },
      };
    }

    this.scoreHistory.push({ timestamp: safeTimestamp, score: metrics.score });
    this.previous = current;
  }

  complete(
    duration = this.lastTimestamp,
    expectedSourceFrameCount = this.sourceFrameCount,
    sourceFingerprint = { size: 0, lastModified: 0 },
  ): SceneCutAnalysis {
    // A candidate needs one following frame to distinguish a real new shot
    // from a one-frame flash or corrupt final frame.
    this.pending = null;

    return {
      schemaVersion: SCENE_CUT_ANALYSIS_SCHEMA_VERSION,
      detectorVersion: SCENE_CUT_DETECTOR_VERSION,
      analysisWidth: SCENE_CUT_ANALYSIS_WIDTH,
      analysisHeight: SCENE_CUT_ANALYSIS_HEIGHT,
      sourceFrameCount: this.sourceFrameCount,
      expectedSourceFrameCount,
      duration: Math.max(0, Number.isFinite(duration) ? duration : this.lastTimestamp),
      sourceFingerprint,
      cuts: this.cuts.map((cut) => ({ ...cut })),
      completedAt: Date.now(),
    };
  }

  private pruneHistory(timestamp: number): void {
    const minimumTimestamp = timestamp - HISTORY_WINDOW_SECONDS;
    while (this.scoreHistory[0]?.timestamp < minimumTimestamp) {
      this.scoreHistory.shift();
    }
  }

  private getAdaptiveThreshold(): number {
    if (this.scoreHistory.length === 0) return MIN_CUT_SCORE;
    const scores = this.scoreHistory.map((sample) => sample.score);
    const baseline = median(scores);
    const deviation = median(scores.map((score) => Math.abs(score - baseline)));
    return Math.max(MIN_CUT_SCORE, baseline + Math.max(0.045, deviation * 4));
  }
}

export function isCurrentSceneCutAnalysis(
  analysis: SceneCutAnalysis | null | undefined,
  source?: Pick<File, 'size' | 'lastModified'> | null,
): analysis is SceneCutAnalysis {
  const current = analysis?.schemaVersion === SCENE_CUT_ANALYSIS_SCHEMA_VERSION &&
    analysis.detectorVersion === SCENE_CUT_DETECTOR_VERSION &&
    analysis.analysisWidth === SCENE_CUT_ANALYSIS_WIDTH &&
    analysis.analysisHeight === SCENE_CUT_ANALYSIS_HEIGHT &&
    Number.isFinite(analysis.sourceFrameCount) &&
    analysis.sourceFrameCount === analysis.expectedSourceFrameCount &&
    Boolean(analysis.sourceFingerprint) &&
    Array.isArray(analysis.cuts);
  if (!current || !source) return current;
  return analysis.sourceFingerprint.size === source.size &&
    analysis.sourceFingerprint.lastModified === source.lastModified;
}

export function getSceneCutCompletenessError(
  analysis: Pick<SceneCutAnalysis, 'sourceFrameCount'>,
  decode: {
    decodeErrors: number;
    expectedFrameCount: number;
    skippedSamplesBeforeFirstKeyframe: number;
  },
): string | null {
  if (decode.decodeErrors > 0 || decode.skippedSamplesBeforeFirstKeyframe > 0) {
    return 'Scene-cut scan was incomplete because one or more source frames could not be decoded.';
  }
  if (analysis.sourceFrameCount !== decode.expectedFrameCount) {
    return `Scene-cut scan decoded ${analysis.sourceFrameCount}/${decode.expectedFrameCount} source frames.`;
  }
  return null;
}
