import type { OrbitCameraFrame } from '../../gaussian/core/SplatCameraUtils';
import type { Keyframe } from '../../../types/keyframes';
import type { SceneVector3 } from '../types';
import { addVector, dotVector, lerpVector, scaleVector, subtractVector } from './vectorMath';
import { Logger } from '../../../services/logger';

const warnedSegments = new Set<string>();
const log = Logger.create('CameraOrbit');
export function warnMissingOrbitPivot(clipId: string, start: number, end: number): void {
  const key = `${clipId}:${start}:${end}`;
  if (warnedSegments.has(key)) return;
  warnedSegments.add(key);
  if (warnedSegments.size > 64) warnedSegments.delete(warnedSegments.values().next().value!);
  log.warn('Continuous camera move has no recoverable orbit pivot; using keyed positions. Record the second pose with Preview Orbit.', { clipId, start, end });
}

const finitePivot = (p: SceneVector3 | undefined): p is SceneVector3 => !!p && [p.x, p.y, p.z].every(Number.isFinite);

/** The arriving pose records the pivot of the gesture leading to it, independently of path mode. */
export function recordedOrbitPivot(keys: readonly Keyframe[], endTime: number): SceneVector3 | undefined {
  return keys.find(key => Math.abs(key.time - endTime) < 1e-6
    && (key.property.startsWith('position.') || key.property.startsWith('rotation.')) && finitePivot(key.cameraOrbitPivot))?.cameraOrbitPivot;
}

/** Recover older, unrecorded look-at orbits only when the two forward rays share a target. */
export function inferOrbitPivot(a: OrbitCameraFrame, b: OrbitCameraFrame): SceneVector3 | undefined {
  const delta = subtractVector(a.eye, b.eye), cosine = dotVector(a.forward, b.forward);
  const denominator = 1 - cosine * cosine;
  if (denominator > 1e-8) {
    const da = dotVector(a.forward, delta), db = dotVector(b.forward, delta);
    const ta = (cosine * db - da) / denominator, tb = (db - cosine * da) / denominator;
    const pa = addVector(a.eye, scaleVector(a.forward, ta)), pb = addVector(b.eye, scaleVector(b.forward, tb));
    const gap = subtractVector(pa, pb);
    if (ta > 1e-6 && tb > 1e-6 && Math.hypot(gap.x, gap.y, gap.z) < 1e-5 * Math.max(1, ta, tb)) return lerpVector(pa, pb, .5);
  }
  // Preserve old origin-centred full turns and opposite endpoints (parallel forward rays).
  if ([a, b].every(frame => {
    const p = frame.eye, r = Math.hypot(p.x, p.y, p.z);
    return r > 1e-6 && dotVector(scaleVector(p, 1 / r), frame.forward) < -.999;
  })) return { x: 0, y: 0, z: 0 };
  return undefined;
}

/** Rotate local eye offsets around a fixed world pivot, preserving off-axis framing and roll. */
export function interpolateOrbitEye(a: OrbitCameraFrame, b: OrbitCameraFrame, current: OrbitCameraFrame,
  pivot: SceneVector3, t: number): SceneVector3 {
  const local = (frame: OrbitCameraFrame) => {
    const offset = subtractVector(frame.eye, pivot);
    return { x: dotVector(offset, frame.right), y: dotVector(offset, frame.cameraUp), z: -dotVector(offset, frame.forward) };
  };
  const offset = lerpVector(local(a), local(b), t);
  return addVector(pivot, addVector(scaleVector(current.right, offset.x),
    addVector(scaleVector(current.cameraUp, offset.y), scaleVector(current.forward, -offset.z))));
}
