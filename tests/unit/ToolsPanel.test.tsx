import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolsPanel } from '../../src/components/panels/tools/ToolsPanel';
import { zoomViewAroundPoint } from '../../src/components/preview/usePreviewCanvasToolPointer';
import { useRegisterTimelineLayerSyncOwner } from '../../src/components/timeline/hooks/timelineLayerSyncOwners';
import { useCanvasToolStore } from '../../src/stores/canvasToolStore';
import { useTimelineStore } from '../../src/stores/timeline';

describe('canvas zoom around a point', () => {
  it('keeps the clicked point fixed on screen', () => {
    const container = { width: 1000, height: 600 };
    const pan = { x: 40, y: -20 };
    const point = { x: 700, y: 200 };
    const next = zoomViewAroundPoint(point, container, 1, pan, 2);
    // The world point under the pointer maps back to the same screen point.
    const worldX = (point.x - container.width / 2 - pan.x) / 1;
    const worldY = (point.y - container.height / 2 - pan.y) / 1;
    expect(container.width / 2 + next.pan.x + worldX * next.zoom).toBeCloseTo(point.x);
    expect(container.height / 2 + next.pan.y + worldY * next.zoom).toBeCloseTo(point.y);
    expect(zoomViewAroundPoint(point, container, 1, pan, 1000).zoom).toBe(150);
  });
});

describe('Tools panel', () => {
  beforeEach(() => {
    useCanvasToolStore.setState({ activeCanvasTool: 'move', toolTarget: 'canvas' });
    useTimelineStore.setState({ selectedClipIds: new Set(), maskEditMode: 'none', maskPanelActive: false });
    useTimelineStore.getState().setActiveTimelineTool('select');
  });

  afterEach(cleanup);

  it('switches canvas tools by button and by shortcut', () => {
    render(<ToolsPanel />);
    expect(screen.getByRole('button', { name: 'Move' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Hand' }));
    expect(useCanvasToolStore.getState().activeCanvasTool).toBe('hand');

    fireEvent.keyDown(window, { key: 'z' });
    expect(useCanvasToolStore.getState().activeCanvasTool).toBe('zoom');
    expect(screen.getByRole('button', { name: 'Zoom' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('needs a selected layer for the mask tools', () => {
    render(<ToolsPanel />);
    expect((screen.getByRole('button', { name: 'Rectangle mask' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows and drives the timeline tool groups when the timeline is the target', () => {
    const owner = renderHook(() => useRegisterTimelineLayerSyncOwner());
    useCanvasToolStore.setState({ toolTarget: 'timeline' });
    render(<ToolsPanel />);

    fireEvent.click(screen.getByRole('button', { name: /^Cut:/ }));
    expect(useTimelineStore.getState().activeTimelineToolId).toBe('blade');

    // Canvas shortcuts stay out of the timeline's way.
    fireEvent.keyDown(window, { key: 'h' });
    expect(useCanvasToolStore.getState().activeCanvasTool).toBe('move');
    owner.unmount();
  });
});
