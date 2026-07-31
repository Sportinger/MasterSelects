import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { BezierHandle } from '../../types/animationProperties';
import type { Keyframe } from '../../types/keyframes';
import { BEZIER_HANDLE_SIZE } from '../../stores/timeline/constants';
import type { TimelineEditOperationActions } from '../../stores/timeline/storeTypes/playbackActionTypes';
import type {
  KeyframeEditOperation,
  KeyframeTransactionBeginOperation,
  KeyframeTransactionCancelOperation,
  KeyframeTransactionCommitOperation,
  KeyframeTransactionUpdateOperation,
} from '../../stores/timeline/editOperations/transactionTypes';
import {
  curveValueToY,
  curveYToValue,
  formatCurveAuthoringValue,
  generateBezierPath,
  niceStep,
} from './utils/curveEditorMath';
import {
  curveAuthoringDeltaToStorage,
  curveStorageDeltaToAuthoring,
  planCurveGraphKeyframeDrag,
  type CurveGraphDragTarget,
  type CurveGraphKeyframe,
  type CurveGraphModel,
  type CurveGraphSeries,
} from './utils/curveGraphModel';

const GLOBAL_CURVE_PADDING = { top: 44, right: 12, bottom: 22, left: 12 } as const;
const GLOBAL_CURVE_COMPACT_PADDING = { top: 16, right: 12, bottom: 22, left: 12 } as const;
const DRAG_EPSILON = 1e-9;

export type GlobalCurveApplyTimelineEditOperation =
  TimelineEditOperationActions['applyTimelineEditOperation'];

export interface GlobalCurveEditorProps {
  model: CurveGraphModel;
  width: number;
  height: number;
  timeToPixel: (compositionTime: number) => number;
  pixelToTime: (pixel: number) => number;
  selectedKeyframeIds?: ReadonlySet<string>;
  activeSeriesId?: string | null;
  onActiveSeriesChange?: (seriesId: string) => void;
  showLegend?: boolean;
  emptyMessage?: string;
  onSelectKeyframe: (id: string, addToSelection: boolean) => void;
  /**
   * The global graph owns a single transaction for the entire pointer drag.
   * Passing the store operation action directly is required for atomic
   * multi-series edits and lifecycle cancellation.
   */
  applyTimelineEditOperation: GlobalCurveApplyTimelineEditOperation;
}

type GlobalCurveDragState =
  | {
      type: 'keyframe';
      seriesId: string;
      keyframeId: string;
      startClientX: number;
      startClientY: number;
      startCompositionTime: number;
      startAuthoringValue: number;
      targets: readonly CurveGraphDragTarget[];
    }
  | {
      type: 'handle';
      seriesId: string;
      keyframeId: string;
      handle: 'in' | 'out';
    };

interface GlobalCurveTransactionSession {
  transactionId: string;
  historyBatchId: string;
  anchorClipId: string;
  anchorProperty: CurveGraphSeries['property'];
  keyframeIds: string[];
  hasUpdate: boolean;
  latestOperations: readonly KeyframeEditOperation[];
  updateSequence: number;
  historyLabel: string;
}

export const GlobalCurveEditor: React.FC<GlobalCurveEditorProps> = ({
  model,
  width,
  height,
  timeToPixel,
  pixelToTime,
  selectedKeyframeIds,
  activeSeriesId: controlledActiveSeriesId,
  onActiveSeriesChange,
  showLegend = true,
  emptyMessage = 'No numeric animated properties to graph.',
  onSelectKeyframe,
  applyTimelineEditOperation,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const applyTimelineEditOperationRef = useRef(applyTimelineEditOperation);
  const transactionRef = useRef<GlobalCurveTransactionSession | null>(null);
  const transactionCounterRef = useRef(0);
  const [dragState, setDragState] = useState<GlobalCurveDragState | null>(null);
  const [internalActiveSeriesId, setInternalActiveSeriesId] = useState<string | null>(null);

  useEffect(() => {
    applyTimelineEditOperationRef.current = applyTimelineEditOperation;
  }, [applyTimelineEditOperation]);

  const renderedSeriesIds = useMemo(
    () => new Set(model.series.map((series) => series.id)),
    [model.series],
  );
  const activeSeriesId = controlledActiveSeriesId
    ?? (internalActiveSeriesId && renderedSeriesIds.has(internalActiveSeriesId)
      ? internalActiveSeriesId
      : model.activeSeriesId);
  const activeSeries = model.series.find((series) => series.id === activeSeriesId)
    ?? model.series[0]
    ?? null;
  const selection = selectedKeyframeIds ?? model.selectedKeyframeIds;
  const curvePadding = showLegend ? GLOBAL_CURVE_PADDING : GLOBAL_CURVE_COMPACT_PADDING;

  const activateSeries = useCallback((seriesId: string) => {
    if (controlledActiveSeriesId === undefined) setInternalActiveSeriesId(seriesId);
    onActiveSeriesChange?.(seriesId);
  }, [controlledActiveSeriesId, onActiveSeriesChange]);

  const getClampedSvgPoint = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const svgWidth = rect.width || width;
    const svgHeight = rect.height || height;
    return {
      x: Math.max(0, Math.min(clientX - rect.left, svgWidth)),
      y: Math.max(0, Math.min(clientY - rect.top, svgHeight)),
    };
  }, [height, width]);

  const sendCancel = useCallback((session: GlobalCurveTransactionSession, reason: string) => {
    const operation: KeyframeTransactionCancelOperation = {
      id: `${session.transactionId}:cancel:${reason}`,
      type: 'keyframe-transaction-cancel',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'cancel',
      clipId: session.anchorClipId,
      property: session.anchorProperty,
      keyframeIds: session.keyframeIds,
      restoreKeyframeIds: session.keyframeIds,
      discardKeyframeIds: [],
    };
    applyTimelineEditOperationRef.current(operation, {
      source: 'ui',
      historyLabel: `Cancel ${session.historyLabel.toLowerCase()}`,
    });
  }, []);

  const cancelActiveTransaction = useCallback((reason: string, updateState = true) => {
    const session = transactionRef.current;
    if (!session) return;
    transactionRef.current = null;
    sendCancel(session, reason);
    if (updateState) setDragState(null);
  }, [sendCancel]);

  useEffect(() => () => {
    cancelActiveTransaction('unmount', false);
  }, [cancelActiveTransaction]);

  const beginTransaction = useCallback((
    kind: 'keyframes' | 'bezier',
    series: CurveGraphSeries,
    keyframeIds: readonly string[],
  ): boolean => {
    cancelActiveTransaction('superseded');
    transactionCounterRef.current += 1;
    const transactionId = [
      'global-curve-editor',
      kind,
      series.clipId,
      transactionCounterRef.current,
    ].join(':');
    const historyLabel = kind === 'keyframes'
      ? 'Edit global curve keyframes'
      : 'Edit global curve Bezier handle';
    const session: GlobalCurveTransactionSession = {
      transactionId,
      historyBatchId: `${transactionId}:history`,
      anchorClipId: series.clipId,
      anchorProperty: series.property,
      keyframeIds: [...new Set(keyframeIds)],
      hasUpdate: false,
      latestOperations: [],
      updateSequence: 0,
      historyLabel,
    };
    const operation: KeyframeTransactionBeginOperation = {
      id: `${transactionId}:begin`,
      type: 'keyframe-transaction-begin',
      transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'begin',
      clipId: session.anchorClipId,
      property: session.anchorProperty,
      keyframeIds: session.keyframeIds,
      intent: 'curve-editor',
    };
    const result = applyTimelineEditOperationRef.current(operation, {
      source: 'ui',
      historyLabel: `Begin ${historyLabel.toLowerCase()}`,
    });
    if (!result.success) return false;
    transactionRef.current = session;
    return true;
  }, [cancelActiveTransaction]);

  const updateTransaction = useCallback((operations: readonly KeyframeEditOperation[]) => {
    const session = transactionRef.current;
    if (!session || operations.length === 0) return;
    session.updateSequence += 1;
    const operation: KeyframeTransactionUpdateOperation = {
      id: `${session.transactionId}:update:${session.updateSequence}`,
      type: 'keyframe-transaction-update',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'update',
      clipId: session.anchorClipId,
      property: session.anchorProperty,
      keyframeIds: session.keyframeIds,
      operations,
    };
    const result = applyTimelineEditOperationRef.current(operation, {
      source: 'ui',
      historyLabel: session.historyLabel,
      deferHistoryCommit: true,
    });
    if (!result.success) {
      transactionRef.current = null;
      setDragState(null);
      return;
    }
    session.hasUpdate = true;
    session.latestOperations = operations;
  }, []);

  const commitActiveTransaction = useCallback(() => {
    const session = transactionRef.current;
    if (!session) {
      setDragState(null);
      return;
    }
    transactionRef.current = null;
    setDragState(null);
    if (!session.hasUpdate || session.latestOperations.length === 0) {
      sendCancel(session, 'no-update');
      return;
    }
    const operation: KeyframeTransactionCommitOperation = {
      id: `${session.transactionId}:commit`,
      type: 'keyframe-transaction-commit',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'commit',
      clipId: session.anchorClipId,
      property: session.anchorProperty,
      keyframeIds: session.keyframeIds,
      operations: session.latestOperations,
    };
    applyTimelineEditOperationRef.current(operation, {
      source: 'ui',
      historyLabel: session.historyLabel,
    });
  }, [sendCancel]);

  const handleKeyframeMouseDown = useCallback((
    event: React.MouseEvent,
    series: CurveGraphSeries,
    point: CurveGraphKeyframe,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activateSeries(series.id);

    const wasAlreadySelected = selection.has(point.id);
    if (!wasAlreadySelected) onSelectKeyframe(point.id, event.shiftKey);
    const dragSelection = wasAlreadySelected
      ? selection
      : event.shiftKey
        ? new Set([...selection, point.id])
        : new Set([point.id]);
    const targets = collectSelectedVisibleTargets(model, dragSelection);
    if (!beginTransaction(
      'keyframes',
      series,
      targets.map((target) => target.keyframe.id),
    )) return;
    setDragState({
      type: 'keyframe',
      seriesId: series.id,
      keyframeId: point.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCompositionTime: point.compositionTime,
      startAuthoringValue: point.authoringValue,
      targets,
    });
  }, [activateSeries, beginTransaction, model, onSelectKeyframe, selection]);

  const handleBezierMouseDown = useCallback((
    event: React.MouseEvent,
    series: CurveGraphSeries,
    point: CurveGraphKeyframe,
    handle: 'in' | 'out',
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activateSeries(series.id);
    if (!beginTransaction('bezier', series, [point.id])) return;
    setDragState({
      type: 'handle',
      seriesId: series.id,
      keyframeId: point.id,
      handle,
    });
  }, [activateSeries, beginTransaction]);

  const handleMouseMove = useCallback((clientX: number, clientY: number, shiftKey: boolean) => {
    if (!dragState || !transactionRef.current) return;
    const pointer = getClampedSvgPoint(clientX, clientY);
    const series = model.series.find((candidate) => candidate.id === dragState.seriesId);
    const keyframe = series?.keyframes.find((candidate) => candidate.id === dragState.keyframeId);
    if (!pointer || !series || !keyframe) {
      cancelActiveTransaction('missing-target');
      return;
    }

    if (dragState.type === 'keyframe') {
      let requestedCompositionDelta = pixelToTime(pointer.x) - dragState.startCompositionTime;
      let requestedAuthoringDelta = curveYToValue(
        pointer.y,
        series.range,
        height,
        curvePadding,
      ) - dragState.startAuthoringValue;
      if (shiftKey) {
        const dx = Math.abs(clientX - dragState.startClientX);
        const dy = Math.abs(clientY - dragState.startClientY);
        if (dx > dy) requestedAuthoringDelta = 0;
        else requestedCompositionDelta = 0;
      }

      try {
        const planned = planCurveGraphKeyframeDrag({
          targets: dragState.targets,
          activeSeriesId: dragState.seriesId,
          requestedCompositionDelta,
          requestedAuthoringDelta,
        });
        const operations: KeyframeEditOperation[] = [];
        if (Math.abs(requestedCompositionDelta) > DRAG_EPSILON) {
          for (const edit of planned) {
            operations.push({
              type: 'keyframe-move',
              keyframeId: edit.keyframe.id,
              clipId: edit.series.clipId,
              property: edit.series.property,
              originalTime: edit.keyframe.localTime,
              requestedTime: edit.requestedLocalTime,
              resolvedTime: edit.resolvedLocalTime,
            });
          }
        }
        if (Math.abs(requestedAuthoringDelta) > DRAG_EPSILON) {
          for (const edit of planned) {
            if (edit.series.id !== dragState.seriesId || edit.storageValue === undefined) continue;
            operations.push({
              type: 'keyframe-update-value',
              keyframeId: edit.keyframe.id,
              clipId: edit.series.clipId,
              property: edit.series.property,
              value: { value: edit.storageValue },
            });
          }
        }
        updateTransaction(operations);
      } catch {
        // The descriptor codec is the edit boundary. Invalid authoring-space
        // pointer values do not produce partial transaction updates.
      }
      return;
    }

    const handleCompositionTime = pixelToTime(pointer.x);
    const handleAuthoringValue = curveYToValue(
      pointer.y,
      series.range,
      height,
      curvePadding,
    );
    const isIn = dragState.handle === 'in';
    const position: BezierHandle = {
      x: isIn
        ? Math.min(0, handleCompositionTime - keyframe.compositionTime)
        : Math.max(0, handleCompositionTime - keyframe.compositionTime),
      y: shiftKey
        ? 0
        : curveAuthoringDeltaToStorage(
            series.descriptor,
            handleAuthoringValue - keyframe.authoringValue,
            series.authoringContext,
          ),
    };
    updateTransaction([{
      type: 'keyframe-update-bezier-handle',
      keyframeId: keyframe.id,
      clipId: series.clipId,
      property: series.property,
      handle: dragState.handle,
      position,
    }]);
  }, [
    cancelActiveTransaction,
    curvePadding,
    dragState,
    getClampedSvgPoint,
    height,
    model.series,
    pixelToTime,
    updateTransaction,
  ]);

  useEffect(() => {
    if (!dragState) return;
    const onMouseMove = (event: MouseEvent) => {
      handleMouseMove(event.clientX, event.clientY, event.shiftKey);
    };
    const onMouseUp = () => commitActiveTransaction();
    const onBlur = () => cancelActiveTransaction('blur');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelActiveTransaction('escape');
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    cancelActiveTransaction,
    commitActiveTransaction,
    dragState,
    handleMouseMove,
  ]);

  const activeGrid = useMemo(() => {
    if (!activeSeries) return [];
    const range = activeSeries.range.max - activeSeries.range.min;
    const step = niceStep(range, 6);
    const ticks: number[] = [];
    for (
      let value = Math.ceil(activeSeries.range.min / step) * step;
      value <= activeSeries.range.max + step * 0.001;
      value += step
    ) {
      ticks.push(value);
      if (ticks.length >= 12) break;
    }
    return ticks;
  }, [activeSeries]);

  if (model.series.length === 0) {
    return (
      <div className="global-curve-editor empty" style={{ width, height }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="global-curve-editor" style={{ width, height }}>
      {showLegend && <div className="global-curve-editor-legend" role="tablist" aria-label="Curve series">
        {model.series.map((series) => (
          <button
            key={series.id}
            type="button"
            role="tab"
            aria-selected={series.id === activeSeries?.id}
            className={series.id === activeSeries?.id ? 'active' : ''}
            data-series-id={series.id}
            onClick={() => activateSeries(series.id)}
          >
            <span className="global-curve-editor-swatch" style={{ backgroundColor: series.color }} />
            {series.clipName} · {series.label}
            {series.unit ? ` (${series.unit})` : ''}
          </button>
        ))}
      </div>}
      <svg
        ref={svgRef}
        className="curve-editor-svg global-curve-editor-svg"
        width={width}
        height={height}
        role="img"
        aria-label="Global property curve editor"
      >
        <rect x={0} y={0} width={width} height={height} className="global-curve-editor-background" />

        {activeSeries && activeGrid.map((value) => {
          const y = curveValueToY(value, activeSeries.range, height, curvePadding);
          return (
            <g key={`${activeSeries.id}:grid:${value}`}>
              <line x1={0} y1={y} x2={width} y2={y} className="curve-editor-grid-major" />
              <text x={4} y={y - 3} className="curve-editor-value-label">
                {formatCurveAuthoringValue(value, activeSeries.unit, activeSeries.step)}
              </text>
            </g>
          );
        })}

        {model.series.map((series) => {
          const valueToY = (value: number) => curveValueToY(
            value,
            series.range,
            height,
            curvePadding,
          );
          const authoringKeyframes = series.keyframes.map((point): Keyframe => ({
            ...point.keyframe,
            time: point.compositionTime,
            value: point.authoringValue,
            ...(point.handleIn
              ? {
                  handleIn: {
                    x: point.handleIn.x,
                    y: curveStorageDeltaToAuthoring(
                      series.descriptor,
                      point.handleIn.y,
                      series.authoringContext,
                    ),
                  },
                }
              : {}),
            ...(point.handleOut
              ? {
                  handleOut: {
                    x: point.handleOut.x,
                    y: curveStorageDeltaToAuthoring(
                      series.descriptor,
                      point.handleOut.y,
                      series.authoringContext,
                    ),
                  },
                }
              : {}),
          }));

          return (
            <g
              key={series.id}
              className={`global-curve-editor-series${series.id === activeSeries?.id ? ' active' : ''}`}
              data-series-id={series.id}
              onMouseDown={() => activateSeries(series.id)}
            >
              {authoringKeyframes.map((keyframe, index) => {
                if (index === 0) return null;
                return (
                  <path
                    key={`${series.id}:curve:${keyframe.id}`}
                    d={generateBezierPath(
                      authoringKeyframes[index - 1],
                      keyframe,
                      timeToPixel,
                      valueToY,
                    )}
                    className="curve-editor-curve global-curve-editor-curve"
                    style={{ stroke: series.color }}
                  />
                );
              })}

              {series.keyframes.map((point, index) => {
                const x = timeToPixel(point.compositionTime);
                const y = valueToY(point.authoringValue);
                const selected = selection.has(point.id);
                const previous = series.keyframes[index - 1];
                const next = series.keyframes[index + 1];
                const handles = selected
                  ? buildRenderedHandles(series, point, previous, next, valueToY, timeToPixel)
                  : [];
                return (
                  <g key={`${series.id}:point:${point.id}`}>
                    {handles.map((handle) => (
                      <React.Fragment key={`${point.id}:${handle.handle}`}>
                        <line
                          x1={x}
                          y1={y}
                          x2={handle.x}
                          y2={handle.y}
                          className="curve-editor-handle-line"
                        />
                        <circle
                          cx={handle.x}
                          cy={handle.y}
                          r={BEZIER_HANDLE_SIZE / 2}
                          className="curve-editor-handle"
                          data-keyframe-id={point.id}
                          data-handle={handle.handle}
                          onMouseDown={(event) => handleBezierMouseDown(
                            event,
                            series,
                            point,
                            handle.handle,
                          )}
                        />
                      </React.Fragment>
                    ))}
                    <circle
                      cx={x}
                      cy={y}
                      r={5}
                      className={`curve-editor-keyframe global-curve-editor-keyframe${selected ? ' selected' : ''}`}
                      style={{ fill: selected ? undefined : series.color }}
                      data-keyframe-id={point.id}
                      data-series-id={series.id}
                      onMouseDown={(event) => handleKeyframeMouseDown(event, series, point)}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {(model.truncatedSeries || model.truncatedKeyframes) && (
        <div className="global-curve-editor-limit" role="status">
          Showing {model.series.length}/{model.totalCandidateSeries} series and{' '}
          {model.renderedKeyframes}/{model.totalKeyframes} keyframes.
        </div>
      )}
    </div>
  );
};

function collectSelectedVisibleTargets(
  model: CurveGraphModel,
  selection: ReadonlySet<string>,
): CurveGraphDragTarget[] {
  return model.series.flatMap((series) => (
    series.keyframes
      .filter((keyframe) => selection.has(keyframe.id))
      .map((keyframe) => ({ series, keyframe }))
  ));
}

interface RenderedHandle {
  handle: 'in' | 'out';
  x: number;
  y: number;
}

function buildRenderedHandles(
  series: CurveGraphSeries,
  point: CurveGraphKeyframe,
  previous: CurveGraphKeyframe | undefined,
  next: CurveGraphKeyframe | undefined,
  valueToY: (value: number) => number,
  timeToPixel: (time: number) => number,
): RenderedHandle[] {
  const handles: RenderedHandle[] = [];
  if (previous) {
    const storagePosition = point.handleIn ?? {
      x: -(point.localTime - previous.localTime) / 3,
      y: -(point.storageValue - previous.storageValue) / 3,
    };
    handles.push({
      handle: 'in',
      x: timeToPixel(point.compositionTime + storagePosition.x),
      y: valueToY(
        point.authoringValue + curveStorageDeltaToAuthoring(
          series.descriptor,
          storagePosition.y,
          series.authoringContext,
        ),
      ),
    });
  }
  if (next) {
    const storagePosition = point.handleOut ?? {
      x: (next.localTime - point.localTime) / 3,
      y: (next.storageValue - point.storageValue) / 3,
    };
    handles.push({
      handle: 'out',
      x: timeToPixel(point.compositionTime + storagePosition.x),
      y: valueToY(
        point.authoringValue + curveStorageDeltaToAuthoring(
          series.descriptor,
          storagePosition.y,
          series.authoringContext,
        ),
      ),
    });
  }
  return handles;
}

export default GlobalCurveEditor;
