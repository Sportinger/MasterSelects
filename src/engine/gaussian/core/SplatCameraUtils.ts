// Camera utilities for gaussian splat rendering.
// Builds view and projection matrices from layer transform properties.

import type { SplatCameraParams } from './GaussianSplatGpuRenderer';

/**
 * Build view + projection matrices from a layer's transform properties.
 *
 * Mapping:
 *  - position.z  -> camera distance from origin (default 5)
 *  - position.x/y -> pan in camera screen space (-1..1 roughly equals full viewport)
 *  - rotation    -> orbit angles in degrees (x = pitch, y = yaw). Accepts number (yaw only) or {x,y,z}.
 *  - scale.x     -> zoom multiplier (dollies camera distance)
 *  - settings.nearPlane / farPlane  -> clipping planes
 */
export function buildSplatCamera(
  layer: {
    position: { x: number; y: number; z: number };
    scale: { x: number; y: number; z?: number };
    rotation: number | { x: number; y: number; z: number };
  },
  settings: { nearPlane: number; farPlane: number },
  viewport: { width: number; height: number },
  sceneBounds?: {
    min: [number, number, number];
    max: [number, number, number];
  },
): SplatCameraParams {
  const DEG_TO_RAD = Math.PI / 180;

  // Extract orbit angles
  let pitch = 0;
  let yaw = 0;
  let roll = 0;
  if (typeof layer.rotation === 'number') {
    yaw = layer.rotation * DEG_TO_RAD;
  } else {
    pitch = layer.rotation.x * DEG_TO_RAD;
    yaw = layer.rotation.y * DEG_TO_RAD;
    roll = layer.rotation.z * DEG_TO_RAD;
  }

  const centerX = sceneBounds ? (sceneBounds.min[0] + sceneBounds.max[0]) * 0.5 : 0;
  const centerY = sceneBounds ? (sceneBounds.min[1] + sceneBounds.max[1]) * 0.5 : 0;
  const centerZ = sceneBounds ? (sceneBounds.min[2] + sceneBounds.max[2]) * 0.5 : 0;
  const extentX = sceneBounds ? sceneBounds.max[0] - sceneBounds.min[0] : 0;
  const extentY = sceneBounds ? sceneBounds.max[1] - sceneBounds.min[1] : 0;
  const extentZ = sceneBounds ? sceneBounds.max[2] - sceneBounds.min[2] : 0;
  const sceneRadius = Math.max(
    0.001,
    Math.sqrt(extentX * extentX + extentY * extentY + extentZ * extentZ) * 0.5,
  );

  // Default camera distance frames the scene bounds when available.
  const defaultDistance = Math.max(sceneRadius * 2.5, 5);
  const baseDistance = layer.position.z !== 0 ? Math.abs(layer.position.z) : defaultDistance;

  // Zoom from scale.x (default 1). Higher zoom moves the camera closer,
  // lower zoom moves it farther away without introducing extreme fisheye FOV.
  const zoom = Math.max(0.01, layer.scale.x || 1);
  const distance = baseDistance / zoom;

  // Keep a stable field of view; "zoom" is handled as a dolly.
  const fov = 60 * (Math.PI / 180);

  const near = settings.nearPlane;
  const far = settings.farPlane;
  const aspect = viewport.width / Math.max(1, viewport.height);
  const halfHeight = Math.tan(fov * 0.5) * distance;
  const halfWidth = halfHeight * aspect;

  const eyeOffset = rotateOrbitVector(0, 0, distance, pitch, yaw, roll);
  const upVector = normalize(rotateOrbitVector(0, 1, 0, pitch, yaw, roll));
  const forwardVector = normalize(eyeOffset);
  const rightVector = normalize(cross(upVector, forwardVector));
  const cameraUpVector = normalize(cross(forwardVector, rightVector));
  const panWorldX = layer.position.x * halfWidth;
  const panWorldY = layer.position.y * halfHeight;
  const targetX = centerX + rightVector[0] * panWorldX + cameraUpVector[0] * panWorldY;
  const targetY = centerY + rightVector[1] * panWorldX + cameraUpVector[1] * panWorldY;
  const targetZ = centerZ + rightVector[2] * panWorldX + cameraUpVector[2] * panWorldY;
  const eyeX = targetX + eyeOffset[0];
  const eyeY = targetY + eyeOffset[1];
  const eyeZ = targetZ + eyeOffset[2];

  // Build view matrix (lookAt)
  const viewMatrix = lookAt(
    eyeX, eyeY, eyeZ,
    targetX, targetY, targetZ,
    cameraUpVector[0], cameraUpVector[1], cameraUpVector[2],
  );

  // Build projection matrix
  const projectionMatrix = perspective(fov, aspect, near, far);

  return {
    viewMatrix,
    projectionMatrix,
    viewport,
    fov,
    near,
    far,
  };
}

function rotateOrbitVector(
  x: number,
  y: number,
  z: number,
  pitch: number,
  yaw: number,
  roll: number,
): [number, number, number] {
  // Roll around local Z.
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const rollX = x * cosRoll - y * sinRoll;
  const rollY = x * sinRoll + y * cosRoll;
  const rollZ = z;

  // Pitch uses the existing "positive pitch moves camera upward" convention,
  // which corresponds to rotating the orbit basis by -pitch around X.
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const pitchX = rollX;
  const pitchY = rollY * cosPitch + rollZ * sinPitch;
  const pitchZ = -rollY * sinPitch + rollZ * cosPitch;

  // Yaw around world Y.
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const yawX = pitchX * cosYaw + pitchZ * sinYaw;
  const yawY = pitchY;
  const yawZ = -pitchX * sinYaw + pitchZ * cosYaw;

  return [yawX, yawY, yawZ];
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len <= 1e-8) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Build a column-major 4x4 lookAt view matrix.
 */
function lookAt(
  eyeX: number, eyeY: number, eyeZ: number,
  targetX: number, targetY: number, targetZ: number,
  upX: number, upY: number, upZ: number,
): Float32Array {
  // Forward (from target to eye)
  let fX = eyeX - targetX;
  let fY = eyeY - targetY;
  let fZ = eyeZ - targetZ;
  let len = Math.sqrt(fX * fX + fY * fY + fZ * fZ);
  if (len > 0) { fX /= len; fY /= len; fZ /= len; }

  // Right = up x forward
  let rX = upY * fZ - upZ * fY;
  let rY = upZ * fX - upX * fZ;
  let rZ = upX * fY - upY * fX;
  len = Math.sqrt(rX * rX + rY * rY + rZ * rZ);
  if (len > 0) { rX /= len; rY /= len; rZ /= len; }

  // True up = forward x right
  const uX = fY * rZ - fZ * rY;
  const uY = fZ * rX - fX * rZ;
  const uZ = fX * rY - fY * rX;

  // Column-major 4x4
  const m = new Float32Array(16);
  m[0]  = rX;   m[1]  = uX;   m[2]  = fX;   m[3]  = 0;
  m[4]  = rY;   m[5]  = uY;   m[6]  = fY;   m[7]  = 0;
  m[8]  = rZ;   m[9]  = uZ;   m[10] = fZ;   m[11] = 0;
  m[12] = -(rX * eyeX + rY * eyeY + rZ * eyeZ);
  m[13] = -(uX * eyeX + uY * eyeY + uZ * eyeZ);
  m[14] = -(fX * eyeX + fY * eyeY + fZ * eyeZ);
  m[15] = 1;

  return m;
}

/**
 * Build a column-major 4x4 perspective projection matrix.
 */
function perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1.0 / Math.tan(fovY * 0.5);
  const rangeInv = 1.0 / (near - far);

  const m = new Float32Array(16);
  m[0]  = f / aspect;
  m[1]  = 0;
  m[2]  = 0;
  m[3]  = 0;

  m[4]  = 0;
  m[5]  = f;
  m[6]  = 0;
  m[7]  = 0;

  m[8]  = 0;
  m[9]  = 0;
  m[10] = far * rangeInv;
  m[11] = -1;

  m[12] = 0;
  m[13] = 0;
  m[14] = near * far * rangeInv;
  m[15] = 0;

  return m;
}
