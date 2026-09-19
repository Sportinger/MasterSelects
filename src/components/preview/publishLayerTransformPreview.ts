import { renderHostPort } from '../../services/render/renderHostPort';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineLayerTransformPreview } from '../../stores/timeline/storeTypes/toolTypes';

/** Publishes an ephemeral transform and wakes the renderer in the same frame. */
export function publishLayerTransformPreview(
  ownerId: string,
  clipId: string,
  transform: TimelineLayerTransformPreview['transform'],
): void {
  useTimelineStore.setState({
    layerTransformPreview: { ownerId, clipId, transform },
  });
  renderHostPort.requestRender();
}
