import type { TimelineClip, TimelineTrack } from '../types/timeline';

export interface ChatReviewLaneClip {
  duration: number;
  id: string;
  name: string;
  startTime: number;
  thumbnail?: string;
  waveform?: number[];
}

export interface ChatReviewLanes {
  audio: ChatReviewLaneClip[];
  video: ChatReviewLaneClip[];
}

function effectiveTracks(
  tracks: readonly TimelineTrack[],
  type: 'audio' | 'video',
): TimelineTrack[] {
  const candidates = tracks.filter((track) => (
    track.type === type
    && (type !== 'video' || track.visible)
    && (type !== 'audio' || !track.muted)
  ));
  return candidates.some((track) => track.solo)
    ? candidates.filter((track) => track.solo)
    : candidates;
}

function toLaneClip(clip: TimelineClip): ChatReviewLaneClip {
  const thumbnail = clip.thumbnails?.find(Boolean);
  return {
    duration: clip.duration,
    id: clip.id,
    name: clip.name,
    startTime: clip.startTime,
    ...(thumbnail ? { thumbnail } : {}),
    ...(clip.waveform?.length ? { waveform: clip.waveform } : {}),
  };
}

function byTimelinePosition(left: TimelineClip, right: TimelineClip): number {
  return left.startTime - right.startTime || left.id.localeCompare(right.id);
}

export function projectChatReviewLanes(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
): ChatReviewLanes {
  const audioTrackIds = new Set(effectiveTracks(tracks, 'audio').map((track) => track.id));
  const videoTracks = effectiveTracks(tracks, 'video');
  const videoTrackIds = new Set(videoTracks.map((track) => track.id));
  const audioClipIds = new Set(
    clips.filter((clip) => audioTrackIds.has(clip.trackId)).map((clip) => clip.id),
  );
  const visibleVisualClips = clips.filter((clip) => (
    videoTrackIds.has(clip.trackId)
    && !clip.captionProperties
    && !clip.textProperties
    && (clip.source?.type === 'video' || clip.source?.type === 'image')
  ));
  const linkedNarrativeClips = visibleVisualClips.filter((clip) => (
    Boolean(clip.linkedClipId && audioClipIds.has(clip.linkedClipId))
  ));

  let narrativeVideoClips = linkedNarrativeClips;
  if (narrativeVideoClips.length === 0 && visibleVisualClips.length > 0) {
    const fallbackTrackId = [...videoTracks]
      .reverse()
      .find((track) => visibleVisualClips.some((clip) => clip.trackId === track.id))?.id;
    narrativeVideoClips = visibleVisualClips.filter((clip) => clip.trackId === fallbackTrackId);
  }

  return {
    video: narrativeVideoClips.toSorted(byTimelinePosition).map(toLaneClip),
    audio: clips
      .filter((clip) => audioTrackIds.has(clip.trackId))
      .toSorted(byTimelinePosition)
      .map(toLaneClip),
  };
}
