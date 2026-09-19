import type { LayerRenderData } from '../core/types';
import type { TrackingSourceTransform } from '../../types/terrainAttachment';
import { trackingSourceTransform } from '../../services/planarTracking/trackingSourceTransform';

/** Index current source-plane transforms by owning clip for tracking consumers. */
export function indexTrackingSourceTransforms(
  layerData: readonly LayerRenderData[],
  composition: { width: number; height: number },
): ReadonlyMap<string, TrackingSourceTransform> {
  const transforms = new Map<string, TrackingSourceTransform>();
  for (const data of layerData) {
    const { layer } = data;
    if (!layer.sourceClipId) continue;
    const useRenderedDimensions = Boolean(layer.source?.canvasElement);
    const intrinsicWidth = layer.source?.intrinsicWidth;
    const intrinsicHeight = layer.source?.intrinsicHeight;
    const width = !useRenderedDimensions && typeof intrinsicWidth === 'number' && intrinsicWidth > 0
      ? intrinsicWidth
      : data.sourceWidth;
    const height = !useRenderedDimensions && typeof intrinsicHeight === 'number' && intrinsicHeight > 0
      ? intrinsicHeight
      : data.sourceHeight;
    const transform = trackingSourceTransform(layer, { width, height }, composition);
    if (transform) transforms.set(layer.sourceClipId, transform);
  }
  return transforms;
}
