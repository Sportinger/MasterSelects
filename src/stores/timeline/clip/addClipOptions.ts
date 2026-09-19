import type { TimelineClip } from '../../../types';
import type { AddClipOptions } from '../types';

export function applyAddClipOptions(clip: TimelineClip, options?: AddClipOptions): TimelineClip {
  if (!options) return clip;

  return {
    ...clip,
    ...(options.name ? { name: options.name } : {}),
    ...(options.is3D !== undefined ? { is3D: options.is3D } : {}),
    ...(options.signalAssetId ? { signalAssetId: options.signalAssetId } : {}),
    ...(options.signalRefId ? { signalRefId: options.signalRefId } : {}),
    ...(options.signalRenderAdapterId ? { signalRenderAdapterId: options.signalRenderAdapterId } : {}),
    source: clip.source && options.source
      ? { ...clip.source, ...options.source }
      : clip.source,
  };
}
