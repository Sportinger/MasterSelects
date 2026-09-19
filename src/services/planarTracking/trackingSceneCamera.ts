import type { SceneCameraSettings } from '../../stores/mediaStore/types';
import type { Keyframe } from '../../types/keyframes';
import type { TerrainCamera, TerrainIntrinsics, TerrainReconstruction } from '../../types/terrainTracking';
import type { TimelineClip } from '../../types/timeline';
import { surfaceSourceTime } from './surfaceEffects';
import type { TrackingSceneBounds } from './trackingSceneGeometry';

export interface TrackingSceneCameraPose {
  sourceTime: number;
  time: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface TrackingSceneCameraSegment {
  startTime: number;
  duration: number;
  poses: TrackingSceneCameraPose[];
}

export interface TrackingSceneCameraPlan {
  duration: number;
  frameRate: number;
  settings: SceneCameraSettings;
  segments: TrackingSceneCameraSegment[];
  calibration: TrackingSceneCalibrationAssessment;
}

export interface TrackingSceneCalibrationAssessment {
  exactSupported: boolean;
  maxPixelError: number;
  reason: string;
  reasons: string[];
}

export class UnsupportedTrackingSceneCalibrationError extends Error {
  readonly assessment: TrackingSceneCalibrationAssessment;

  constructor(assessment: TrackingSceneCalibrationAssessment) {
    super(
      'Create 3D Scene cannot exactly reproduce this solved lens: '
      + `${assessment.reasons.join('; ')}. Choose Create approximate 3D scene `
      + `to use a centered pinhole camera (estimated maximum source-frame error ${assessment.maxPixelError.toFixed(2)}px), `
      + 'or undistort and re-solve with a SIMPLE_PINHOLE camera.',
    );
    this.name = 'UnsupportedTrackingSceneCalibrationError';
    this.assessment = assessment;
  }
}

export interface TrackingSceneSourceTiming {
  clip: Parameters<typeof surfaceSourceTime>[0] & Pick<TimelineClip, 'duration'>;
  keyframes: readonly Keyframe[];
}

type Matrix3 = TerrainCamera['rotation'];

function cameraCenter(rotation: Matrix3, translation: TerrainCamera['translation']) {
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
  const yaw = Math.abs(cosPitch) > 1e-6
    ? Math.atan2(basis[2], basis[8])
    : Math.atan2(-basis[6], basis[0]);
  const roll = Math.abs(cosPitch) > 1e-6 ? Math.atan2(basis[3], basis[4]) : 0;
  const toDegrees = 180 / Math.PI;
  return { x: pitch * toDegrees, y: yaw * toDegrees, z: roll * toDegrees };
}

function unwrapAngle(value: number, previous: number): number {
  let result = value;
  while (result - previous > 180) result -= 360;
  while (result - previous < -180) result += 360;
  return result;
}

function clean(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

export function terrainCameraToEditorPose(camera: TerrainCamera): Omit<TrackingSceneCameraPose, 'time'> {
  if (
    !camera.rotation.every(Number.isFinite)
    || !camera.translation.every(Number.isFinite)
    || !Number.isFinite(camera.time)
  ) {
    throw new Error('The tracking result contains an invalid solved camera pose.');
  }
  const center = cameraCenter(camera.rotation, camera.translation);
  const rotation = editorEuler(camera.rotation);
  return {
    sourceTime: camera.time,
    position: { x: clean(center.x), y: clean(-center.y), z: clean(-center.z) },
    rotation: { x: clean(rotation.x), y: clean(rotation.y), z: clean(rotation.z) },
  };
}

function validateTrackingSceneIntrinsics(intrinsics: TerrainIntrinsics): void {
  const values = [
    intrinsics.width, intrinsics.height, intrinsics.fx, intrinsics.fy,
    intrinsics.cx, intrinsics.cy, intrinsics.k1 ?? 0,
  ];
  if (!values.every(Number.isFinite) || intrinsics.width <= 0 || intrinsics.height <= 0 || intrinsics.fx <= 0 || intrinsics.fy <= 0) {
    throw new Error('The tracking result has invalid camera intrinsics.');
  }
}

/** Quantifies the lens terms lost by an ordinary centered scene camera. */
export function assessTrackingSceneCalibration(intrinsics: TerrainIntrinsics): TrackingSceneCalibrationAssessment {
  validateTrackingSceneIntrinsics(intrinsics);
  const principalX = intrinsics.cx - intrinsics.width / 2;
  const principalY = intrinsics.cy - intrinsics.height / 2;
  const focalLength = Math.sqrt(intrinsics.fx * intrinsics.fy);
  const reasons: string[] = [];
  if (Math.abs(principalX) > 0.5 || Math.abs(principalY) > 0.5) {
    reasons.push(`principal point offset ${principalX.toFixed(2)}px, ${principalY.toFixed(2)}px`);
  }
  if (Math.abs(intrinsics.fx - intrinsics.fy) > 0.5) {
    reasons.push(`focal lengths fx ${intrinsics.fx.toFixed(2)}, fy ${intrinsics.fy.toFixed(2)}`);
  }
  if (Math.abs(intrinsics.k1 ?? 0) > 1e-8) {
    reasons.push(`radial distortion k1 ${(intrinsics.k1 ?? 0).toPrecision(5)}`);
  }
  // Evaluate the source-frame corners in normalized camera coordinates.
  // This is a conservative screen-space bound for the discarded terms.
  let maxPixelError = 0;
  for (const pixelX of [0, intrinsics.width]) for (const pixelY of [0, intrinsics.height]) {
    const x = (pixelX - intrinsics.cx) / intrinsics.fx;
    const y = (pixelY - intrinsics.cy) / intrinsics.fy;
    const radial = 1 + (intrinsics.k1 ?? 0) * (x * x + y * y);
    const exactX = intrinsics.fx * x * radial + intrinsics.cx;
    const exactY = intrinsics.fy * y * radial + intrinsics.cy;
    const approximateX = focalLength * x + intrinsics.width / 2;
    const approximateY = focalLength * y + intrinsics.height / 2;
    maxPixelError = Math.max(maxPixelError, Math.hypot(exactX - approximateX, exactY - approximateY));
  }
  return {
    exactSupported: reasons.length === 0,
    maxPixelError,
    reason: reasons.join('; '),
    reasons,
  };
}

export function assertTrackingSceneCameraCalibration(intrinsics: TerrainIntrinsics): void {
  const assessment = assessTrackingSceneCalibration(intrinsics);
  if (!assessment.exactSupported) throw new UnsupportedTrackingSceneCalibrationError(assessment);
}

function assertMonotonicSourceMapping(timing: TrackingSceneSourceTiming): boolean {
  const { clip, keyframes } = timing;
  const first = surfaceSourceTime(clip, 0, keyframes);
  const last = surfaceSourceTime(clip, clip.duration, keyframes);
  const ascending = last > first;
  if (Math.abs(last - first) <= 1e-8) {
    throw new Error('The source clip has no monotonic media-time range for a solved camera.');
  }
  let previous = first;
  for (let index = 1; index <= 64; index += 1) {
    const current = surfaceSourceTime(clip, clip.duration * index / 64, keyframes);
    if ((ascending && current < previous - 1e-7) || (!ascending && current > previous + 1e-7)) {
      throw new Error('Create 3D Scene cannot map a camera through a source clip that changes playback direction.');
    }
    previous = current;
  }
  return ascending;
}

function localTimeForSourceTime(
  timing: TrackingSceneSourceTiming,
  sourceTime: number,
  ascending: boolean,
): number {
  let low = 0;
  let high = timing.clip.duration;
  for (let iteration = 0; iteration < 44; iteration += 1) {
    const local = (low + high) / 2;
    const current = surfaceSourceTime(timing.clip, local, timing.keyframes);
    if (ascending ? current < sourceTime : current > sourceTime) low = local;
    else high = local;
  }
  return (low + high) / 2;
}

interface LocalCameraInterval {
  start: number;
  end: number;
  camera: TerrainCamera;
}

function cleanLocalTime(value: number, duration: number): number {
  if (Math.abs(value) < 1e-9) return 0;
  if (Math.abs(value - duration) < 1e-9) return duration;
  return Math.round(value * 1e9) / 1e9;
}

function localCameraIntervals(
  cameras: readonly TerrainCamera[],
  timing?: TrackingSceneSourceTiming,
): { intervals: LocalCameraInterval[]; duration: number } {
  if (!timing) {
    const sourceOrigin = Math.min(...cameras.map((camera) => camera.time));
    const intervals = cameras.map((camera) => ({
      start: camera.time - sourceOrigin,
      end: camera.time + camera.duration - sourceOrigin,
      camera,
    }));
    return {
      intervals,
      duration: Math.max(...intervals.map((interval) => interval.end)),
    };
  }

  const ascending = assertMonotonicSourceMapping(timing);
  const sourceAtStart = surfaceSourceTime(timing.clip, 0, timing.keyframes);
  const sourceAtEnd = surfaceSourceTime(timing.clip, timing.clip.duration, timing.keyframes);
  const sourceMin = Math.min(sourceAtStart, sourceAtEnd);
  const sourceMax = Math.max(sourceAtStart, sourceAtEnd);
  const intervals: LocalCameraInterval[] = [];
  for (const camera of cameras) {
    const cameraEnd = camera.time + camera.duration;
    const overlapStart = Math.max(camera.time, sourceMin);
    const overlapEnd = Math.min(cameraEnd, sourceMax);
    if (overlapEnd <= overlapStart + 1e-8) continue;
    const first = localTimeForSourceTime(timing, overlapStart, ascending);
    const second = localTimeForSourceTime(timing, overlapEnd, ascending);
    intervals.push({
      start: cleanLocalTime(Math.min(first, second), timing.clip.duration),
      end: cleanLocalTime(Math.max(first, second), timing.clip.duration),
      camera,
    });
  }
  return { intervals, duration: timing.clip.duration };
}

function estimateFrameRate(cameras: readonly TerrainCamera[]): number {
  const durations = cameras.map((camera) => camera.duration).filter((duration) => Number.isFinite(duration) && duration > 0);
  if (durations.length === 0) return 30;
  const median = durations.toSorted((a, b) => a - b)[Math.floor(durations.length / 2)]!;
  return Math.max(1, Math.min(240, Math.round(1 / median)));
}

export function buildTrackingSceneCameraPlan(input: {
  terrain: TerrainReconstruction;
  bounds: TrackingSceneBounds;
  sourceTiming?: TrackingSceneSourceTiming;
  preferredFrameRate?: number;
  allowApproximateCamera?: boolean;
}): TrackingSceneCameraPlan {
  const intrinsics = input.terrain.intrinsics;
  const calibration = assessTrackingSceneCalibration(intrinsics);
  if (!calibration.exactSupported && !input.allowApproximateCamera) {
    throw new UnsupportedTrackingSceneCalibrationError(calibration);
  }
  const focalLength = calibration.exactSupported
    ? intrinsics.fy
    : Math.sqrt(intrinsics.fx * intrinsics.fy);
  const cameras = input.terrain.cameras
    .filter((camera) => Number.isFinite(camera.time) && Number.isFinite(camera.duration) && camera.duration > 0)
    .toSorted((a, b) => a.time - b.time);
  if (cameras.length === 0) throw new Error('The tracking result has no solved camera poses.');

  const mapped = localCameraIntervals(cameras, input.sourceTiming);
  const intervals = mapped.intervals.toSorted((a, b) => a.start - b.start);
  if (intervals.length === 0) {
    throw new Error('The solved camera has no coverage inside the selected source clip.');
  }

  const gapEpsilon = Math.max(2e-5, mapped.duration * 1e-9);
  const grouped: LocalCameraInterval[][] = [];
  for (const interval of intervals) {
    const current = grouped.at(-1);
    if (!current || interval.start > current.at(-1)!.end + gapEpsilon) grouped.push([interval]);
    else current.push(interval);
  }

  const segments = grouped.map((group): TrackingSceneCameraSegment => {
    const segmentStart = group[0]!.start;
    let previousRotation: TrackingSceneCameraPose['rotation'] | undefined;
    const poses = group.map((interval) => {
      const raw = terrainCameraToEditorPose(interval.camera);
      const rotation = previousRotation ? {
        x: unwrapAngle(raw.rotation.x, previousRotation.x),
        y: unwrapAngle(raw.rotation.y, previousRotation.y),
        z: unwrapAngle(raw.rotation.z, previousRotation.z),
      } : raw.rotation;
      previousRotation = rotation;
      return { ...raw, time: interval.start - segmentStart, rotation };
    });
    return {
      startTime: segmentStart,
      duration: Math.max(1e-6, group.at(-1)!.end - segmentStart),
      poses,
    };
  });

  const maximumCameraDistance = segments.flatMap((segment) => segment.poses).reduce((maximum, pose) => {
    const distance = Math.hypot(
      pose.position.x - input.bounds.center.x,
      pose.position.y - input.bounds.center.y,
      pose.position.z - input.bounds.center.z,
    );
    return Math.max(maximum, distance);
  }, 0);
  const near = Math.max(0.0001, input.bounds.maxDimension * 1e-5);
  const far = Math.max(1000, maximumCameraDistance + input.bounds.diagonal * 4, near * 10_000);
  const frameRate = input.preferredFrameRate && Number.isFinite(input.preferredFrameRate) && input.preferredFrameRate > 0
    ? input.preferredFrameRate
    : estimateFrameRate(cameras);

  return {
    duration: Math.max(1e-6, mapped.duration),
    frameRate,
    settings: {
      fov: 2 * Math.atan(intrinsics.height / (2 * focalLength)) * 180 / Math.PI,
      near,
      far,
      resolutionWidth: Math.round(intrinsics.width),
      resolutionHeight: Math.round(intrinsics.height),
    },
    segments,
    calibration,
  };
}
