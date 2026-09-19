import type { Effect } from '../../types/effects';
import type { LandmarkFrame, LandmarkPoint, LandmarkSeries } from './types';

const TRACKING_EFFECTS = new Set([
  'subject', 'tracked-scene', 'hud-tracker', 'cctv',
  'kinetic-trace', 'rain-reveal', 'stardust', 'hand-particles',
]);

class LandmarkRuntime {
  private seriesByClip = new Map<string, LandmarkSeries>();
  private pointsByEffect = new Map<string, LandmarkPoint[]>();

  setSeries(series: LandmarkSeries): void {
    this.seriesByClip.set(series.clipId, series);
  }

  getSeries(clipId: string): LandmarkSeries | null {
    return this.seriesByClip.get(clipId) ?? null;
  }

  findFaceSeries(sourceId: string, from: number, to: number): LandmarkSeries | null {
    return [...this.seriesByClip.values()].find(series => series.sourceId === sourceId
      && series.faceTracking && series.faceTracking.sourceStart <= from + 1e-6
      && series.faceTracking.sourceEnd >= to - 0.001) ?? null;
  }

  getFrame(clipId: string, time: number): LandmarkFrame | null {
    const frames = this.seriesByClip.get(clipId)?.frames;
    if (!frames?.length) return null;
    let low = 0;
    let high = frames.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (frames[middle].time < time) low = middle + 1;
      else high = middle;
    }
    const after = frames[low];
    const before = frames[Math.max(0, low - 1)];
    return Math.abs(before.time - time) <= Math.abs(after.time - time) ? before : after;
  }

  setEffectPoints(effectId: string, points: LandmarkPoint[]): void {
    this.pointsByEffect.set(effectId, points);
  }

  getEffectPoints(effectId: string): LandmarkPoint[] {
    return this.pointsByEffect.get(effectId) ?? [];
  }
}

interface LandmarkHotData { runtime?: LandmarkRuntime }
const hotData = import.meta.hot?.data as LandmarkHotData | undefined;
export const landmarkRuntime = hotData?.runtime ?? new LandmarkRuntime();

function average(points: LandmarkPoint[]): { x: number; y: number; spread: number } {
  if (!points.length) return { x: 0.5, y: 0.5, spread: 0.15 };
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const spread = points.reduce((sum, point) => sum + Math.hypot(point.x - x, point.y - y), 0) / points.length;
  return { x, y, spread };
}

function pointsForEffect(effect: Effect, frame: LandmarkFrame): LandmarkPoint[] {
  if (effect.type === 'tracked-scene') return frame.faces.flat();
  if (effect.type === 'subject') {
    const posePoints = frame.poses.flat();
    return posePoints.length ? posePoints : frame.faces.flat();
  }
  if (effect.type !== 'hand-particles') return [...frame.faces.flat(), ...frame.poses.flat(), ...frame.hands.flat()];
  const hands = frame.hands;
  if (effect.params.source === 'centroid') return hands.map((hand) => average(hand)).map(({ x, y }) => ({ x, y, z: 0 }));
  if (effect.params.source === 'all') return hands.flat();
  return hands.flatMap((hand) => [4, 8, 12, 16, 20].map((index) => hand[index]).filter(Boolean));
}

function evenlySample(points: LandmarkPoint[], maximum: number): LandmarkPoint[] {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => points[Math.floor(index * points.length / maximum)]);
}

export function getLandmarkEffectPoints(effectId: string): LandmarkPoint[] {
  return landmarkRuntime.getEffectPoints(effectId);
}

export interface OpticalMotionSample {
  x: number;
  y: number;
}

export function decorateLandmarkEffects(
  clipId: string,
  time: number,
  effects: Effect[],
  opticalMotion?: OpticalMotionSample,
): Effect[] {
  const frame = landmarkRuntime.getFrame(clipId, time);
  const previous = frame ? landmarkRuntime.getFrame(clipId, Math.max(0, time - 1 / 15)) : null;
  return effects.map((effect) => {
    if (!TRACKING_EFFECTS.has(effect.type)) return effect;
    const points = frame ? pointsForEffect(effect, frame) : [];
    landmarkRuntime.setEffectPoints(effect.id, evenlySample(points, 64));
    const center = average(points);
    const previousCenter = average(previous && frame ? pointsForEffect(effect, previous) : points);
    const useOpticalFlow = effect.type === 'kinetic-trace' && opticalMotion;
    return {
      ...effect,
      params: {
        ...effect.params,
        trackingCenterX: center.x,
        trackingCenterY: center.y,
        trackingSpread: center.spread,
        trackingCount: points.length,
        trackingMotionX: useOpticalFlow ? opticalMotion.x : center.x - previousCenter.x,
        trackingMotionY: useOpticalFlow ? opticalMotion.y : center.y - previousCenter.y,
      },
    };
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: LandmarkHotData) => { data.runtime = landmarkRuntime; });
}
