import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClipPanelSync } from '../../src/hooks/useClipPanelSync';
import {
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  useDockStore,
} from '../../src/stores/dockStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  acquireExclusiveTimelineMutationLease,
  releaseExclusiveTimelineMutationLease,
} from '../../src/stores/timeline/exclusiveMutationLease';
import type { TimelineClip } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialDockState = useDockStore.getState();

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
    useDockStore.setState({
      activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      layout: initialDockState.layout,
    });
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

  it('reactivates clip properties when an already-selected clip is clicked again', () => {
    seedSelectedClip();
    const activatePanelType = vi
      .spyOn(useDockStore.getState(), 'activatePanelType')
      .mockImplementation(() => undefined);

    renderHook(() => useClipPanelSync());
    activatePanelType.mockClear();

    act(() => useTimelineStore.getState().selectClip('selected-clip'));

    expect(activatePanelType).toHaveBeenCalledOnce();
    expect(activatePanelType).toHaveBeenCalledWith('clip-properties');
  });

  it('keeps a restored Color workspace open even without an active layout id', () => {
    seedSelectedClip();
    const colorLayout = useDockStore.getState().savedLayouts.find(
      layout => layout.id === FACTORY_COLOR_LAYOUT_ID,
    )?.layout;
    expect(colorLayout).toBeDefined();
    useDockStore.setState({
      activeSavedLayoutId: null,
      layout: colorLayout!,
    });
    const activatePanelType = vi
      .spyOn(useDockStore.getState(), 'activatePanelType')
      .mockImplementation(() => undefined);

    renderHook(() => useClipPanelSync());

    expect(activatePanelType).not.toHaveBeenCalled();
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
