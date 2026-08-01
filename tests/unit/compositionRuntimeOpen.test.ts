import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const track = {
    id: 'video-1',
    name: 'Video 1',
    type: 'video' as const,
    height: 64,
    muted: false,
    visible: true,
    solo: false,
  };
  const mediaState = {
    activeCompositionId: null as string | null,
    compositions: [{
      id: 'composition-target',
      timelineData: { tracks: [track] },
    }],
    openCompositionTab: vi.fn(),
  };
  const timelineState = { tracks: [track] };
  return { mediaState, timelineState };
});

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => mocks.mediaState },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: { getState: () => mocks.timelineState },
}));

vi.mock('../../src/services/compositionRenderer', () => ({
  compositionRenderer: { invalidateCompositionAndParents: vi.fn() },
}));

vi.mock('../../src/services/logger', () => ({
  Logger: { create: () => ({ warn: vi.fn() }) },
}));

import { openComposition } from '../../src/services/aiTools/handlers/stressTest/compositionRuntime';

describe('composition runtime switching', () => {
  it('awaits the real composition load before accepting matching track ids as ready', async () => {
    let finishSwitch!: () => void;
    mocks.mediaState.activeCompositionId = null;
    mocks.mediaState.openCompositionTab.mockImplementation(() => new Promise<void>((resolve) => {
      finishSwitch = () => {
        mocks.mediaState.activeCompositionId = 'composition-target';
        resolve();
      };
    }));

    let settled = false;
    const opening = openComposition('composition-target').then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    finishSwitch();
    await opening;

    expect(settled).toBe(true);
    expect(mocks.mediaState.openCompositionTab).toHaveBeenCalledWith(
      'composition-target',
      { skipAnimation: true },
    );
  });
});
