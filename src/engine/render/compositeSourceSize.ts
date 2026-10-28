import type { LayerRenderData } from '../core/types';

export interface CompositeSourceSize {
  width: number;
  height: number;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The source size a compositor layer is placed and aspect-corrected with.
 *
 * Adjustment layers process the accumulated frame and use the reference size.
 * Canvas-backed sources can resize without rebuilding the durable layer metadata
 * (notably an iPad live camera after an orientation change), so their collected
 * size describes the texture being composited now; otherwise valid intrinsic
 * metadata wins over the collected size.
 *
 * Returns null when no positive finite size is known. A 0×0 size (for example a
 * cached scrub frame reported with the size of a video element that has not
 * loaded its metadata yet) would give a NaN source aspect, and the shader would
 * stretch a single texture column across the layer.
 */
export function resolveCompositeSourceSize(
  data: Pick<LayerRenderData, 'layer' | 'sourceWidth' | 'sourceHeight'>,
  reference: CompositeSourceSize,
  isAdjustmentLayer: boolean,
): CompositeSourceSize | null {
  if (isAdjustmentLayer) {
    return positiveFinite(reference.width) && positiveFinite(reference.height) ? reference : null;
  }
  const source = data.layer.source;
  const useIntrinsic = !source?.canvasElement;
  const width = useIntrinsic && positiveFinite(source?.intrinsicWidth) ? source.intrinsicWidth : data.sourceWidth;
  const height = useIntrinsic && positiveFinite(source?.intrinsicHeight) ? source.intrinsicHeight : data.sourceHeight;
  return positiveFinite(width) && positiveFinite(height) ? { width, height } : null;
}

/**
 * Size to report for a src-keyed cached scrub frame. The cache is shared by every
 * element playing that src, so the element asking for the frame may be fresh and
 * still report 0×0 (readyState 0). Prefer the element's real size, then the
 * layer's known intrinsic size (top-level clips carry it from the media file),
 * then the source size the cache recorded at capture. The cached texture's own
 * size is only a last resort: same aspect, but downscaled to the cache's
 * maxDimension, so it placed a 1080p frame at half size (a quarter for 4K).
 * Returns null only when no positive size exists at all; the frame cannot be
 * placed then (a 0×0 report gave a NaN aspect, NESTED_SMALL_COMP_PREVIEW).
 */
export function resolveCachedScrubFrameSize(
  video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>,
  layer: Pick<LayerRenderData['layer'], 'source'> | null | undefined,
  entry: { width?: number; height?: number; sourceWidth?: number; sourceHeight?: number } | null | undefined,
): CompositeSourceSize | null {
  if (positiveFinite(video.videoWidth) && positiveFinite(video.videoHeight)) {
    return { width: video.videoWidth, height: video.videoHeight };
  }
  const source = layer?.source;
  if (positiveFinite(source?.intrinsicWidth) && positiveFinite(source?.intrinsicHeight)) {
    return { width: source.intrinsicWidth, height: source.intrinsicHeight };
  }
  if (positiveFinite(entry?.sourceWidth) && positiveFinite(entry?.sourceHeight)) {
    return { width: entry.sourceWidth, height: entry.sourceHeight };
  }
  if (positiveFinite(entry?.width) && positiveFinite(entry?.height)) {
    return { width: entry.width, height: entry.height };
  }
  return null;
}
