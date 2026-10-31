import { afterEach, describe, expect, it, vi } from 'vitest';

const bake = vi.hoisted(() => ({
  cancel: vi.fn(),
  resolveExport: null as ((blob: Blob | null) => void) | null,
}));

vi.mock('../../src/engine/export', () => {
  class FrameExporter {
    static checkCodecSupport = vi.fn(async () => true);
    static getRecommendedBitrate = vi.fn(() => 8_000_000);
    cancel = () => {
      bake.cancel();
      bake.resolveExport?.(null);
    };
    export(): Promise<Blob | null> {
      return new Promise((resolve) => { bake.resolveExport = resolve; });
    }
  }
  return { FrameExporter };
});

vi.mock('../../src/services/videoBakeProxyCache', () => ({
  videoBakeProxyCache: {
    remove: vi.fn(),
    registerCompositionArtifact: vi.fn(async () => undefined),
  },
}));

import { useTimelineStore } from '../../src/stores/timeline';

describe('composition video bake cancellation', () => {
  afterEach(() => {
    bake.cancel.mockReset();
    bake.resolveExport = null;
  });

  it.each(['unbake', 'remove'] as const)('stops the running bake render on %s', async (action) => {
    useTimelineStore.setState({ duration: 10, videoBakeRegions: [] });
    const regionId = useTimelineStore.getState().addCompositionVideoBakeRegion(0, 2);
    if (!regionId) throw new Error('bake region was not created');

    const baking = useTimelineStore.getState().bakeCompositionVideoBakeRegion(regionId);
    await vi.waitFor(() => expect(bake.resolveExport).not.toBeNull());

    if (action === 'unbake') useTimelineStore.getState().unbakeCompositionVideoBakeRegion(regionId);
    else useTimelineStore.getState().removeCompositionVideoBakeRegion(regionId);

    expect(bake.cancel).toHaveBeenCalledOnce();
    await expect(baking).resolves.toBe(false);
  });
});
