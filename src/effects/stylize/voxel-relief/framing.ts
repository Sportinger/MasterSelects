/**
 * Voxel Relief camera framing: how far the orbit camera stands from the focus point.
 *
 * The camera pulls back far enough to frame the field (`focal * 0.5`) plus a margin for the
 * tallest column (`0.7 * relief height`), times Distance. Effects saved before 2026-10-27
 * ('height' framing) took that margin from the current relief height, so animating Height
 * dollied the camera: a low relief moved it closer and cropped up to a fifth of the picture.
 * The default 'fixed' framing keeps the margin of the default relief (Base 0.015 + Height 1.2)
 * for every lower relief and only pulls back further for a taller one, so Height never zooms.
 */

/** Relief height the steady framing is anchored to: the default Base 0.015 plus Height 1.2. */
export const VOXEL_FRAMING_REFERENCE_HEIGHT = 1.215;

export type VoxelFraming = 'fixed' | 'height';

/** The shader's focal length for a FOV value (FOV 0.15-1.6 maps to 12-42 degrees). */
export function voxelFocalLength(perspective: number): number {
  const clamped = Math.min(1.6, Math.max(0.15, Number.isFinite(perspective) ? perspective : 0.22));
  const fovDegrees = 12 + (42 - 12) * ((clamped - 0.15) / 1.45);
  return 1 / Math.tan((fovDegrees * Math.PI) / 180 / 2);
}

/** Distance from the focus point to the eye, as the raymarcher uses it (`params.cameraRadius`). */
export function voxelCameraRadius(options: {
  perspective: number;
  distance: number;
  reliefHeight: number;
  framing: VoxelFraming;
}): number {
  const focal = voxelFocalLength(options.perspective);
  const relief = Math.max(Number.isFinite(options.reliefHeight) ? options.reliefHeight : 0, 0.001);
  const margin = options.framing === 'height' ? relief : Math.max(relief, VOXEL_FRAMING_REFERENCE_HEIGHT);
  const distance = Math.min(8, Math.max(0.15, Number.isFinite(options.distance) ? options.distance : 0.8));
  return Math.max(0.9, focal * 0.5 + margin * 0.7) * distance;
}

/**
 * Fraction of the field height the camera sees at the focus plane (1 = exactly the layer height).
 * Below 1 the relief is cropped, above 1 the layer gets a margin around it.
 */
export function voxelVisibleFieldFraction(radius: number, perspective: number): number {
  return (2 * radius) / voxelFocalLength(perspective);
}
