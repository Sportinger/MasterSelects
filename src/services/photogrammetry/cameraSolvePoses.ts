import type { CameraSolveDataset } from './cameraSolvingContract';

export interface SolvedCameraPoseKey {
  sourceIndex: number;
  imageName: string;
  time: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface SolvedCameraPath {
  poses: SolvedCameraPoseKey[];
  focalLength: number;
  width: number;
  height: number;
  fovDegrees: number;
  duration: number;
}

type Matrix3 = [number, number, number, number, number, number, number, number, number];

function quaternionToRotation(w: number, x: number, y: number, z: number): Matrix3 {
  const length = Math.hypot(w, x, y, z) || 1;
  const qw = w / length;
  const qx = x / length;
  const qy = y / length;
  const qz = z / length;
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
}

function cameraCenter(rotation: Matrix3, translation: [number, number, number]) {
  return {
    x: -(rotation[0] * translation[0] + rotation[3] * translation[1] + rotation[6] * translation[2]),
    y: -(rotation[1] * translation[0] + rotation[4] * translation[1] + rotation[7] * translation[2]),
    z: -(rotation[2] * translation[0] + rotation[5] * translation[1] + rotation[8] * translation[2]),
  };
}

function editorEuler(rotation: Matrix3): { x: number; y: number; z: number } {
  const cameraToWorld: Matrix3 = [
    rotation[0], rotation[3], rotation[6],
    rotation[1], rotation[4], rotation[7],
    rotation[2], rotation[5], rotation[8],
  ];
  const basis: Matrix3 = [
    cameraToWorld[0], -cameraToWorld[1], -cameraToWorld[2],
    -cameraToWorld[3], cameraToWorld[4], cameraToWorld[5],
    -cameraToWorld[6], cameraToWorld[7], cameraToWorld[8],
  ];
  const pitch = Math.asin(Math.max(-1, Math.min(1, basis[5])));
  const cosPitch = Math.cos(pitch);
  const yaw = Math.abs(cosPitch) > 1e-6 ? Math.atan2(basis[2], basis[8]) : Math.atan2(-basis[6], basis[0]);
  const roll = Math.abs(cosPitch) > 1e-6 ? Math.atan2(basis[3], basis[4]) : 0;
  const radiansToDegrees = 180 / Math.PI;
  return { x: pitch * radiansToDegrees, y: yaw * radiansToDegrees, z: roll * radiansToDegrees };
}

function unwrapAngle(value: number, previous: number): number {
  let result = value;
  while (result - previous > 180) result -= 360;
  while (result - previous < -180) result += 360;
  return result;
}

function cleanScalar(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

function parseIntrinsics(text: string): { focal: number; width: number; height: number } {
  const line = text.split(/\r?\n/).map((entry) => entry.trim())
    .find((entry) => entry && !entry.startsWith('#'));
  const tokens = line?.split(/\s+/) ?? [];
  const width = Number(tokens[2]);
  const height = Number(tokens[3]);
  const focal = Number(tokens[4]);
  if (![width, height, focal].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('The solved camera intrinsics are invalid.');
  }
  return { focal, width, height };
}

function resolvePoseTime(dataset: CameraSolveDataset, sourceIndex: number, ordinal: number, total: number): number {
  const context = dataset.source;
  const sampled = context?.sampleTimes?.[sourceIndex];
  if (sampled !== undefined && Number.isFinite(sampled)) return sampled;
  const duration = Math.max(0.001, context?.clipDuration ?? 10);
  return total <= 1 ? 0 : (ordinal / (total - 1)) * duration;
}

export function parseSolvedCameraPath(dataset: CameraSolveDataset): SolvedCameraPath {
  const intrinsics = parseIntrinsics(dataset.model.camerasText);
  const lines = dataset.model.imagesText.split(/\r?\n/);
  const raw: Array<{
    imageId: number;
    name: string;
    rotation: Matrix3;
    translation: [number, number, number];
  }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length !== 10) continue;
    const values = tokens.slice(0, 9).map(Number);
    if (!values.every(Number.isFinite)) continue;
    raw.push({
      imageId: values[0],
      name: tokens[9],
      rotation: quaternionToRotation(values[1], values[2], values[3], values[4]),
      translation: [values[5], values[6], values[7]],
    });
  }
  raw.sort((a, b) => a.imageId - b.imageId);
  if (raw.length < 2) throw new Error('The solved dataset contains fewer than two camera poses.');

  let previousRotation = { x: 0, y: 0, z: 0 };
  const poses = raw.map((entry, ordinal) => {
    const sourceIndex = dataset.model.registeredSourceIndices[entry.imageId - 1] ?? ordinal;
    const center = cameraCenter(entry.rotation, entry.translation);
    const euler = editorEuler(entry.rotation);
    const rotation = ordinal === 0 ? euler : {
      x: unwrapAngle(euler.x, previousRotation.x),
      y: unwrapAngle(euler.y, previousRotation.y),
      z: unwrapAngle(euler.z, previousRotation.z),
    };
    previousRotation = rotation;
    return {
      sourceIndex,
      imageName: entry.name,
      time: resolvePoseTime(dataset, sourceIndex, ordinal, raw.length),
      position: { x: cleanScalar(center.x), y: cleanScalar(-center.y), z: cleanScalar(-center.z) },
      rotation: {
        x: cleanScalar(rotation.x),
        y: cleanScalar(rotation.y),
        z: cleanScalar(rotation.z),
      },
    };
  }).toSorted((a, b) => a.time - b.time);
  const duration = Math.max(dataset.source?.clipDuration ?? 10, poses.at(-1)?.time ?? 0.001);
  return {
    poses,
    focalLength: intrinsics.focal,
    width: intrinsics.width,
    height: intrinsics.height,
    fovDegrees: 2 * Math.atan(intrinsics.height / (2 * intrinsics.focal)) * 180 / Math.PI,
    duration,
  };
}
