import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from '../../src/stores/timeline';

const { requestNewFrameRender } = vi.hoisted(() => ({
  requestNewFrameRender: vi.fn(),
}));

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: {
    requestNewFrameRender,
  },
}));

describe('timeline export preview recovery', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useTimelineStore.setState({
      isExporting: false,
      exportProgress: null,
      exportCurrentTime: null,
      exportRange: null,
      exportPreviewFrame: null,
      exportPreviewFrameTime: null,
    });
  });

  it('requests a fresh preview frame whenever export mode ends', () => {
    useTimelineStore.getState().startExport(0, 10);
    useTimelineStore.getState().endExport();

    expect(useTimelineStore.getState()).toMatchObject({
      isExporting: false,
      exportProgress: null,
      exportCurrentTime: null,
      exportRange: null,
      exportPreviewFrame: null,
      exportPreviewFrameTime: null,
    });
    expect(requestNewFrameRender).toHaveBeenCalledTimes(1);
  });
});
