import type { Viewport } from './canvasGeometry';

/**
 * Critically damped camera for fold sequences. Each fold step only moves the
 * target; velocity carries over, so the camera glides through all steps and
 * settles once at the end instead of easing to a stop per group. State lives in
 * world space (view centre, log zoom) so zooming never swerves sideways.
 */
export interface CameraSpring { x: number; y: number; z: number; vx: number; vy: number; vz: number; target: { x: number; y: number; z: number } }

// Soft on purpose: a growing graph should be followed calmly (settles in ~0.8 s).
const OMEGA = 6;

export function cameraWorld(view: Viewport, width: number, height: number) {
  return { x: (width / 2 - view.panX) / view.zoom, y: (height / 2 - view.panY) / view.zoom, z: Math.log(view.zoom) };
}

export function cameraViewport(state: { x: number; y: number; z: number }, width: number, height: number): Viewport {
  const zoom = Math.exp(state.z);
  return { zoom, panX: width / 2 - state.x * zoom, panY: height / 2 - state.y * zoom };
}

export function createCameraSpring(from: Viewport, to: Viewport, width: number, height: number): CameraSpring {
  const start = cameraWorld(from, width, height);
  return { ...start, vx: 0, vy: 0, vz: 0, target: cameraWorld(to, width, height) };
}

/** Advances the spring; returns true once it rests on its target. */
export function stepCameraSpring(spring: CameraSpring, seconds: number): boolean {
  const dt = Math.min(0.05, Math.max(0, seconds));
  for (const [axis, velocity] of [['x', 'vx'], ['y', 'vy'], ['z', 'vz']] as const) {
    const acceleration = OMEGA * OMEGA * (spring.target[axis] - spring[axis]) - 2 * OMEGA * spring[velocity];
    spring[velocity] += acceleration * dt;
    spring[axis] += spring[velocity] * dt;
  }
  // Rest when every axis is within a fraction of a screen pixel of its target.
  const zoom = Math.exp(spring.z);
  const settled = Math.abs(spring.target.x - spring.x) * zoom < 0.3 && Math.abs(spring.target.y - spring.y) * zoom < 0.3
    && Math.abs(spring.target.z - spring.z) < 0.0005
    && Math.abs(spring.vx) * zoom < 2 && Math.abs(spring.vy) * zoom < 2 && Math.abs(spring.vz) < 0.01;
  if (settled) Object.assign(spring, spring.target, { vx: 0, vy: 0, vz: 0 });
  return settled;
}
