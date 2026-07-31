import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  GlobalCurveEditor,
  type GlobalCurveApplyTimelineEditOperation,
} from '../../src/components/timeline/GlobalCurveEditor';
import {
  TimelineGlobalCurveSurface,
  type TimelineGraphTarget,
} from '../../src/components/timeline/TimelineGlobalCurveSurface';
import { buildCurveGraphModel } from '../../src/components/timeline/utils/curveGraphModel';
import { propertyRegistry } from '../../src/services/properties';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip } from '../helpers/mockData';

function makeClip(): TimelineClip {
  return createMockClip({ id: 'graph-clip', name: 'Graph Clip', startTime: 5, duration: 5 });
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

function TimelineGlobalCurveSurfaceHarness() {
  const clip = React.useMemo(() => makeClip(), []);
  const [preferredTarget, setPreferredTarget] = React.useState<TimelineGraphTarget>({
    clipId: clip.id,
    property: 'opacity',
  });
  const clipKeyframes = React.useMemo(() => new Map([[clip.id, [
    makeKeyframe('opacity-a', 'opacity', 1, 0.2),
    makeKeyframe('opacity-b', 'opacity', 3, 0.8),
    makeKeyframe('rotation-a', 'rotation.z', 2, 30),
    makeKeyframe('rotation-b', 'rotation.z', 4, 90),
  ]]]), [clip.id]);

  return (
    <TimelineGlobalCurveSurface
      activeComposition={null}
      applyTimelineEditOperation={createApplyOperationMock()}
      clipKeyframes={clipKeyframes}
      clips={[clip]}
      height={260}
      onActiveSeriesChange={setPreferredTarget}
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
