import type { SceneCamera } from '../../../scene/types';
import { cameraPositionFromView } from '../../passes/StrandPass';
import { DEFAULT_CAMERA_LENS } from '../contracts/ptTypes';
import { PT_FRAME, ptOffset } from '../contracts/ptLayouts';

/** Lanes of PtFrame (PtCommon.wgsl) the runtime fills each dispatch. */
export interface PtFrameValues {
  camera: SceneCamera;
  previousCamera: SceneCamera | null;
  renderSize: { width: number; height: number };
  outputSize: { width: number; height: number };
  jitter: [number, number];
  shutter: [number, number];
  frameIndex: number;
  sampleOffset: number;
  samples: number;
  mode: number;
  maxBounces: number;
  lightCount: number;
  nodePage1Start: number;
  fiberPage1Start: number;
  tlasRoot: number;
  instanceCount: number;
  debugView: number;
  seed: number;
  environmentIndex: number;
  environmentSize: [number, number];
  clampIndirect: number;
  /** Normalized render region (x0, y0, x1, y1). */
  region: [number, number, number, number];
  /** Adaptive sampling: a pixel stops once its relative error is below this (0: off). */
  adaptiveThreshold?: number;
}

/** Samples a pixel takes before adaptive sampling may stop it. */
export const PT_ADAPTIVE_MIN_SAMPLES = 16;

export function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = sum;
  }
  return out;
}

/** General 4x4 inverse (column-major); identity when singular. */
export function invertMat4(m: Float32Array): Float32Array {
  const inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  return Float32Array.from(inv, value => value / det);
}

/**
 * Thin lens radius in scene units: focal length from the vertical field of view on a full-frame
 * sensor (24 mm high), taken as millimeters of a 1 m scene unit, divided by twice the f-number.
 */
export function ptLensRadius(camera: SceneCamera): number {
  const fStop = camera.lens?.fStop ?? DEFAULT_CAMERA_LENS.fStop;
  if (fStop <= 0 || camera.projection === 'orthographic') return 0;
  const focalMm = 12 / Math.tan((camera.fov * Math.PI / 180) / 2);
  return focalMm / 1000 / (2 * fStop);
}

export function ptFocusDistance(camera: SceneCamera): number {
  const focus = camera.lens?.focusDistance ?? 0;
  if (focus > 0) return focus;
  const p = camera.cameraPosition, t = camera.cameraTarget;
  return Math.max(1e-3, Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z));
}

/** Packs PtFrame; the returned buffer mirrors PT_FRAME (checked by ptLayouts.test.ts). */
export function writePtFrame(values: PtFrameValues): ArrayBuffer {
  const buffer = new ArrayBuffer(PT_FRAME.size), f = new Float32Array(buffer), u = new Uint32Array(buffer);
  const at = (name: string) => ptOffset(PT_FRAME, name) / 4;
  const { camera } = values, v = camera.viewMatrix, p = camera.projectionMatrix;
  const viewProjection = multiplyMat4(p, v);
  f.set(viewProjection, at('viewProjection'));
  f.set(invertMat4(viewProjection), at('inverseViewProjection'));
  const previous = values.previousCamera ?? camera;
  f.set(multiplyMat4(previous.projectionMatrix, previous.viewMatrix), at('previousViewProjection'));
  const eye = cameraPositionFromView(v), orthographic = camera.projection === 'orthographic';
  f.set([...eye, orthographic ? 1 : 0], at('cameraPosition'));
  f.set([v[0], v[4], v[8], 1 / Math.abs(p[0] || 1)], at('cameraRight'));
  f.set([v[1], v[5], v[9], 1 / Math.abs(p[5] || 1)], at('cameraUp'));
  f.set([-v[2], -v[6], -v[10], camera.near], at('cameraForward'));
  f.set([ptLensRadius(camera), ptFocusDistance(camera), 2 ** (camera.lens?.exposure ?? 0), 0], at('lens'));
  f.set([values.renderSize.width, values.renderSize.height, values.outputSize.width, values.outputSize.height], at('size'));
  f.set([...values.jitter, ...values.shutter], at('jitterTime'));
  u.set([values.frameIndex >>> 0, values.sampleOffset >>> 0, values.samples >>> 0, values.mode >>> 0], at('counters'));
  u.set([values.maxBounces, values.lightCount, values.nodePage1Start, values.fiberPage1Start], at('limits'));
  u.set([values.tlasRoot, values.instanceCount, values.debugView, values.seed >>> 0], at('scene'));
  f.set([values.environmentIndex, ...values.environmentSize, values.clampIndirect], at('environment'));
  f.set(values.region, at('region'));
  const previousEye = cameraPositionFromView(previous.viewMatrix);
  f.set([...previousEye, values.previousCamera ? 1 : 0], at('previousCamera'));
  f.set([values.adaptiveThreshold ?? 0, PT_ADAPTIVE_MIN_SAMPLES, 0, 0], at('sampling'));
  return buffer;
}
