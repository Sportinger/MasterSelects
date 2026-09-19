import { useTimelineStore } from '../../stores/timeline';
import { useHistoryStore } from '../../stores/historyStore';
import type { PlanarTrack } from '../../types/planarTracking';
import { publishTrackingAsset } from './trackingAssets';

export function editSurfaceTracks(clipId: string, label: string, change: (tracks: PlanarTrack[]) => PlanarTrack[]): void {
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find(c => c.id === clipId);
  if (!clip || timeline.isExporting || timeline.tracks.find(t => t.id === clip.trackId)?.locked) {
    throw new Error('The clip is unavailable, locked, or being exported.');
  }
  const tracks = change(clip.planarTracks ?? []);
  const history = useHistoryStore.getState(), batch = history.startBatch(label);
  try {
    timeline.updateClip(clipId, { planarTracks: tracks });
    for (const track of tracks) {
      if (clip.planarTracks?.find(previous => previous.id === track.id) !== track) publishTrackingAsset(clipId, track);
    }
    useTimelineStore.getState().invalidateCache();
  } finally { if (batch.opened) history.endBatch(); }
}
