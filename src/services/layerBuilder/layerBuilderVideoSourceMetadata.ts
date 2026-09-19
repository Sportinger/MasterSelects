import type { TimelineClip } from '../../types/timeline';
import { getPremiereProxyCompositionDimensions, type LayerBuilderVideoMediaMetadata } from './layerBuilderLinkedSourceMetadata';

export type LayerBuilderVideoSourceMetadata = { mediaFileId?: string; intrinsicWidth?: number; intrinsicHeight?: number };

function getPositiveDimension(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function getLayerSourceMetadata(
  clip: TimelineClip,
  mediaFile?: LayerBuilderVideoMediaMetadata,
  fallback?: { width?: number; height?: number },
  compositionFallback?: { width?: number; height?: number },
): LayerBuilderVideoSourceMetadata {
  const premiereProxy = getPremiereProxyCompositionDimensions(mediaFile, compositionFallback);
  const liveInputWidth = clip.source?.liveInputId
    ? getPositiveDimension(fallback?.width)
    : undefined;
  const liveInputHeight = clip.source?.liveInputId
    ? getPositiveDimension(fallback?.height)
    : undefined;

  return {
    mediaFileId: mediaFile?.id ?? clip.mediaFileId ?? clip.source?.mediaFileId,
    intrinsicWidth: liveInputWidth
      ?? getPositiveDimension(mediaFile?.width)
      ?? getPositiveDimension(premiereProxy.width)
      ?? getPositiveDimension(fallback?.width),
    intrinsicHeight: liveInputHeight
      ?? getPositiveDimension(mediaFile?.height)
      ?? getPositiveDimension(premiereProxy.height)
      ?? getPositiveDimension(fallback?.height),
  };
}

export function getFinalOpacity(transformOpacity: number, opacityOverride?: number): number {
  return opacityOverride !== undefined ? transformOpacity * opacityOverride : transformOpacity;
}
