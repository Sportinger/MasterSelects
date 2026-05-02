export const FULL_FRAME_SENSOR_HEIGHT_MM = 24;
export const MIN_CAMERA_FOV_DEGREES = 10;
export const MAX_CAMERA_FOV_DEGREES = 140;

export function clampCameraFov(value: number): number {
  return Math.max(MIN_CAMERA_FOV_DEGREES, Math.min(MAX_CAMERA_FOV_DEGREES, value));
}

export function fovToFullFrameFocalLengthMm(fovDegrees: number): number {
  const fovRadians = (clampCameraFov(fovDegrees) * Math.PI) / 180;
  return FULL_FRAME_SENSOR_HEIGHT_MM / (2 * Math.tan(fovRadians * 0.5));
}

export function fullFrameFocalLengthMmToFov(focalLengthMm: number): number {
  const safeFocalLength = Math.max(1, focalLengthMm);
  const fovRadians = 2 * Math.atan(FULL_FRAME_SENSOR_HEIGHT_MM / (2 * safeFocalLength));
  return clampCameraFov((fovRadians * 180) / Math.PI);
}
