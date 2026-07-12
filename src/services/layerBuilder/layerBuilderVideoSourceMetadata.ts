import type { TimelineClip } from '../../types/timeline';

export type LayerBuilderVideoSourceMetadata = {
  mediaFileId?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
};

function getPositiveDimension(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function getLayerSourceMetadata(
  clip: TimelineClip,
  mediaFile?: { id?: string; width?: number; height?: number },
  fallback?: { width?: number; height?: number },
): LayerBuilderVideoSourceMetadata {
  return {
    mediaFileId: mediaFile?.id ?? clip.mediaFileId ?? clip.source?.mediaFileId,
    intrinsicWidth: getPositiveDimension(mediaFile?.width) ?? getPositiveDimension(fallback?.width),
    intrinsicHeight: getPositiveDimension(mediaFile?.height) ?? getPositiveDimension(fallback?.height),
  };
}

export function getFinalOpacity(transformOpacity: number, opacityOverride?: number): number {
  return opacityOverride !== undefined
    ? transformOpacity * opacityOverride
    : transformOpacity;
}
