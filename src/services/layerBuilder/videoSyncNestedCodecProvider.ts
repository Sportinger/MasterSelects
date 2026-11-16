import type { TimelineClip } from '../../types';
import {
  ensureRuntimeFrameProvider,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
  isProviderBackedRuntimeSource,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import { getNestedClipSourceTiming } from './layerBuilderNestedLayers';
import type { FrameContext } from './types';

/**
 * Nested clips decoded by a codec provider (MXF, HEVC, ProRes) have no HTML video element, so the
 * element-based nested sync skipped them: inside a nested composition or a transition composition
 * their decoder was never moved and kept showing whatever frame it last had (a crossfade between
 * two MXF shots showed footage from the wrong moment). This keeps that decoder on the clip's source
 * time, the same way the top-level sync does: advance during playback, exact seek while paused.
 */
export function syncNestedCodecProviderClip(input: {
  nestedClip: TimelineClip;
  compositionTime: number;
  compositionRate: number;
  ctx: Pick<FrameContext, 'isPlaying' | 'isDraggingPlayhead' | 'hasClipDragPreview'>;
  shouldSeekPaused: (provider: RuntimeFrameProvider, time: number) => boolean;
}): boolean {
  const { nestedClip, compositionTime, compositionRate, ctx, shouldSeekPaused } = input;
  const source = nestedClip.source;
  if (source?.type !== 'video' || !isProviderBackedRuntimeSource(source)) return false;
  const localTime = compositionTime - nestedClip.startTime;
  if (localTime < 0 || localTime >= nestedClip.duration) return false;

  const timing = getNestedClipSourceTiming(nestedClip, localTime);
  const time = timing.sourceTime;
  // Exactly the session the nested layer builder reads (resolveRuntimeLayerBuilderVideoSource with a
  // shared preview session): a decoder in any other session is never drawn.
  const runtimeSource = ctx.isDraggingPlayhead || ctx.hasClipDragPreview
    ? getScrubRuntimeSource(source, nestedClip.trackId, true)
    : getPreviewRuntimeSource(source, nestedClip.trackId, true);
  updateRuntimePlaybackTime(runtimeSource, time);
  const provider = getRuntimeFrameProvider(runtimeSource);
  if (!provider) {
    void ensureRuntimeFrameProvider(runtimeSource, 'interactive', time);
    return true;
  }
  const playingForward = ctx.isPlaying && !timing.isHold && timing.sourceRate * compositionRate > 0;
  if (playingForward && provider.advanceToTime) {
    provider.advanceToTime(time);
  } else if (shouldSeekPaused(provider, time)) {
    provider.seek(time);
  }
  return true;
}
