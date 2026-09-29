import { lookAt, orthographic, perspective } from '../../scene/cameraUtils/projectionMatrices';
import type { SceneLightLayer } from '../../scene/types';
import { MAX_STRAND_LIGHTS } from './strandLights';

/** Resolution of a strand layer's light depth and deep opacity maps. */
export const STRAND_SHADOW_MAP_SIZE = 1024;
/** Shadow strength of the fixed key light used when no light clip exists. */
const KEY_SHADOW_STRENGTH = 0.8;

type Vector3 = [number, number, number];

/** The light a strand layer is shadowed from, seen as a camera. */
export interface StrandShadowView {
  /** Index of the casting light among the packed scene lights, or -1 for the key light. */
  lightIndex: number;
  view: Float32Array;
  projection: Float32Array;
  eye: Vector3;
  perspective: boolean;
  near: number;
  far: number;
  strength: number;
}

const upFor = (eye: Vector3, target: Vector3): Vector3 => {
  const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  return Math.abs(f[1]) > 0.95 * Math.hypot(f[0], f[1], f[2]) ? [0, 0, 1] : [0, 1, 0];
};
const cameraAt = (eye: Vector3, target: Vector3) => lookAt(...eye, ...target, ...upFor(eye, target));

/**
 * Picks the light that shadows a strand layer bounded by a sphere (`center`, `radius`) and frames
 * the sphere from it. Without light clips the fixed key light casts an orthographic shadow. With
 * light clips the point or panel light brightest at the center decides, using the same packing
 * order and falloff as `packStrandLights`; it casts only when its clip enables shadows.
 */
export function strandShadowView(lights: readonly SceneLightLayer[], keyLight: Vector3, center: Vector3, radius: number): StrandShadowView | null {
  radius = Math.max(radius, 1e-3);
  if (!lights.length) {
    const distance = radius * 3;
    const eye: Vector3 = [center[0] + keyLight[0] * distance, center[1] + keyLight[1] * distance, center[2] + keyLight[2] * distance];
    const near = distance - radius * 1.2, far = distance + radius * 1.2;
    return { lightIndex: -1, view: cameraAt(eye, center), projection: orthographic(-radius, radius, -radius, radius, near, far),
      eye, perspective: false, near, far, strength: KEY_SHADOW_STRENGTH };
  }
  let best: { index: number; light: SceneLightLayer; score: number } | undefined;
  let index = 0;
  for (const light of lights) {
    const settings = light.lightSettings;
    const intensity = settings.intensity * Math.max(0, Math.min(1, light.opacity ?? 1));
    if (settings.kind === 'environment' || index >= MAX_STRAND_LIGHTS || intensity <= 0) continue;
    const m = light.worldMatrix;
    const distance = Math.hypot(m[12] - center[0], m[13] - center[1], m[14] - center[2]);
    const score = intensity / (1 + (distance / Math.max(settings.diameter, 1e-3)) ** 2);
    if (!best || score > best.score) best = { index, light, score };
    index++;
  }
  if (!best?.light.lightSettings.castsShadows) return null;
  const m = best.light.worldMatrix, eye: Vector3 = [m[12], m[13], m[14]];
  const distance = Math.max(Math.hypot(eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]), 1e-3);
  const fov = 2 * Math.asin(Math.min(0.97, radius / distance)) * 1.05;
  const near = Math.max(distance - radius, distance * 0.02, 1e-3), far = distance + radius;
  return { lightIndex: best.index, view: cameraAt(eye, center), projection: perspective(fov, 1, near, far), eye,
    perspective: true, near, far, strength: Math.max(0, Math.min(1, best.light.lightSettings.shadowStrength)) };
}
