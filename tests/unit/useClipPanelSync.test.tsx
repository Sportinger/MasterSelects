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
import { handleSelectClips } from '../../src/services/aiTools/handlers/clips/selection';
import { selectClipAndOpenTab } from '../../src/services/aiTools/aiFeedback';
import { setAIExecutionActive } from '../../src/services/aiTools/executionState';

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
    setAIExecutionActive(false);
    vi.useRealTimers();
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

  it.each(['native', 'bridge', 'off'] as const)('keeps the current panel for %s agent selection even after execution ends', async mode => {
    seedSelectedClip();
    const activate = vi.spyOn(useDockStore.getState(), 'activatePanelType').mockImplementation(() => undefined);
    renderHook(() => useClipPanelSync());
    activate.mockClear();
    await act(async () => {
      setAIExecutionActive(true, mode);
      await handleSelectClips({ clipIds: ['selected-clip'] }, useTimelineStore.getState());
      setAIExecutionActive(false);
    });
    expect([...useTimelineStore.getState().selectedClipIds]).toEqual(['selected-clip']);
    expect(useTimelineStore.getState().propertiesSelection).toMatchObject({ kind: 'clip', clipId: 'selected-clip' });
    expect(activate).not.toHaveBeenCalled();
    act(() => useTimelineStore.setState({ clips: [...useTimelineStore.getState().clips] }));
    expect(activate).not.toHaveBeenCalled();
    act(() => useTimelineStore.getState().selectClip('selected-clip'));
    expect(activate).toHaveBeenCalledExactlyOnceWith('clip-properties');
  });

  it('prepares the agent effect inspector tab without bringing Properties in front', async () => {
    vi.useFakeTimers();
    seedSelectedClip();
    const activate = vi.spyOn(useDockStore.getState(), 'activatePanelType').mockImplementation(() => undefined);
    const tabRequest = vi.fn();
    window.addEventListener('openPropertiesTab', tabRequest);
    try {
      renderHook(() => useClipPanelSync());
      activate.mockClear();
      act(() => {
        setAIExecutionActive(true);
        selectClipAndOpenTab('selected-clip', 'effects');
        setAIExecutionActive(false);
      });
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(tabRequest).toHaveBeenCalledOnce();
      expect((tabRequest.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: 'effects' });
      expect(activate).not.toHaveBeenCalled();
    } finally { window.removeEventListener('openPropertiesTab', tabRequest); }
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
