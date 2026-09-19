import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  GlobalCurveEditor,
  type GlobalCurveApplyTimelineEditOperation,
} from '../../src/components/timeline/GlobalCurveEditor';
import {
  scaleCurveGraphModelRanges,
  TimelineGlobalCurveSurface,
  type TimelineGraphTarget,
} from '../../src/components/timeline/TimelineGlobalCurveSurface';
import { buildCurveGraphModel } from '../../src/components/timeline/utils/curveGraphModel';
import { propertyRegistry } from '../../src/services/properties';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import type { TimelineClipDragPreview } from '../../src/stores/timeline/types';
import type { ClipTrimState } from '../../src/components/timeline/types';
import { createMockClip } from '../helpers/mockData';

function makeClip(): TimelineClip {
  return createMockClip({
    id: 'graph-clip',
    name: 'Graph Clip',
    startTime: 5,
    duration: 5,
    source: { type: 'video', naturalDuration: 10 },
  });
}

function makeKeyframe(
  id: string,
  property: Keyframe['property'],
  time: number,
  value: number,
): Keyframe {
  return {
    id,
    clipId: 'graph-clip',
    property,
    time,
    value,
    easing: 'bezier',
  };
}

function createModel(selectedKeyframeIds = new Set(['opacity-a'])) {
  const clip = makeClip();
  return buildCurveGraphModel({
    propertyTargets: [
      { clipId: clip.id, path: 'opacity', descriptor: propertyRegistry.getDescriptor('opacity', clip)! },
      { clipId: clip.id, path: 'rotation.z', descriptor: propertyRegistry.getDescriptor('rotation.z', clip)! },
    ],
    clips: [clip],
    clipKeyframes: new Map([[clip.id, [
      makeKeyframe('opacity-a', 'opacity', 1, 0.2),
      makeKeyframe('opacity-b', 'opacity', 3, 0.8),
      makeKeyframe('rotation-a', 'rotation.z', 2, 30),
      makeKeyframe('rotation-b', 'rotation.z', 4, 90),
    ]]]),
    selectedKeyframeIds,
  });
}

function createApplyOperationMock() {
  return vi.fn<GlobalCurveApplyTimelineEditOperation>((operation) => ({
    success: true,
    operationId: operation.id,
    changedClipIds: [],
    warnings: [],
  }));
}

function TimelineGlobalCurveSurfaceHarness({
  clipDragPreview = null,
  clipTrim = null,
  onFitSeries,
}: {
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
  onFitSeries?: (timeBounds: { startTime: number; endTime: number }) => void;
} = {}) {
  const clip = React.useMemo(() => makeClip(), []);
  const [preferredTarget, setPreferredTarget] = React.useState<TimelineGraphTarget>({
    clipId: clip.id,
    property: 'opacity',
  });
  const clipKeyframes = React.useMemo(() => new Map([[clip.id, [
    makeKeyframe('opacity-start', 'opacity', 0, 0),
    makeKeyframe('opacity-a', 'opacity', 1, 0.2),
    makeKeyframe('opacity-b', 'opacity', 3, 0.8),
    makeKeyframe('opacity-tail', 'opacity', 4, 1),
    makeKeyframe('opacity-end', 'opacity', 5, 0),
    makeKeyframe('rotation-a', 'rotation.z', 2, 30),
    makeKeyframe('rotation-b', 'rotation.z', 4, 90),
  ]]]), [clip.id]);

  return (
    <TimelineGlobalCurveSurface
      activeComposition={null}
      applyTimelineEditOperation={createApplyOperationMock()}
      clipKeyframes={clipKeyframes}
      clipDragPreview={clipDragPreview}
      clipTrim={clipTrim}
      clips={[clip]}
      height={260}
      onActiveSeriesChange={setPreferredTarget}
      onFitSeries={onFitSeries}
      onSelectKeyframe={vi.fn()}
      pixelToTime={(pixel) => pixel / 100}
      preferredTarget={preferredTarget}
      scrollX={0}
      selectedClipIds={new Set([clip.id])}
      selectedKeyframeIds={new Set()}
      timeToPixel={(time) => time * 100}
      trackHeaderWidth={240}
      width={760}
    />
  );
}

describe('GlobalCurveEditor', () => {
  it('keeps a recognizable graph grid and mode label when no curves are available', () => {
    const emptyModel = buildCurveGraphModel({
      propertyTargets: [],
      clips: [],
      clipKeyframes: new Map(),
      selectedKeyframeIds: new Set(),
    });
    const { container } = render(
      <GlobalCurveEditor
        model={emptyModel}
        width={1_000}
        height={240}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
        onSelectKeyframe={vi.fn()}
        applyTimelineEditOperation={createApplyOperationMock()}
      />,
    );

    expect(screen.getByRole('img', { name: 'Global property curve editor' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Graph mode');
    expect(container.querySelectorAll('.global-curve-editor-empty-grid line')).toHaveLength(17);
  });

  it('can render without the compact legend when an external parameter list owns series controls', () => {
    render(
      <GlobalCurveEditor
        model={createModel()}
        width={1_000}
        height={240}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
        onSelectKeyframe={vi.fn()}
        applyTimelineEditOperation={createApplyOperationMock()}
        showLegend={false}
      />,
    );

    expect(screen.queryByRole('tablist', { name: 'Curve series' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Global property curve editor' })).toBeInTheDocument();
  });

  it('lists graph parameters on the left and supports view-only per-series visibility', () => {
    const { container } = render(<TimelineGlobalCurveSurfaceHarness />);

    expect(screen.getByRole('complementary', { name: 'Graph parameters' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Opacity/ })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll('.global-curve-editor-series')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Hide Opacity curve' }));

    expect(screen.getByRole('button', { name: 'Show Opacity curve' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('tab', { name: /Rotation/ })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelectorAll('.global-curve-editor-series')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Show all curves' }));
    expect(container.querySelectorAll('.global-curve-editor-series')).toHaveLength(2);
  });

  it('scales curve height with Shift+wheel only from the dark parameter sidebar', () => {
    const { container } = render(<TimelineGlobalCurveSurfaceHarness />);
    const sidebar = screen.getByRole('complementary', { name: 'Graph parameters' });
    const point = () => Number(container.querySelector<SVGCircleElement>(
      '.global-curve-editor-keyframe[data-keyframe-id="opacity-a"]',
    )?.getAttribute('cy'));
    const initialY = point();

    fireEvent.wheel(sidebar, { deltaY: -100 });
    expect(sidebar).toHaveAttribute('data-vertical-zoom', '1.000');
    expect(point()).toBe(initialY);

    fireEvent.wheel(sidebar, { deltaY: -100, shiftKey: true });
    expect(sidebar).toHaveAttribute('data-vertical-zoom', '1.150');
    expect(point()).not.toBe(initialY);
  });

  it('scales every visible series range around its own center', () => {
    const model = createModel();
    const scaled = scaleCurveGraphModelRanges(model, 2);

    scaled.series.forEach((series, index) => {
      const original = model.series[index];
      expect(series.range.max - series.range.min).toBeCloseTo(
        (original.range.max - original.range.min) / 2,
      );
      expect((series.range.max + series.range.min) / 2).toBeCloseTo(
        (original.range.max + original.range.min) / 2,
      );
    });
  });

  it('keeps parameter order stable, dims inactive curves, and changes the value grid', () => {
    const { container } = render(<TimelineGlobalCurveSurfaceHarness />);
    const tabLabels = () => screen.getAllByRole('tab').map(tab => tab.textContent);
    const seriesIds = () => [...container.querySelectorAll<SVGGElement>(
      '.global-curve-editor-series',
    )].map(series => series.dataset.seriesId);
    const gridLabels = () => [...container.querySelectorAll('.curve-editor-value-label')]
      .map(label => label.textContent);
    const initialTabLabels = tabLabels();
    const initialSeriesIds = seriesIds();
    const initialGridLabels = gridLabels();

    fireEvent.click(screen.getByRole('tab', { name: /Rotation/ }));

    expect(tabLabels()).toEqual(initialTabLabels);
    expect(seriesIds()).toEqual(initialSeriesIds);
    expect(container.querySelector('.global-curve-editor-svg'))
      .toHaveAttribute('data-active-series-id', 'graph-clip::rotation.z');
    expect(container.querySelector('[data-series-id="graph-clip::opacity"]'))
      .toHaveAttribute('data-rendered-color', 'var(--text-muted)');
    expect(container.querySelector('[data-series-id="graph-clip::rotation.z"]'))
      .toHaveAttribute('data-rendered-color', '#22d3ee');
    expect(gridLabels()).not.toEqual(initialGridLabels);
    expect(gridLabels().some(label => label?.includes('°'))).toBe(true);
  });

  it('frames all keyframes of a double-clicked parameter and resets curve height', () => {
    const onFitSeries = vi.fn();
    render(<TimelineGlobalCurveSurfaceHarness onFitSeries={onFitSeries} />);
    const sidebar = screen.getByRole('complementary', { name: 'Graph parameters' });
    fireEvent.wheel(sidebar, { deltaY: -100, shiftKey: true });
    expect(sidebar).toHaveAttribute('data-vertical-zoom', '1.150');

    fireEvent.doubleClick(screen.getByRole('tab', { name: /Rotation/ }));

    expect(sidebar).toHaveAttribute('data-vertical-zoom', '1.000');
    expect(onFitSeries).toHaveBeenCalledWith({ startTime: 7, endTime: 9 });
  });

  it('moves graph keyframes with the live clip drag preview', () => {
    const { container, rerender } = render(<TimelineGlobalCurveSurfaceHarness />);
    const getOpacityPointX = () => Number(container.querySelector<SVGCircleElement>(
      '.global-curve-editor-keyframe[data-keyframe-id="opacity-a"]',
    )?.getAttribute('cx'));

    expect(getOpacityPointX()).toBe(600);

    rerender(<TimelineGlobalCurveSurfaceHarness clipDragPreview={{
      patches: { 'graph-clip': { startTime: 8 } },
    }} />);

    expect(getOpacityPointX()).toBe(900);
  });

  it('moves both opacity edge pairs with the live clip trim preview', () => {
    const { container, rerender } = render(<TimelineGlobalCurveSurfaceHarness />);
    const pointX = (id: string) => Number(container.querySelector<SVGCircleElement>(
      `.global-curve-editor-keyframe[data-keyframe-id="${id}"]`,
    )?.getAttribute('cx'));
    const trimBase = {
      clipId: 'graph-clip',
      originalStartTime: 5,
      originalDuration: 5,
      originalInPoint: 0,
      originalOutPoint: 5,
      startX: 0,
      currentX: 100,
      altKey: false,
      snapIndicatorTime: null,
      isSnapping: false,
      appliedDelta: 1,
    } as const;

    expect([pointX('opacity-start'), pointX('opacity-a'), pointX('opacity-b')]).toEqual([500, 600, 800]);
    rerender(<TimelineGlobalCurveSurfaceHarness clipTrim={{ ...trimBase, edge: 'left' }} />);
    expect([pointX('opacity-start'), pointX('opacity-a'), pointX('opacity-b')]).toEqual([600, 700, 800]);

    rerender(<TimelineGlobalCurveSurfaceHarness clipTrim={{ ...trimBase, edge: 'right' }} />);
    expect([pointX('opacity-tail'), pointX('opacity-end')]).toEqual([1000, 1100]);
  });

  it('renders bounded multi-series curves, canonical selection, and the active-series grid', () => {
    const onActiveSeriesChange = vi.fn();
    const { container } = render(
      <GlobalCurveEditor
        model={createModel()}
        width={1_000}
        height={240}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
        onActiveSeriesChange={onActiveSeriesChange}
        onSelectKeyframe={vi.fn()}
        applyTimelineEditOperation={createApplyOperationMock()}
      />,
    );

    expect(screen.getByRole('img', { name: 'Global property curve editor' })).toBeInTheDocument();
    expect(container.querySelectorAll('.global-curve-editor-series')).toHaveLength(2);
    expect(container.querySelector(
      '.global-curve-editor-keyframe[data-keyframe-id="opacity-a"]',
    )).toHaveClass('selected');
    expect(container.querySelectorAll('.curve-editor-grid-major').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /Graph Clip · Rotation/ }));
    expect(onActiveSeriesChange).toHaveBeenCalledWith('graph-clip::rotation.z');
    expect(screen.getByRole('tab', { name: /Graph Clip · Rotation/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('moves all selected visible keyframes horizontally and values only the active series in one transaction', () => {
    const onSelectKeyframe = vi.fn();
    const applyTimelineEditOperation = createApplyOperationMock();
    const model = createModel(new Set(['opacity-a', 'rotation-a']));
    const { container } = render(
      <GlobalCurveEditor
        model={model}
        width={1_000}
        height={240}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
        onSelectKeyframe={onSelectKeyframe}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const point = container.querySelector<SVGCircleElement>(
      '.global-curve-editor-keyframe[data-keyframe-id="opacity-a"]',
    );
    expect(point).not.toBeNull();

    fireEvent.mouseDown(point!, { button: 0, clientX: 600, clientY: 183 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 131 });
    fireEvent.mouseUp(window);

    expect(onSelectKeyframe).not.toHaveBeenCalled();
    const begin = applyTimelineEditOperation.mock.calls[0][0];
    const update = applyTimelineEditOperation.mock.calls[1][0];
    const commit = applyTimelineEditOperation.mock.calls[2][0];
    expect(begin).toMatchObject({
      type: 'keyframe-transaction-begin',
      keyframeIds: ['opacity-a', 'rotation-a'],
      intent: 'curve-editor',
    });
    expect(update).toMatchObject({
      type: 'keyframe-transaction-update',
      transactionId: begin.transactionId,
      historyBatchId: begin.historyBatchId,
    });
    if (update.type !== 'keyframe-transaction-update') throw new Error('Expected update');
    expect(update.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'keyframe-move',
        keyframeId: 'opacity-a',
        originalTime: 1,
        requestedTime: 2,
        resolvedTime: 2,
      }),
      expect.objectContaining({
        type: 'keyframe-move',
        keyframeId: 'rotation-a',
        originalTime: 2,
        requestedTime: 3,
        resolvedTime: 3,
      }),
      expect.objectContaining({
        type: 'keyframe-update-value',
        keyframeId: 'opacity-a',
      }),
    ]));
    expect(update.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'keyframe-update-value',
        keyframeId: 'rotation-a',
      }),
    ]));
    expect(applyTimelineEditOperation.mock.calls[1][1]).toMatchObject({
      deferHistoryCommit: true,
    });
    expect(commit).toMatchObject({
      type: 'keyframe-transaction-commit',
      transactionId: begin.transactionId,
      historyBatchId: begin.historyBatchId,
      operations: update.operations,
    });
  });

  it('includes an additively selected visible keyframe in the drag transaction', () => {
    const onSelectKeyframe = vi.fn();
    const applyTimelineEditOperation = createApplyOperationMock();
    const { container } = render(
      <GlobalCurveEditor
        model={createModel()}
        width={1_000}
        height={240}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
        onSelectKeyframe={onSelectKeyframe}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const point = container.querySelector<SVGCircleElement>(
      '.global-curve-editor-keyframe[data-keyframe-id="rotation-a"]',
    );

    fireEvent.mouseDown(point!, {
      button: 0,
      clientX: 700,
      clientY: 150,
      shiftKey: true,
    });
    fireEvent.blur(window);

    expect(onSelectKeyframe).toHaveBeenCalledWith('rotation-a', true);
    expect(applyTimelineEditOperation.mock.calls[0][0]).toMatchObject({
      type: 'keyframe-transaction-begin',
      keyframeIds: ['opacity-a', 'rotation-a'],
    });
  });

  it('edits selected Bezier handles through one begin/update/commit transaction', () => {
    const applyTimelineEditOperation = createApplyOperationMock();
    const { container } = render(
      <GlobalCurveEditor
        model={createModel()}
        width={1_000}
        height={240}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
        onSelectKeyframe={vi.fn()}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const handle = container.querySelector<SVGCircleElement>(
      '[data-keyframe-id="opacity-a"][data-handle="out"]',
    );
    expect(handle).not.toBeNull();

    fireEvent.mouseDown(handle!, { button: 0, clientX: 667, clientY: 148 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 131 });
    fireEvent.mouseUp(window);

    const [begin, update, commit] = applyTimelineEditOperation.mock.calls.map((call) => call[0]);
    expect(begin).toMatchObject({
      type: 'keyframe-transaction-begin',
      keyframeIds: ['opacity-a'],
    });
    expect(update).toMatchObject({
      type: 'keyframe-transaction-update',
      transactionId: begin.transactionId,
      operations: [expect.objectContaining({
        type: 'keyframe-update-bezier-handle',
        keyframeId: 'opacity-a',
        handle: 'out',
        position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      })],
    });
    expect(commit).toMatchObject({
      type: 'keyframe-transaction-commit',
      transactionId: begin.transactionId,
    });
  });

  it('caps a dragged Bezier handle before it can reverse segment time', () => {
    const applyTimelineEditOperation = createApplyOperationMock();
    const { container } = render(
      <GlobalCurveEditor
        model={createModel()}
        width={1_000}
        height={240}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
        onSelectKeyframe={vi.fn()}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const handle = container.querySelector<SVGCircleElement>(
      '[data-keyframe-id="opacity-a"][data-handle="out"]',
    );

    fireEvent.mouseDown(handle!, { button: 0, clientX: 667, clientY: 148 });
    fireEvent.mouseMove(window, { clientX: 950, clientY: 131 });

    const update = applyTimelineEditOperation.mock.calls[1][0];
    if (update.type !== 'keyframe-transaction-update') throw new Error('Expected update');
    expect(update.operations[0]).toMatchObject({
      type: 'keyframe-update-bezier-handle',
      handle: 'out',
      position: { x: expect.closeTo(4 / 3, 6) },
    });

    fireEvent.mouseUp(window);
  });

  it.each([
    ['window blur', (_unmount: () => void) => fireEvent.blur(window)],
    ['Escape', (_unmount: () => void) => fireEvent.keyDown(window, { key: 'Escape' })],
    ['unmount', (unmount: () => void) => unmount()],
  ])('cancels an open drag on %s', (_label, cancel) => {
    const applyTimelineEditOperation = createApplyOperationMock();
    const rendered = render(
      <GlobalCurveEditor
        model={createModel()}
        width={1_000}
        height={240}
        timeToPixel={(time) => time * 100}
        pixelToTime={(pixel) => pixel / 100}
        onSelectKeyframe={vi.fn()}
        applyTimelineEditOperation={applyTimelineEditOperation}
      />,
    );
    const point = rendered.container.querySelector<SVGCircleElement>(
      '.global-curve-editor-keyframe[data-keyframe-id="opacity-a"]',
    );
    fireEvent.mouseDown(point!, { button: 0, clientX: 600, clientY: 183 });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 170 });

    cancel(rendered.unmount);

    const operations = applyTimelineEditOperation.mock.calls.map((call) => call[0]);
    expect(operations.map((operation) => operation.type)).toEqual([
      'keyframe-transaction-begin',
      'keyframe-transaction-update',
      'keyframe-transaction-cancel',
    ]);
    expect(operations[2]).toMatchObject({
      transactionId: operations[0].transactionId,
      historyBatchId: operations[0].historyBatchId,
      restoreKeyframeIds: ['opacity-a'],
      discardKeyframeIds: [],
    });
  });
});
