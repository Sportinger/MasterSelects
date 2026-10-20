import type { TimelineClip, TimelineTrack } from '../../types/timeline';

/** Duration of an image document; layers span all of it, so time never shows. */
export const IMAGE_DOCUMENT_DURATION = 5;

export interface ImageLayer {
  track: TimelineTrack;
  clip: TimelineClip;
}

/**
 * Layers of the Image workspace, top to bottom. A layer is the visual clip of
 * a video track: in a still composition the track's first clip, in a video
 * composition the clip under the playhead (so the panel stays useful there).
 */
export function getImageLayers(
  tracks: readonly TimelineTrack[],
  clips: readonly TimelineClip[],
  options: { still: boolean; time: number },
): ImageLayer[] {
  const layers: ImageLayer[] = [];
  for (const track of tracks) {
    if (track.type !== 'video') continue;
    const trackClips = clips
      .filter((clip) => clip.trackId === track.id)
      .toSorted((a, b) => a.startTime - b.startTime);
    const clip = options.still
      ? trackClips[0]
      : trackClips.find((candidate) => (
        options.time >= candidate.startTime && options.time < candidate.startTime + candidate.duration
      ));
    if (clip) layers.push({ track, clip });
  }
  return layers;
}

/**
 * Track for a new top layer: the empty video track directly above the occupied
 * ones (reuses the empty default tracks of a fresh composition), otherwise null
 * so the caller creates a new top track.
 */
export function findReusableTopLayerTrack(
  tracks: readonly TimelineTrack[],
  clips: readonly TimelineClip[],
): TimelineTrack | null {
  const occupied = new Set(clips.map((clip) => clip.trackId));
  let reusable: TimelineTrack | null = null;
  for (const track of tracks) {
    if (track.type !== 'video') continue;
    if (occupied.has(track.id)) break;
    if (!track.locked) reusable = track;
  }
  return reusable;
}
