import { effectStackNeedsContinuousRender } from '../../effects';
import type { Layer } from '../../types/layers';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';

export function hasContinuousRenderLayers(layers: Layer[]): boolean {
  return layers.some(layer =>
    layer.visible !== false &&
    effectStackNeedsContinuousRender(layer.effects)
  );
}

function getVisibleVideoTrackIds(tracks: TimelineTrack[]): Set<string> {
  const videoTracks = tracks.filter(track => track.type === 'video' && track.visible !== false);
  const hasSolo = videoTracks.some(track => track.solo);

  return new Set(
    videoTracks
      .filter(track => track.visible !== false && (!hasSolo || track.solo))
      .map(track => track.id)
  );
}

export function hasActiveContinuousRenderClip(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  playhead: number,
): boolean {
  const visibleVideoTrackIds = getVisibleVideoTrackIds(tracks);
  const epsilon = 1e-6;

  return clips.some(clip =>
    visibleVideoTrackIds.has(clip.trackId) &&
    playhead + epsilon >= clip.startTime &&
    playhead < clip.startTime + clip.duration &&
    effectStackNeedsContinuousRender(clip.effects)
  );
}
