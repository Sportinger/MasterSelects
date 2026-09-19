import { clonePlanarTracks } from '../../services/planarTracking/clonePlanarTracks';
import {
  cloneTerrainAnchorConnector,
  cloneTerrainAttachment,
  cloneTerrainScreenAnchor,
} from '../../types/terrainAttachment';
import type { TimelineClip } from '../../types/timeline';
import type { ClipboardClipData } from './types';

export function cloneTimelineTrackingMetadata(clip: TimelineClip) {
  return {
    planarTracks: clonePlanarTracks(clip.planarTracks),
    terrainAttachment: cloneTerrainAttachment(clip.terrainAttachment),
    terrainScreenAnchor: cloneTerrainScreenAnchor(clip.terrainScreenAnchor),
    terrainAnchorConnector: cloneTerrainAnchorConnector(clip.terrainAnchorConnector),
    trackingBinding: clip.trackingBinding ? structuredClone(clip.trackingBinding) : undefined,
  };
}

export function clonePastedTimelineTrackingMetadata(
  clip: ClipboardClipData,
  idMapping: ReadonlyMap<string, string>,
) {
  const terrainAttachment = cloneTerrainAttachment(clip.terrainAttachment);
  if (terrainAttachment) {
    terrainAttachment.targetVideoClipId = idMapping.get(terrainAttachment.targetVideoClipId)
      ?? terrainAttachment.targetVideoClipId;
  }
  const terrainScreenAnchor = cloneTerrainScreenAnchor(clip.terrainScreenAnchor);
  if (terrainScreenAnchor) {
    terrainScreenAnchor.attachment.targetVideoClipId = idMapping.get(terrainScreenAnchor.attachment.targetVideoClipId)
      ?? terrainScreenAnchor.attachment.targetVideoClipId;
  }
  const terrainAnchorConnector = cloneTerrainAnchorConnector(clip.terrainAnchorConnector);
  if (terrainAnchorConnector) {
    terrainAnchorConnector.anchorClipId = idMapping.get(terrainAnchorConnector.anchorClipId)
      ?? terrainAnchorConnector.anchorClipId;
  }
  const trackingBinding = clip.trackingBinding ? structuredClone(clip.trackingBinding) : undefined;
  if (trackingBinding?.targetVideoClipId) {
    trackingBinding.targetVideoClipId = idMapping.get(trackingBinding.targetVideoClipId)
      ?? trackingBinding.targetVideoClipId;
  }
  return {
    planarTracks: clonePlanarTracks(clip.planarTracks),
    terrainAttachment,
    terrainScreenAnchor,
    terrainAnchorConnector,
    trackingBinding,
  };
}
