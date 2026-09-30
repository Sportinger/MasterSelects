import type { TimelineClip } from '../../types';
import { clearAINodeRuntimeCacheForClip } from '../../services/nodeGraph';
import { stopTimelineAudioPlayback } from '../../services/audio/timelineAudioPlaybackStopper';
import { releaseCompositionMixdownClipRuntime } from '../../services/timeline/compositionAudioMixdownRuntimeResources';
import {
  detachLegacyTimelineMediaElement,
  releaseLegacyTimelineClipSourceRuntime,
} from '../../services/timeline/timelineClipSourceRuntimeCleanup';
import { blobUrlManager } from './helpers/blobUrlManager';
import { releaseClipTreeRuntimeBindings } from '../../services/mediaRuntime/clipBindings';

export function cleanupDeletedClipResources(
  deletedClips: readonly TimelineClip[],
  /** Multicam cuts remove video-only pieces during playback and must not stop the audio. */
  options: { stopAudioPlayback?: boolean } = {},
): void {
  if (deletedClips.length === 0) return;
  if (options.stopAudioPlayback !== false) stopTimelineAudioPlayback();

  for (const clip of deletedClips) {
    releaseClipTreeRuntimeBindings(clip);
    releaseLegacyTimelineClipSourceRuntime(clip, {
      cleanupVideoGpu: true,
      disposeAudioRouting: true,
    });
    if (clip.mixdownAudio) {
      detachLegacyTimelineMediaElement(clip.mixdownAudio, { disposeAudioRouting: true });
    }
    releaseCompositionMixdownClipRuntime(clip);
    clearAINodeRuntimeCacheForClip(clip.id);
    blobUrlManager.revokeAll(clip.id);
  }
}
