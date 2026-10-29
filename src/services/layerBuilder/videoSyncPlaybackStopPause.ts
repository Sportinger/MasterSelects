import type { TimelineClip } from '../../types/timeline';
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
  pauseUpcomingPreplaysNow(deps);
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

/**
 * A pre-roll runs the upcoming clip's video muted ahead of the playhead and shows no frame yet,
 * so there is nothing to grab from it, on Android either. Only the per-frame sync used to end
 * pre-rolls, and paused in a gap it no longer runs: a pre-roll started there kept playing, and a
 * stale entry kept the next play from starting a fresh one.
 */
function pauseUpcomingPreplaysNow(deps: PlaybackStopPauseDeps): void {
  for (const [video, preplay] of deps.warmups.listUpcomingPreplays()) {
    if (!video.paused) {
      video.pause();
      vfPipelineMonitor.record('vf_pause', { clipId: preplay.clipId, reason: 'playback-stop-preplay' });
    }
    if (video.playbackRate !== 1) video.playbackRate = 1;
    deps.warmups.deleteUpcomingPreplay(video);
  }
}
