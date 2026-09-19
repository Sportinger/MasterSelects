import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mediaStoreState = vi.hoisted(() => ({
  folders: [],
  createFolder: vi.fn(),
  importFiles: vi.fn(),
  importFilesWithHandles: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
}));

import { useDroppedTimelineMediaFiles } from '../../src/components/timeline/hooks/useDroppedTimelineMediaFiles';

type DroppedMediaActions = Parameters<typeof useDroppedTimelineMediaFiles>[0];

const stableActions: Omit<DroppedMediaActions, 'addClip'> = {
  addTrack: () => 'track-1',
  addSignalAssetClip: vi.fn() as DroppedMediaActions['addSignalAssetClip'],
};

describe('external drop callback identity', () => {
  it('stays stable across playhead renders and refreshes when a drop action changes', () => {
    const initialAddClip = vi.fn() as DroppedMediaActions['addClip'];
    const replacementAddClip = vi.fn() as DroppedMediaActions['addClip'];
    const { result, rerender } = renderHook(
      ({ addClip, playheadPosition }: { addClip: DroppedMediaActions['addClip']; playheadPosition: number }) => {
        void playheadPosition;
        return useDroppedTimelineMediaFiles({ ...stableActions, addClip });
      },
      { initialProps: { addClip: initialAddClip, playheadPosition: 0 } },
    );

    const initialDropFiles = result.current;
    rerender({ addClip: initialAddClip, playheadPosition: 1 });
    expect(result.current).toBe(initialDropFiles);

    rerender({ addClip: replacementAddClip, playheadPosition: 1 });
    expect(result.current).not.toBe(initialDropFiles);
  });
});
