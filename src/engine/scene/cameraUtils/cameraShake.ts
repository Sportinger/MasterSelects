import type { SceneCameraSettings } from '../../../stores/mediaStore/types';
import type { SceneCameraConfig } from '../types';
import { smoothNoise } from '../../../services/parameterSources/controlSignalMath';
import { addVector, crossVector, normalizeVector, rotateVectorAroundAxis, scaleVector, subtractVector } from './vectorMath';

/** Add motion after the complete orbit/pose solve; authored camera keys stay intact.
 * Pure clip-time sampling gives identical movement on seeks, previews and exports. */
export function applyCameraShake(camera: SceneCameraConfig, settings: SceneCameraSettings, time: number): SceneCameraConfig {
  const amount = settings.shakeAmount ?? 0;
  if (!(amount > 0) || !Number.isFinite(amount) || !Number.isFinite(time)) return camera;
  const strength = Math.min(20, amount);
  const frequency = Math.max(.1, Math.min(30, settings.shakeFrequency ?? 8));
  const seed = Math.round(settings.shakeSeed ?? 17);
  const sample = (axis: number) => smoothNoise(time * frequency, seed + axis * 1013, 2);
  const direction = subtractVector(camera.target, camera.position);
  const distance = Math.max(.001, Math.hypot(direction.x, direction.y, direction.z));
  const forward = normalizeVector(direction, { x: 0, y: 0, z: -1 });
  const right = normalizeVector(crossVector(forward, camera.up), { x: 1, y: 0, z: 0 });
  const up = normalizeVector(crossVector(right, forward), { x: 0, y: 1, z: 0 });
  const tilt = (vector: typeof direction) => rotateVectorAroundAxis(
    rotateVectorAroundAxis(vector, right, sample(0) * strength), up, sample(1) * strength);
  const shakenForward = tilt(forward);
  const shakenUp = rotateVectorAroundAxis(tilt(up), shakenForward, sample(2) * strength * .55);
  const translation = addVector(scaleVector(right, sample(3)), scaleVector(up, sample(4)));
  const position = addVector(camera.position, scaleVector(translation, distance * strength * Math.PI / 180 * .12));
  return { ...camera, position, target: addVector(position, scaleVector(shakenForward, distance)), up: shakenUp };
}
