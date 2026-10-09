import type { Keyframe } from '../types/keyframes';

type Pivot = NonNullable<Keyframe['cameraOrbitPivot']>;
// One pending manual pose per camera. Durable orbit data belongs to its endpoint keyframes.
const captures = new Map<string, { time: number; pivot?: Pivot }>();

export function captureCameraOrbit(clipId: string, time: number, pivot?: Pivot): void {
  captures.delete(clipId);
  captures.set(clipId, { time, pivot: pivot && { ...pivot } });
  while (captures.size > 64) captures.delete(captures.keys().next().value!);
}

/** Undefined means no gesture at this time; an empty pivot explicitly clears an earlier orbit. */
export function cameraOrbitKeyframeFields(clipId: string, time: number): Pick<Keyframe, 'cameraOrbitPivot'> | undefined {
  const capture = captures.get(clipId);
  if (!capture || Math.abs(capture.time - time) > 1e-6) return undefined;
  return { cameraOrbitPivot: capture.pivot && { ...capture.pivot } };
}
