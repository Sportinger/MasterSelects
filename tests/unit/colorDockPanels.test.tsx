import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ColorKeyframesPanel } from '../../src/components/panels/color-workspace/ColorKeyframesPanel';
import {
  FACTORY_COLOR_LAYOUT_ID,
  getFactoryDockLayouts,
} from '../../src/stores/dockStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { PANEL_CONFIGS, type DockNode, type DockSplit, type PanelInstance, type PanelType } from '../../src/types/dock';
import type { TimelineClip } from '../../src/types/timeline';

const initialTimelineState = useTimelineStore.getState();

function collectPanelTypes(node: DockNode): PanelType[] {
  if (node.kind === 'tab-group') return node.panels.map(panel => panel.type);
  return [...collectPanelTypes(node.children[0]), ...collectPanelTypes(node.children[1])];
}

function collectPanels(node: DockNode): PanelInstance[] {
  if (node.kind === 'tab-group') return node.panels;
  return [...collectPanels(node.children[0]), ...collectPanels(node.children[1])];
}

function findSplit(node: DockNode, id: string): DockSplit | null {
  if (node.kind === 'tab-group') return null;
  if (node.id === id) return node;
  return findSplit(node.children[0], id) ?? findSplit(node.children[1], id);
}

afterEach(() => {
  cleanup();
  useTimelineStore.setState(initialTimelineState);
});

describe('Color dock panels', () => {
  it('builds the factory Color layout from separate dock panels', () => {
    const colorLayout = getFactoryDockLayouts().find(layout => layout.id === FACTORY_COLOR_LAYOUT_ID);
    expect(colorLayout).toBeDefined();

    const panelTypes = collectPanelTypes(colorLayout!.layout.root);
    expect(panelTypes).toEqual(expect.arrayContaining([
      'preview',
      'color-nodes',
      'color-clips',
      'color-timeline',
      'color-controls',
      'color-scopes',
      'color-keyframes',
    ]));
    expect(panelTypes).not.toEqual(expect.arrayContaining(['media', 'looks']));
    expect(panelTypes).not.toContain('color-workspace');
    expect(collectPanels(colorLayout!.layout.root).find(panel => panel.type === 'color-timeline')?.title)
      .toBe('Mini Timeline');
    expect(PANEL_CONFIGS['color-clips'].fixedHeight).toBe(134);
    expect(PANEL_CONFIGS['color-timeline'].fixedHeight).toBe(80);
    expect(findSplit(colorLayout!.layout.root, 'color-root-split')?.ratio).toBe(0.5);
  });

  it('renders an empty keyframe panel with a stable store snapshot', () => {
    useTimelineStore.setState({
      clips: [{
        id: 'color-clip',
        trackId: 'video-1',
        name: 'Color clip',
        startTime: 0,
        duration: 10,
      } as TimelineClip],
      clipKeyframes: new Map(),
      playheadPosition: 0,
    });

    render(<ColorKeyframesPanel clipId="color-clip" />);

    expect(screen.getByText('Keyframes')).toBeInTheDocument();
    expect(screen.getByText('Master')).toBeInTheDocument();
    expect(screen.getByText('Corrector')).toBeInTheDocument();
  });
});
