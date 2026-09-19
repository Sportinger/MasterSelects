import { describe, expect, it } from 'vitest';

import {
  DOCK_RESIZE_HANDLE_SIZE,
  findDockResizeDelegateId,
  getColorTimelinePanelHeight,
  getDirectChildMinimumSize,
  getDockNodeFixedFloor,
  getDockNodeFixedSize,
} from '../../src/components/dock/dockPanelSizing';
import type { DockNode } from '../../src/types/dock';

const clipsPanel: DockNode = {
  kind: 'tab-group',
  id: 'clips',
  panels: [{ id: 'clips-panel', type: 'color-clips', title: 'Clips' }],
  activeIndex: 0,
};
const timelinePanel: DockNode = {
  kind: 'tab-group',
  id: 'mini-timeline',
  panels: [{ id: 'mini-timeline-panel', type: 'color-timeline', title: 'Mini Timeline' }],
  activeIndex: 0,
};
const navigationSplit: DockNode = {
  kind: 'split',
  id: 'navigation',
  direction: 'vertical',
  ratio: 0.5,
  children: [clipsPanel, timelinePanel],
};

describe('dock fixed panel sizing', () => {
  it('keeps fixed panels at their configured content height', () => {
    expect(getDockNodeFixedSize(clipsPanel, 'height')).toBe(134);
    expect(getDockNodeFixedSize(timelinePanel, 'height')).toBe(80);
  });

  it('grows the mini timeline by one complete row for every additional video track', () => {
    expect(getColorTimelinePanelHeight(2)).toBe(80);
    expect(getColorTimelinePanelHeight(3)).toBe(96);
    expect(getColorTimelinePanelHeight(6)).toBe(144);
    expect(getDockNodeFixedSize(timelinePanel, 'height', {
      'color-timeline': { height: getColorTimelinePanelHeight(3) },
    })).toBe(96);
  });

  it('propagates a fixed vertical stack through parent split constraints', () => {
    const expectedHeight = 134 + DOCK_RESIZE_HANDLE_SIZE + 80;
    expect(getDockNodeFixedSize(navigationSplit, 'height')).toBe(expectedHeight);
    expect(getDockNodeFixedFloor(navigationSplit, 'height')).toBe(expectedHeight);
    expect(getDirectChildMinimumSize(navigationSplit, 'height', 150)).toBe(expectedHeight);
  });

  it('delegates a fixed stack resize to the nearest flexible ancestor split', () => {
    const lowerSplit: DockNode = {
      kind: 'split',
      id: 'lower',
      direction: 'vertical',
      ratio: 0.4,
      children: [
        navigationSplit,
        {
          kind: 'tab-group',
          id: 'controls',
          panels: [{ id: 'controls-panel', type: 'color-controls', title: 'Color Controls' }],
          activeIndex: 0,
        },
      ],
    };
    const root: DockNode = {
      kind: 'split',
      id: 'root',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        {
          kind: 'tab-group',
          id: 'preview',
          panels: [{ id: 'preview-panel', type: 'preview', title: 'Preview' }],
          activeIndex: 0,
        },
        lowerSplit,
      ],
    };

    expect(findDockResizeDelegateId(root, 'navigation', 'height')).toBe('root');
    expect(findDockResizeDelegateId(root, 'lower', 'height')).toBe('root');
  });

  it('uses the active tab minimum so Color Controls can shrink responsively', () => {
    const group: DockNode = {
      kind: 'tab-group',
      id: 'responsive-controls',
      panels: [
        { id: 'controls', type: 'color-controls', title: 'Color Controls' },
        { id: 'studio', type: 'ai-studio', title: 'AI Studio' },
      ],
      activeIndex: 0,
    };

    expect(getDirectChildMinimumSize(group, 'width', 150)).toBe(168);
    group.activeIndex = 1;
    expect(getDirectChildMinimumSize(group, 'width', 150)).toBe(360);
  });
});
