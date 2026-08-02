import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClipPanelSync } from '../../src/hooks/useClipPanelSync';
import { useDockStore } from '../../src/stores/dockStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  acquireExclusiveTimelineMutationLease,
  releaseExclusiveTimelineMutationLease,
} from '../../src/stores/timeline/exclusiveMutationLease';
import type { TimelineClip } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

function seedSelectedClip(): void {
  useTimelineStore.setState({
    clips: [{ id: 'selected-clip' } as TimelineClip],
    selectedClipIds: new Set(['selected-clip']),
    propertiesSelection: null,
  });
}

describe('useClipPanelSync', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useTimelineStore.setState(initialTimelineState);
  });

  it('activates clip properties for a regular editor selection', () => {
    seedSelectedClip();
    const activatePanelType = vi
      .spyOn(useDockStore.getState(), 'activatePanelType')
      .mockImplementation(() => undefined);

    renderHook(() => useClipPanelSync());

    expect(activatePanelType).toHaveBeenCalledOnce();
    expect(activatePanelType).toHaveBeenCalledWith('clip-properties');
  });

  it('does not mutate dock state or crash React while a kernel edit owns the lease', () => {
    seedSelectedClip();
    const activatePanelType = vi
      .spyOn(useDockStore.getState(), 'activatePanelType')
      .mockImplementation(() => {
        throw new Error('dock mutation must not run while the lease is active');
      });
    const lease = acquireExclusiveTimelineMutationLease('Very Fast regression');

    try {
      expect(() => renderHook(() => useClipPanelSync())).not.toThrow();
      expect(activatePanelType).not.toHaveBeenCalled();
    } finally {
      releaseExclusiveTimelineMutationLease(lease);
    }
  });
});
