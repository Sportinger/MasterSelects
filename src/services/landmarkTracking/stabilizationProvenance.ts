import type { Keyframe, TimelineClip } from '../../types';

export const STABILIZATION_PROPERTIES = ['position.x', 'position.y', 'rotation.z'] as const;
export const isStabilizationProperty = (property: string) =>
  STABILIZATION_PROPERTIES.some(candidate => candidate === property);
export const isStabilizationKey = (key: Keyframe) =>
  key.id.startsWith('face-stabilize:') && isStabilizationProperty(key.property);

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

const curveData = (keys: readonly Keyframe[]) => keys
  .toSorted((a, b) => a.property.localeCompare(b.property) || a.time - b.time)
  .map(key => [key.property, key.time, key.value, key.easing, key.hold, key.rotationInterpolation, key.handleIn, key.handleOut]);

export function stabilizationCurveSignature(keys: readonly Keyframe[]): string {
  return fingerprint(curveData(keys.filter(key => isStabilizationProperty(key.property))));
}

export function stabilizationInputSignature(clip: TimelineClip, keys: readonly Keyframe[]): string {
  return fingerprint({
    sourceId: clip.source?.mediaFileId ?? clip.mediaFileId ?? clip.id,
    inPoint: clip.inPoint, outPoint: clip.outPoint, duration: clip.duration,
    speed: clip.speed ?? 1, reversed: clip.reversed ?? false, transform: clip.transform,
    // Generated position/rotation keys are outputs, not inputs to the next bake.
    curves: curveData(keys.filter(key => /^(speed$|scale\.|anchor\.)/.test(key.property))),
  });
}

export function stabilizationStatus(clip: TimelineClip, keys: readonly Keyframe[], trackingCreatedAt?: number): string {
  const bake = clip.nodeGraph?.stabilization?.bake;
  const hasKeys = keys.some(isStabilizationKey);
  if (!bake) return hasKeys ? 'Baked · settings not recorded' : 'Not baked';
  if (!keys.some(key => isStabilizationProperty(key.property))) return 'Baked keys removed';
  if (bake.inputSignature !== stabilizationInputSignature(clip, keys)
    || (trackingCreatedAt !== undefined && bake.trackingCreatedAt !== trackingCreatedAt)) return 'Rebake needed';
  if (bake.curveSignature !== stabilizationCurveSignature(keys)) return 'Baked curves edited';
  return 'Baked';
}
