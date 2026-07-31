import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTimelineGraphController } from '../../src/components/timeline/hooks/useTimelineGraphController';
import {
  findTimelineVerticalSplit,
  planTimelineGraphPanelExpansion,
  useTimelineGraphPanelResize,
} from '../../src/components/timeline/hooks/useTimelineGraphPanelResize';
import { useDockStore } from '../../src/stores/dockStore';
import type { AnimatableProperty } from '../../src/types/animationProperties';
import type { DockNode } from '../../src/types/dock';
import { createMockClip } from '../helpers/mockData';

describe('useTimelineGraphController', () => {
  it('routes property entry, series focus, and close through one Graph mode', () => {
    const firstClip = createMockClip({ id: 'clip-a', trackId: 'video-1' });
    const secondClip = createMockClip({ id: 'clip-b', trackId: 'video-2' });
    const setTimelineCurveMode = vi.fn();
    const toggleCurveExpanded = vi.fn();
    const expandedCurveProperties = new Map<string, ReadonlySet<AnimatableProperty>>([
      ['video-1', new Set<AnimatableProperty>(['opacity'])],
    ]);
    const { result } = renderHook(() => useTimelineGraphController({
      clips: [firstClip, secondClip],
      expandedCurveProperties,
      selectedClipIds: new Set([firstClip.id, secondClip.id]),
      setTimelineCurveMode,
      timelineCurveMode: 'timeline',
      toggleCurveExpanded,
    }));

    act(() => result.current.openTimelineGraphForProperty('video-1', 'opacity'));
    expect(result.current.preferredTimelineGraphTarget).toEqual({
      clipId: firstClip.id,
      property: 'opacity',
    });
    expect(toggleCurveExpanded).not.toHaveBeenCalled();
    expect(setTimelineCurveMode).toHaveBeenLastCalledWith('graph');

    act(() => result.current.focusTimelineGraphSeries({
      clipId: secondClip.id,
      property: 'rotation.z',
    }));
    expect(result.current.preferredTimelineGraphTarget).toEqual({
      clipId: secondClip.id,
      property: 'rotation.z',
    });
    expect(toggleCurveExpanded).toHaveBeenCalledWith('video-2', 'rotation.z');
    expect(setTimelineCurveMode).toHaveBeenLastCalledWith('graph');

    act(() => result.current.closeTimelineGraph());
    expect(setTimelineCurveMode).toHaveBeenLastCalledWith('timeline');
  });

  it('expands a short bottom Timeline upward and preserves an adequate panel', () => {
    expect(planTimelineGraphPanelExpansion({
      childHeight: 280,
      splitHeight: 900,
      splitRatio: 0.69,
      timelineChildIndex: 1,
      timelineContentHeight: 250,
    })).toBeCloseTo(0.5);

    expect(planTimelineGraphPanelExpansion({
      childHeight: 460,
      splitHeight: 900,
      splitRatio: 0.49,
      timelineChildIndex: 1,
      timelineContentHeight: 430,
    })).toBeNull();
  });

  it('finds the vertical split that owns a docked Timeline on either side', () => {
    const timelineGroup: DockNode = {
      kind: 'tab-group',
      id: 'timeline-group',
      panels: [{ id: 'timeline', type: 'timeline', title: 'Timeline' }],
      activeIndex: 0,
    };
    const previewGroup: DockNode = {
      kind: 'tab-group',
      id: 'preview-group',
      panels: [{ id: 'preview', type: 'preview', title: 'Preview' }],
      activeIndex: 0,
    };
    const root: DockNode = {
      kind: 'split',
      id: 'root-split',
      direction: 'vertical',
      ratio: 0.67,
      children: [previewGroup, timelineGroup],
    };

    expect(findTimelineVerticalSplit(root)).toMatchObject({
      split: { id: 'root-split' },
      timelineChildIndex: 1,
    });
    expect(findTimelineVerticalSplit({
      ...root,
      children: [timelineGroup, previewGroup],
    })).toMatchObject({ timelineChildIndex: 0 });
  });

  it('restores the exact prior dock ratio after the Graph closes', () => {
    const originalLayout = useDockStore.getState().layout;
    const timelineGroup: DockNode = {
      kind: 'tab-group',
      id: 'timeline-group',
      panels: [{ id: 'timeline', type: 'timeline', title: 'Timeline' }],
      activeIndex: 0,
    };
    const previewGroup: DockNode = {
      kind: 'tab-group',
      id: 'preview-group',
      panels: [{ id: 'preview', type: 'preview', title: 'Preview' }],
      activeIndex: 0,
    };
    useDockStore.setState({
      layout: {
        root: {
          kind: 'split',
          id: 'graph-resize-test-split',
          direction: 'vertical',
          ratio: 0.69,
          children: [previewGroup, timelineGroup],
        },
        floatingPanels: [],
        panelZoom: {},
      },
    });

    const splitElement = document.createElement('div');
    splitElement.className = 'dock-split vertical';
    splitElement.dataset.splitId = 'graph-resize-test-split';
    const firstChild = document.createElement('div');
    firstChild.className = 'dock-split-child';
    const secondChild = document.createElement('div');
    secondChild.className = 'dock-split-child';
    const panelContent = document.createElement('div');
    panelContent.className = 'dock-panel-content';
    panelContent.dataset.panelType = 'timeline';
    const timelineElement = document.createElement('div');
    timelineElement.className = 'timeline-container';
    panelContent.append(timelineElement);
    secondChild.append(panelContent);
    splitElement.append(firstChild, secondChild);
    document.body.append(splitElement);
    vi.spyOn(splitElement, 'getBoundingClientRect').mockReturnValue({ height: 900 } as DOMRect);
    vi.spyOn(secondChild, 'getBoundingClientRect').mockReturnValue({ height: 280 } as DOMRect);
    vi.spyOn(timelineElement, 'getBoundingClientRect').mockReturnValue({ height: 250 } as DOMRect);

    let rendered: ReturnType<typeof renderHook> | null = null;
    try {
      rendered = renderHook(
        ({ mode }: { mode: 'timeline' | 'graph' }) => useTimelineGraphPanelResize(mode),
        { initialProps: { mode: 'graph' as const } },
      );
      const expandedRoot = useDockStore.getState().layout.root;
      expect(expandedRoot.kind).toBe('split');
      if (expandedRoot.kind !== 'split') throw new Error('Expected split root');
      expect(expandedRoot.ratio).toBeCloseTo(0.5);

      rendered.rerender({ mode: 'timeline' });
      const restoredRoot = useDockStore.getState().layout.root;
      expect(restoredRoot.kind).toBe('split');
      if (restoredRoot.kind !== 'split') throw new Error('Expected split root');
      expect(restoredRoot.ratio).toBe(0.69);
    } finally {
      rendered?.unmount();
      splitElement.remove();
      useDockStore.setState({ layout: originalLayout });
    }
  });
});
