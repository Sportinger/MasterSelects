import type { TimelineClip } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { isAndroidVideoFrameRuntime } from '../../engine/texture/videoFrameCopyPolicy';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import { canClipOwnVideoSyncMedia } from './videoSyncMediaAdmission';
import { resolveVideoSyncMedia } from './videoSyncMediaResolver';
import type { VideoSyncHtmlClipCoordinatorDeps } from './videoSyncHtmlClipCoordinator';

type PlaybackStopPauseDeps = Pick<
  VideoSyncHtmlClipCoordinatorDeps,
  'warmups' | 'getHandoffVideoElement' | 'getHandoffTrackState' | 'isForceDecodeInProgress'
>;

/**
 * Freeze playing timeline videos in the pause/stop task itself. The next
 * sync then finishes the stop from the frozen time instead of a time the
 * element kept playing to while a slow (e.g. 4K) frame was rendering.
 */
export function pausePlaybackVideosNow(deps: PlaybackStopPauseDeps): void {
  // Android grabs the running frame before pausing (see the HTML stop path).
  if (isAndroidVideoFrameRuntime()) return;
  const pauseClipVideos = (clip: TimelineClip): void => {
    const candidates = [
      canClipOwnVideoSyncMedia(clip) ? resolveVideoSyncMedia(clip).htmlVideoElement : null,
      deps.getHandoffVideoElement(clip.id),
      clip.trackId ? deps.getHandoffTrackState(clip.trackId)?.videoElement ?? null : null,
    ];
    for (const video of candidates) {
      if (!video || video.paused || deps.warmups.isWarming(video)) continue;
      if (deps.isForceDecodeInProgress(clip.id)) continue;
      video.pause();
      vfPipelineMonitor.record('vf_pause', { clipId: clip.id, reason: 'playback-stop-sync' });
    }
    clip.nestedClips?.forEach(pauseClipVideos);
  };
  useTimelineStore.getState().clips.forEach(pauseClipVideos);
}
