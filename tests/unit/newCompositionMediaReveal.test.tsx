import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Composition } from '../../src/stores/mediaStore';
import { getLastMediaSourceRevealRequest } from '../../src/services/mediaSourceReveal';
import { useMediaPanelCompositionSettings } from '../../src/components/panels/media/panel/useMediaPanelCompositionSettings';
import { useMediaPanelCreateComposition } from '../../src/components/panels/media/panel/useMediaPanelCreateComposition';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockTrack } from '../helpers/mockData';

describe('new composition visibility in the media panel', () => {
  it('reveals a newly created composition after opening it', () => {
    const createComposition = vi.fn(() => ({ id: 'new-comp', type: 'composition' } as Composition));
    const openCompositionTab = vi.fn();
    const { result } = renderHook(() => useMediaPanelCompositionSettings({
      activeCompositionId: null, closeContextMenu: vi.fn(), createComposition,
      openCompositionTab, updateComposition: vi.fn(),
    }));
    act(() => result.current.openNewCompositionSettings({ name: 'New Comp', parentId: 'folder-1' }));
    act(() => result.current.saveCompositionSettings());
    expect(openCompositionTab).toHaveBeenCalledWith('new-comp');
    expect(getLastMediaSourceRevealRequest()).toMatchObject({ mediaFileId: 'new-comp', source: 'media-panel' });
    expect(result.current.settingsDialog).toBeNull();
  });

  it('reveals the composition created from an existing media item after population', async () => {
    const composition = {
      id: 'from-media', type: 'composition',
      timelineData: { tracks: [createMockTrack({ id: 'video-1', type: 'video' })] },
    } as Composition;
    const source = { id: 'source-comp', type: 'composition', name: 'Source', duration: 5, width: 1920, height: 1080, frameRate: 25 } as Composition;
    const originalAddCompClip = useTimelineStore.getState().addCompClip;
    const addCompClip = vi.fn().mockResolvedValue(undefined);
    useTimelineStore.setState({ addCompClip });
    const { result, unmount } = renderHook(() => useMediaPanelCreateComposition({
      contextMenu: null, createComposition: vi.fn(() => composition), updateComposition: vi.fn(),
      openCompositionTab: vi.fn(), getActiveParentId: () => null,
      showFloatingText: vi.fn(), closeContextMenu: vi.fn(),
    }));
    try {
      await act(async () => result.current(source));
      expect(addCompClip).toHaveBeenCalledWith('video-1', source, 0);
      expect(getLastMediaSourceRevealRequest()).toMatchObject({ mediaFileId: 'from-media', source: 'media-panel' });
    } finally {
      unmount();
      useTimelineStore.setState({ addCompClip: originalAddCompClip });
    }
  });
});
