import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useTrackingStore } from '../../stores/trackingStore';
import { useHistoryStore } from '../../stores/historyStore';
import { editSurfaceTracks } from './surfaceTrackEditing';

/** Remove a clip's result; retain published geometry if another clip uses it. */
export function deleteSurfaceTrack(clipId: string, trackId: string): void {
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find(c => c.id === clipId);
  const track = clip?.planarTracks?.find(t => t.id === trackId);
  if (!track) return;
  const assets = useTrackingStore.getState().assets.filter(a => a.track.id === trackId && a.sourceMediaId === track.sourceId);
  const media = useMediaStore.getState();
  const otherClips = [...timeline.clips, ...media.compositions.filter(c => c.id !== media.activeCompositionId).flatMap(c => c.timelineData?.clips ?? [])];
  const history = useHistoryStore.getState(), batch = history.startBatch('Delete tracking result');
  try {
    editSurfaceTracks(clipId, 'Delete tracking result', tracks => tracks.filter(t => t.id !== trackId));
    for (const asset of assets) {
      const used = otherClips.some(c =>
        c.trackingBinding?.assetId === asset.id || c.terrainAttachment?.trackId === trackId || c.terrainScreenAnchor?.attachment.trackId === trackId ||
        (c.id !== clipId && c.planarTracks?.some(t => t.id === trackId && t.sourceId === track.sourceId)));
      if (!used) useTrackingStore.getState().removeAsset(asset.id);
    }
  } finally { if (batch.opened) history.endBatch(); }
}
