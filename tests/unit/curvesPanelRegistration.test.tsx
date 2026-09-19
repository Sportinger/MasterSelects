import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { WheelEventHandler } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/timeline/TimelineGlobalCurveSurface', () => ({
  TimelineGlobalCurveSurface: ({
    onClose,
    onFitSeries,
    onGraphWheel,
    scrollX,
    timeToPixel,
  }: {
    onClose?: () => void;
    onFitSeries?: (timeBounds: { startTime: number; endTime: number }) => void;
    onGraphWheel?: WheelEventHandler<HTMLDivElement>;
    scrollX: number;
    timeToPixel: (time: number) => number;
  }) => (
    <div
      data-testid="shared-curves-surface"
      data-has-close-action={String(Boolean(onClose))}
      data-time-scale={String(timeToPixel(1) - timeToPixel(0))}
      data-view-x-at-five={String(timeToPixel(5) - scrollX)}
      onDoubleClick={() => onFitSeries?.({ startTime: 5, endTime: 10 })}
      onWheelCapture={onGraphWheel}
    />
  ),
}));

import { VIEW_CORE_PANEL_TYPES } from '../../src/components/common/toolbar/viewPanelConfig';
import { DockPanelContent } from '../../src/components/dock/DockPanelContent';
import { CurvesPanel } from '../../src/components/panels/curves/CurvesPanel';
import {
  fitCurveTimeViewToClip,
  panCurveTimeViewHorizontally,
  zoomCurveTimeViewAtPointer,
} from '../../src/components/panels/curves/curvesPanelTimeView';
import { useTimelineCurveMode } from '../../src/components/timeline/hooks/useTimelineCurveMode';
import { useDockStore } from '../../src/stores/dockStore';
import { BUILT_IN_PANEL_TYPES, VALID_PANEL_TYPES } from '../../src/stores/dockStore/panelRegistry';
import { useTimelineStore } from '../../src/stores/timeline';
import { persistStoredTimelineCurveMode } from '../../src/stores/timeline/viewPreferences';
import {
  MULTI_INSTANCE_PANEL_TYPES,
  PANEL_CONFIGS,
  type DockNode,
} from '../../src/types/dock';

function countPanelType(node: DockNode, type: string): number {
  if (node.kind === 'tab-group') {
    return node.panels.filter(panel => panel.type === type).length;
  }
  return countPanelType(node.children[0], type) + countPanelType(node.children[1], type);
}

describe('Curves panel registration', () => {
  it('registers Curves as a discoverable multi-instance panel', () => {
    expect(PANEL_CONFIGS.curves).toMatchObject({
      type: 'curves',
      title: 'Curves',
      minWidth: 360,
      minHeight: 220,
    });
    expect(BUILT_IN_PANEL_TYPES).toContain('curves');
    expect(VALID_PANEL_TYPES.has('curves')).toBe(true);
    expect(VIEW_CORE_PANEL_TYPES).toContain('curves');
    expect(MULTI_INSTANCE_PANEL_TYPES).toContain('curves');
  });

  it('adds multiple independent Curves panel instances instead of focusing one', () => {
    const dock = useDockStore.getState();
    const initialLayout = dock.layout;
    const initialCount = countPanelType(initialLayout.root, 'curves');

    act(() => {
      dock.addPanelTypeToGroup('curves', 'right-group');
      dock.addPanelTypeToGroup('curves', 'right-group');
    });

    expect(countPanelType(useDockStore.getState().layout.root, 'curves')).toBe(initialCount + 2);
    act(() => useDockStore.setState({ layout: initialLayout }));
  });

  it('does not close docked Curves panels when Timeline Graph mode opens', () => {
    const dock = useDockStore.getState();
    const initialLayout = dock.layout;
    act(() => dock.addPanelTypeToGroup('curves', 'right-group'));
    const curvesCount = countPanelType(useDockStore.getState().layout.root, 'curves');
    persistStoredTimelineCurveMode('timeline');
    const controller = renderHook(() => useTimelineCurveMode());

    act(() => controller.result.current.setTimelineCurveMode('graph'));

    expect(countPanelType(useDockStore.getState().layout.root, 'curves')).toBe(curvesCount);
    act(() => useDockStore.setState({ layout: initialLayout }));
    persistStoredTimelineCurveMode('timeline');
  });

  it('loads the shared Curves surface through dock panel content', async () => {
    const { container } = render(
      <DockPanelContent panel={{ id: 'curves', type: 'curves', title: 'Curves' }} />,
    );

    expect(await screen.findByTestId('curves-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId('shared-curves-surface')).toHaveLength(1);
    expect(screen.getByTestId('curves-panel-playhead')).toBeInTheDocument();
    expect(container.querySelectorAll('.timeline-navigator')).toHaveLength(1);
  });

  it('uses the same surface inline in Timeline placement without dock-panel chrome', () => {
    render(
      <CurvesPanel
        variant="timeline"
        width={800}
        height={260}
        trackHeaderWidth={180}
        onClose={vi.fn()}
        onScrollChange={vi.fn()}
        onZoomChange={vi.fn()}
        scrollX={0}
        timeToPixel={time => time * 100}
        pixelToTime={pixel => pixel / 100}
      />,
    );

    expect(screen.queryByTestId('curves-panel')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('shared-curves-surface')).toHaveLength(1);
    expect(screen.getByTestId('shared-curves-surface')).toHaveAttribute(
      'data-has-close-action',
      'true',
    );
    expect(document.querySelector('.timeline-navigator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('curves-panel-playhead')).not.toBeInTheDocument();
  });

  it('fits clip bounds in the active Curves viewport', () => {
    const fitted = fitCurveTimeViewToClip({
      clipStartTime: 5,
      clipDuration: 5,
      compositionDuration: 20,
      viewportWidth: 500,
    });

    expect(fitted).not.toBeNull();
    expect(5 * fitted!.zoom - fitted!.scrollX).toBeCloseTo(24);
    expect(10 * fitted!.zoom - fitted!.scrollX).toBeCloseTo(476);
  });

  it('keeps the pointed time anchored while zooming the local curve view', () => {
    const zoomed = zoomCurveTimeViewAtPointer({
      compositionDuration: 100,
      deltaY: -100,
      pointerX: 200,
      view: { scrollX: 100, zoom: 20 },
      viewportWidth: 500,
    });

    expect(zoomed.zoom).toBeGreaterThan(20);
    expect((zoomed.scrollX + 200) / zoomed.zoom).toBeCloseTo(15);
  });

  it('converts Shift+wheel movement into bounded horizontal time scrolling', () => {
    expect(panCurveTimeViewHorizontally({
      compositionDuration: 100,
      deltaX: 0,
      deltaY: 100,
      view: { scrollX: 25, zoom: 20 },
      viewportWidth: 500,
    })).toEqual({ scrollX: 125, zoom: 20 });
  });

  it('keeps time views local to each standalone Curves instance', () => {
    const selectedClipIds = useTimelineStore.getState().selectedClipIds;
    act(() => useTimelineStore.setState({ selectedClipIds: new Set() }));
    render(
      <>
        <CurvesPanel initialTimeView={{ scrollX: 0, zoom: 10 }} />
        <CurvesPanel initialTimeView={{ scrollX: 25, zoom: 20 }} />
      </>,
    );

    const surfaces = screen.getAllByTestId('shared-curves-surface');
    expect(surfaces[0]).toHaveAttribute('data-view-x-at-five', '50');
    expect(surfaces[1]).toHaveAttribute('data-view-x-at-five', '75');
    act(() => useTimelineStore.setState({ selectedClipIds }));
  });

  it('zooms standalone Curves time with Alt+wheel', () => {
    const selectedClipIds = useTimelineStore.getState().selectedClipIds;
    act(() => useTimelineStore.setState({ selectedClipIds: new Set() }));
    render(<CurvesPanel initialTimeView={{ scrollX: 0, zoom: 20 }} />);

    const surface = screen.getByTestId('shared-curves-surface');
    expect(surface).toHaveAttribute('data-time-scale', '20');
    act(() => {
      surface.dispatchEvent(new WheelEvent('wheel', {
        altKey: true,
        bubbles: true,
        cancelable: true,
        clientX: 300,
        deltaY: -100,
      }));
    });

    expect(Number(surface.dataset.timeScale)).toBeGreaterThan(20);
    act(() => useTimelineStore.setState({ selectedClipIds }));
  });

  it('scrolls standalone Curves time horizontally with Shift+wheel', () => {
    const timeline = useTimelineStore.getState();
    act(() => useTimelineStore.setState({
      duration: 100,
      selectedClipIds: new Set(),
    }));
    render(<CurvesPanel initialTimeView={{ scrollX: 25, zoom: 20 }} />);

    const surface = screen.getByTestId('shared-curves-surface');
    expect(surface).toHaveAttribute('data-view-x-at-five', '75');
    fireEvent.wheel(surface, { deltaY: 100, shiftKey: true });
    expect(surface).toHaveAttribute('data-view-x-at-five', '-25');

    act(() => useTimelineStore.setState({
      duration: timeline.duration,
      selectedClipIds: timeline.selectedClipIds,
    }));
  });

  it('fits the standalone time view to a double-clicked parameter range', () => {
    const timeline = useTimelineStore.getState();
    act(() => useTimelineStore.setState({
      duration: 20,
      selectedClipIds: new Set(),
    }));
    render(<CurvesPanel initialTimeView={{ scrollX: 0, zoom: 20 }} />);

    const surface = screen.getByTestId('shared-curves-surface');
    fireEvent.doubleClick(surface);
    expect(Number(surface.dataset.viewXAtFive)).toBeCloseTo(23.04);

    act(() => useTimelineStore.setState({
      duration: timeline.duration,
      selectedClipIds: timeline.selectedClipIds,
    }));
  });

  it('positions the standalone playhead in its local Curves time view', () => {
    const timeline = useTimelineStore.getState();
    act(() => useTimelineStore.setState({
      playheadPosition: 5,
      selectedClipIds: new Set(),
    }));
    render(<CurvesPanel initialTimeView={{ scrollX: 25, zoom: 20 }} />);

    expect(Number.parseFloat(screen.getByTestId('curves-panel-playhead').style.left))
      .toBeCloseTo(254.2);
    act(() => useTimelineStore.setState({
      playheadPosition: timeline.playheadPosition,
      selectedClipIds: timeline.selectedClipIds,
    }));
  });

  it('keeps the standalone Curves time view separate from Timeline zoom and scroll', async () => {
    const timeline = useTimelineStore.getState();
    act(() => useTimelineStore.setState({
      clips: [{
        id: 'curves-view-clip',
        trackId: 'video-1',
        name: 'Curves View Clip',
        startTime: 5,
        duration: 5,
      }],
      duration: 20,
      propertiesSelection: null,
      selectedClipIds: new Set(['curves-view-clip']),
      scrollX: 123,
      zoom: 37,
    }));

    render(<CurvesPanel />);
    await waitFor(() => {
      expect(Number(screen.getByTestId('shared-curves-surface').dataset.viewXAtFive))
        .toBeGreaterThan(0);
    });
    expect(useTimelineStore.getState().zoom).toBe(37);
    expect(useTimelineStore.getState().scrollX).toBe(123);

    act(() => useTimelineStore.setState({
      clips: timeline.clips,
      duration: timeline.duration,
      propertiesSelection: timeline.propertiesSelection,
      selectedClipIds: timeline.selectedClipIds,
      scrollX: timeline.scrollX,
      zoom: timeline.zoom,
    }));
  });

});
