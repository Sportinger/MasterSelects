import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestRender = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: { requestRender },
}));

import { publishLayerTransformPreview } from '../../src/components/preview/publishLayerTransformPreview';
import { useTimelineStore } from '../../src/stores/timeline';

describe('publishLayerTransformPreview', () => {
  beforeEach(() => {
    requestRender.mockClear();
    useTimelineStore.setState({ layerTransformPreview: null });
  });

  it('publishes the transient scale and wakes rendering immediately', () => {
    publishLayerTransformPreview('preview-owner', 'clip-1', {
      scale: { x: 1.5, y: 0.75 },
    });

    expect(useTimelineStore.getState().layerTransformPreview).toEqual({
      ownerId: 'preview-owner',
      clipId: 'clip-1',
      transform: { scale: { x: 1.5, y: 0.75 } },
    });
    expect(requestRender).toHaveBeenCalledOnce();
  });
});
