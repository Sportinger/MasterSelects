import type { TimelineClip, TimelineTrack } from '../../types';
import { applyClipDragPreview } from '../../stores/timeline/clipDragPreview';

type ClipDragPreviewInput = Parameters<typeof applyClipDragPreview>[1];

function getVisibleVideoTrackIds(tracks: readonly TimelineTrack[] = []): Set<string> {
  const videoTracks = tracks.filter(track => track.type === 'video' && track.visible !== false);
  const hasSolo = videoTracks.some(track => track.solo);

  return new Set(
    videoTracks
      .filter(track => !hasSolo || track.solo)
      .map(track => track.id)
  );
}

export function hasActiveTimelineVisualClip(
  clips: readonly TimelineClip[] = [],
  tracks: readonly TimelineTrack[] = [],
  playheadPosition: number
): boolean {
  const visibleVideoTrackIds = getVisibleVideoTrackIds(tracks);
  if (visibleVideoTrackIds.size === 0) return false;

  const epsilon = 1e-6;
  return clips.some(clip =>
    visibleVideoTrackIds.has(clip.trackId) &&
    playheadPosition + epsilon >= clip.startTime &&
    playheadPosition < clip.startTime + clip.duration
  );
}

/**
 * Wall-clock milliseconds until playback at `playbackSpeed` brings the playhead onto a clip on a
 * visible video track: 0 when one is at the playhead, Infinity when none lies ahead in the playback
 * direction. Reverse playback enters a clip at its end.
 */
export function getPlaybackVisualDemandLeadMs(
  clips: readonly TimelineClip[] = [],
  tracks: readonly TimelineTrack[] = [],
  playheadPosition: number,
  playbackSpeed: number
): number {
  const visibleVideoTrackIds = getVisibleVideoTrackIds(tracks);
  if (visibleVideoTrackIds.size === 0) return Number.POSITIVE_INFINITY;

  const speed = Number.isFinite(playbackSpeed) && playbackSpeed !== 0 ? playbackSpeed : 1;
  const epsilon = 1e-6;
  let leadSeconds = Number.POSITIVE_INFINITY;
  for (const clip of clips) {
    if (!visibleVideoTrackIds.has(clip.trackId)) continue;
    const clipEnd = clip.startTime + clip.duration;
    if (playheadPosition + epsilon >= clip.startTime && playheadPosition < clipEnd) return 0;
    const distance = speed < 0 ? playheadPosition - clipEnd : clip.startTime - playheadPosition;
    if (distance >= 0 && distance < leadSeconds) leadSeconds = distance;
  }
  return (leadSeconds / Math.abs(speed)) * 1000;
}

export function hasTimelineVisualRenderDemand(input: {
  clips?: readonly TimelineClip[];
  tracks?: readonly TimelineTrack[];
  playheadPosition: number;
  clipDragPreview?: ClipDragPreviewInput | null;
}): boolean {
  const inputClips = input.clips ?? [];
  const clips = input.clipDragPreview
    ? applyClipDragPreview(inputClips as TimelineClip[], input.clipDragPreview)
    : inputClips;

  return hasActiveTimelineVisualClip(clips, input.tracks ?? [], input.playheadPosition);
}
