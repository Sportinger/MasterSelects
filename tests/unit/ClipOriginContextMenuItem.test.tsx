import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipOriginContextMenuItem } from '../../src/components/timeline/ClipOriginContextMenuItem';
import type { TimelineClip } from '../../src/types/timeline';

const mocks = vi.hoisted(() => ({
  disablePropertyKeyframes: vi.fn(),
  endBatch: vi.fn(),
  resolveThreeDOriginCenter: vi.fn(),
  startBatch: vi.fn(),
}));

vi.mock('../../src/stores/historyStore', () => ({
  endBatch: mocks.endBatch,
  startBatch: mocks.startBatch,
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({ disablePropertyKeyframes: mocks.disablePropertyKeyframes }),
  },
}));

vi.mock('../../src/services/threeDOriginCenter', () => ({
  resolveThreeDOriginCenter: mocks.resolveThreeDOriginCenter,
  supportsOriginToCenter: () => true,
}));

describe('Origin to Center context action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveThreeDOriginCenter.mockResolvedValue({ x: 1, y: -2, z: 3 });
  });

  it('sets all three anchor and position axes in one batch', async () => {
    const clip = { id: 'splat-1', source: { type: 'gaussian-splat' } } as TimelineClip;
    const onDone = vi.fn();
    render(<ClipOriginContextMenuItem clip={clip} canModify onDone={onDone} />);

    fireEvent.click(screen.getByText('Origin to Center'));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(mocks.startBatch).toHaveBeenCalledWith('Origin to center');
    expect(mocks.disablePropertyKeyframes.mock.calls).toEqual([
      ['splat-1', 'anchor.x', 1],
      ['splat-1', 'anchor.y', -2],
      ['splat-1', 'anchor.z', 3],
      ['splat-1', 'position.x', 0],
      ['splat-1', 'position.y', 0],
      ['splat-1', 'position.z', 0],
    ]);
    expect(mocks.endBatch).toHaveBeenCalledOnce();
  });
});
