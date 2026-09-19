import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMocks = vi.hoisted(() => ({
  track: vi.fn(),
  trackTimelineEdit: vi.fn(),
}));

vi.mock('../../src/services/productAnalytics', () => ({
  productAnalytics: { track: analyticsMocks.track },
  trackTimelineEdit: analyticsMocks.trackTimelineEdit,
}));

import { createHistoryFacade } from '../../src/stores/historyStore/historyFacade';
import type { HistoryState } from '../../src/stores/historyStore/historyStoreTypes';

function createAccessor(batchLabel: string | null = null) {
  const state = {
    batchId: batchLabel ? 1 : null,
    batchLabel,
    captureSnapshot: vi.fn(),
    endBatch: vi.fn(() => {
      state.batchId = null;
      state.batchLabel = null;
    }),
  } as unknown as HistoryState;
  return { getState: () => state };
}

describe('history analytics gesture boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports a batched slider gesture once at commit, not once per change', () => {
    const accessor = createAccessor('Adjust effect');
    const facade = createHistoryFacade(accessor);

    facade.captureSnapshot('Adjust effect');
    facade.captureSnapshot('Adjust effect');
    expect(analyticsMocks.trackTimelineEdit).not.toHaveBeenCalled();

    facade.endBatch();
    expect(analyticsMocks.trackTimelineEdit).toHaveBeenCalledOnce();
    expect(analyticsMocks.trackTimelineEdit).toHaveBeenCalledWith('Adjust effect');
  });

  it('reports a discrete snapshot immediately', () => {
    const facade = createHistoryFacade(createAccessor());
    facade.captureSnapshot('Add effect');
    expect(analyticsMocks.trackTimelineEdit).toHaveBeenCalledWith('Add effect');
  });
});
