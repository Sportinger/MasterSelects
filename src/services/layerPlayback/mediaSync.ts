import { ownsProcessedAudioPreview } from '../audio/preview/processedAudioPreviewOwnership';
import { useTimelineStore } from '../../stores/timeline';
import { createClipSpeedSource, resolveClipSourceTime, videoFrameSourceTime } from '../timeline/retime/clipRetime';
import { resolveAudioPreviewRetime, flagAudioPreviewRetime } from '../timeline/retime/clipAudioRetime';
import type { TimelineClip } from '../../types/timeline';
import type { LayerPlaybackInfo } from './layerPlaybackState';

function isClipActiveAtTime(clip: TimelineClip, timelineTime: number): boolean {
  return timelineTime >= clip.startTime && timelineTime < clip.startTime + clip.duration;
}

export function syncVideoClipToPlayback(
  clip: TimelineClip,
  playback: LayerPlaybackInfo
): void {
  if (!clip.source?.videoElement) return;

  const video = clip.source.videoElement;
  const isActive = isClipActiveAtTime(clip, playback.currentTime);

  if (!playback.shouldRender || !isActive) {
    if (!video.paused) video.pause();
    return;
  }

  const sample = resolveClipSourceTime(clip, playback.currentTime - clip.startTime,
    createClipSpeedSource(clip, useTimelineStore.getState().clipKeyframes.get(clip.id) ?? []));
  const clipTime = videoFrameSourceTime(sample);
  const timeDiff = Math.abs(video.currentTime - clipTime);
  // Native playback cannot follow reverse segments or holds. Paused requests
  // must preserve the contract's tiny backward frame bias, even at a boundary.
  const nativePlayback = playback.playbackState === 'playing' &&
    sample.sourceRate >= 0.0625 && sample.sourceRate <= 16;
  if (timeDiff > (nativePlayback ? 0.5 : 0.000001)) {
    video.currentTime = clipTime;
  }

  if (nativePlayback) {
    video.playbackRate = sample.sourceRate;
    if (video.paused) video.play().catch(() => {});
  } else if (!video.paused) {
    video.pause();
  }
}

export function syncAudioClipToPlayback(
  clip: TimelineClip,
  playback: LayerPlaybackInfo
): void {
  if (!clip.source?.audioElement) return;

  const audio = clip.source.audioElement;
  if (ownsProcessedAudioPreview(clip.id)) { audio.muted = true; audio.pause(); return; }
  const isActive = isClipActiveAtTime(clip, playback.currentTime);

  if (!playback.shouldRender || !isActive) {
    if (!audio.paused) audio.pause();
    return;
  }

  const retime = resolveAudioPreviewRetime(clip, playback.currentTime - clip.startTime,
    createClipSpeedSource(clip, useTimelineStore.getState().clipKeyframes.get(clip.id) ?? []));
  flagAudioPreviewRetime(audio, retime.mutedReason);
  audio.muted = Boolean(retime.mutedReason) || clip.audioState?.muted === true;
  if (audio.muted) { audio.pause(); return; }
  audio.playbackRate = retime.sourceRate;
  audio.preservesPitch = clip.preservesPitch !== false;
  const clipTime = retime.sourceTime;
  const timeDiff = Math.abs(audio.currentTime - clipTime);

  if (timeDiff > 0.3) {
    audio.currentTime = clipTime;
  }

  if (playback.playbackState === 'playing') {
    if (audio.paused) audio.play().catch(() => {});
  } else if (!audio.paused) {
    audio.pause();
  }

  if (playback.playbackState !== 'playing' && timeDiff > 0.05) {
    audio.currentTime = clipTime;
  }
}
