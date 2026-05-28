import { SNAP_THRESHOLD_SECONDS } from '../../../stores/timeline/constants';

export interface ClipDragSnapResult {
  startTime: number;
  snapped: boolean;
  snapEdgeTime: number;
}

type PixelToTime = (pixel: number) => number;
type GetSnappedPosition = (
  clipId: string,
  desiredStartTime: number,
  trackId: string,
) => ClipDragSnapResult;

const MIN_SWEEP_SAMPLE_PX = 1;
const MAX_SWEEP_SAMPLE_PX = 4;
const MAX_SWEEP_SAMPLES = 48;

function getSweepSampleStepPx(pixelToTime: PixelToTime, referenceX: number): number {
  const secondsPerPixel = Math.abs(pixelToTime(referenceX + 1) - pixelToTime(referenceX));
  if (!Number.isFinite(secondsPerPixel) || secondsPerPixel <= 0) {
    return MAX_SWEEP_SAMPLE_PX;
  }

  const snapThresholdPx = SNAP_THRESHOLD_SECONDS / secondsPerPixel;
  return Math.max(MIN_SWEEP_SAMPLE_PX, Math.min(MAX_SWEEP_SAMPLE_PX, snapThresholdPx / 2));
}

export function findSweptClipSnap(params: {
  clipId: string;
  previousX: number;
  currentX: number;
  trackId: string;
  pixelToTime: PixelToTime;
  getSnappedPosition: GetSnappedPosition;
}): ClipDragSnapResult | null {
  const deltaX = params.currentX - params.previousX;
  if (!Number.isFinite(deltaX) || Math.abs(deltaX) < MIN_SWEEP_SAMPLE_PX) {
    return null;
  }

  const sampleStepPx = getSweepSampleStepPx(params.pixelToTime, params.currentX);
  const sampleCount = Math.min(MAX_SWEEP_SAMPLES, Math.ceil(Math.abs(deltaX) / sampleStepPx));
  let latestSnap: ClipDragSnapResult | null = null;

  for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex += 1) {
    const progress = sampleIndex / sampleCount;
    const sampleX = params.previousX + deltaX * progress;
    const sampleTime = Math.max(0, params.pixelToTime(sampleX));
    const snapResult = params.getSnappedPosition(params.clipId, sampleTime, params.trackId);
    if (snapResult.snapped) {
      latestSnap = snapResult;
    }
  }

  return latestSnap;
}
