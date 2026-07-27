import { FACE_ANALYSIS_MODEL_VERSION } from '../faceAnalysis/modelCatalog';
import type { FrameAnalysisData } from '../../types/clipMetadata';

export interface SourceAnalysisRange {
  start: number;
  end: number;
}

export interface ScheduledAnalysisSample {
  time: number;
  metrics: boolean;
  faces: boolean;
}

export function positiveSampleInterval(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveSourceAnalysisRange(
  requested: SourceAnalysisRange | undefined,
  fallbackStart: number,
  fallbackEnd: number,
): [number, number] {
  if (!requested) return [fallbackStart, fallbackEnd];
  if (!Number.isFinite(requested.start) || !Number.isFinite(requested.end)
    || requested.end <= requested.start) {
    throw new RangeError('Analysis source range must have a finite positive duration.');
  }
  return [requested.start, requested.end];
}

export function createAnalysisSampleSchedule(
  start: number,
  end: number,
  metricIntervalMs: number | undefined,
  faceIntervalMs: number | undefined,
): ScheduledAnalysisSample[] {
  const samples = new Map<number, ScheduledAnalysisSample>();
  const add = (intervalMs: number, key: 'metrics' | 'faces') => {
    for (let time = start; time < end; time += intervalMs / 1000) {
      const rounded = Math.round(time * 1_000_000) / 1_000_000;
      const entry = samples.get(rounded) ?? { time: rounded, metrics: false, faces: false };
      entry[key] = true;
      samples.set(rounded, entry);
    }
  };
  if (metricIntervalMs) add(metricIntervalMs, 'metrics');
  if (faceIntervalMs) add(faceIntervalMs, 'faces');
  return [...samples.values()].toSorted((left, right) => left.time - right.time);
}

export function cachedFaceCadenceIsCompatible(
  frames: readonly FrameAnalysisData[],
  requestedIntervalMs: number,
): boolean {
  const faceTimes = frames
    .filter((frame) => frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION)
    .map((frame) => frame.timestamp)
    .toSorted((left, right) => left - right);
  if (faceTimes.length === 0) return false;
  const allowedGap = requestedIntervalMs / 1000 * 1.05;
  return faceTimes.slice(1).every((time, index) => time - faceTimes[index] <= allowedGap);
}
