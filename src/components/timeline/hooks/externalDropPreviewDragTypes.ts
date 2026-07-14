export const GENERATED_VISUAL_DROP_TYPES = [
  'application/x-composition-id',
  'application/x-text-item-id',
  'application/x-solid-item-id',
  'application/x-mesh-item-id',
  'application/x-camera-item-id',
  'application/x-light-item-id',
  'application/x-splat-effector-item-id',
  'application/x-math-scene-item-id',
  'application/x-motion-shape-item-id',
  'application/x-signal-asset-id',
] as const;

export const TRACK_PREVIEW_DROP_TYPES = [
  ...GENERATED_VISUAL_DROP_TYPES,
  'application/x-media-file-id',
  'Files',
] as const;

function hasAnyDropType(types: readonly string[], acceptedTypes: readonly string[]): boolean {
  return acceptedTypes.some((type) => types.includes(type));
}

export function hasGeneratedVisualDropType(types: readonly string[]): boolean {
  return hasAnyDropType(types, GENERATED_VISUAL_DROP_TYPES);
}

export function hasTrackPreviewDropType(types: readonly string[]): boolean {
  return hasAnyDropType(types, TRACK_PREVIEW_DROP_TYPES);
}
