import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

type LinkedAudioPlacementClip = Pick<TimelineClip, 'trackId' | 'startTime' | 'duration'>;
type LinkedAudioPlacementTrack = Pick<TimelineTrack, 'id' | 'type' | 'locked'>;

// Linked-trim float noise must not spawn tracks; 1 microsecond is below frame/sample granularity.
const PLACEMENT_EPSILON_SECONDS = 1e-6;

function overlaps(
  clip: LinkedAudioPlacementClip,
  startTime: number,
  endTime: number,
): boolean {
  const clipEnd = clip.startTime + clip.duration;
  return endTime > clip.startTime + PLACEMENT_EPSILON_SECONDS &&
    startTime < clipEnd - PLACEMENT_EPSILON_SECONDS;
}

function canUseTrack(
  track: LinkedAudioPlacementTrack | undefined,
  trackType: LinkedAudioPlacementTrack['type'],
  clips: LinkedAudioPlacementClip[],
  startTime: number,
  endTime: number,
): boolean {
  return Boolean(
    track &&
    track.type === trackType &&
    !track.locked &&
    !clips.some((clip) => clip.trackId === track.id && overlaps(clip, startTime, endTime)),
  );
}

export interface LinkedAudioTrackResolution {
  trackId: string | null;
  requestedTrackRejected: boolean;
}

/**
 * Resolves the audio lane for a linked video clip.
 *
 * An explicit lane comes from an audio-lane drop and must never silently
 * reroute elsewhere. Normal video-lane drops retain the existing first-free
 * audio-lane behavior.
 */
export function resolveLinkedAudioTrackId(
  tracks: LinkedAudioPlacementTrack[],
  clips: LinkedAudioPlacementClip[],
  startTime: number,
  duration: number,
  requestedTrackId?: string,
  requestedVideoTrackId?: string,
): LinkedAudioTrackResolution {
  const endTime = startTime + duration;

  if (requestedTrackId) {
    const requestedTrack = tracks.find((track) => track.id === requestedTrackId);
    const requestedVideoTrack = requestedVideoTrackId
      ? tracks.find((track) => track.id === requestedVideoTrackId)
      : undefined;
    const requestedVideoTrackAvailable = !requestedVideoTrackId ||
      canUseTrack(requestedVideoTrack, 'video', clips, startTime, endTime);
    return requestedVideoTrackAvailable &&
      canUseTrack(requestedTrack, 'audio', clips, startTime, endTime)
      ? { trackId: requestedTrackId, requestedTrackRejected: false }
      : { trackId: null, requestedTrackRejected: true };
  }

  const availableTrack = tracks.find((track) =>
    canUseTrack(track, 'audio', clips, startTime, endTime)
  );
  return {
    trackId: availableTrack?.id ?? null,
    requestedTrackRejected: false,
  };
}
