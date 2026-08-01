import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type {
  KeyframeEditOperation,
  KeyframeTransactionBeginOperation,
  KeyframeTransactionCancelOperation,
  KeyframeTransactionCommitOperation,
  KeyframeTransactionUpdateOperation,
} from '../../stores/timeline/editOperations/transactionTypes';
import type { ApplyTimelineEditOperationOptions } from '../../stores/timeline/editOperations/types';
import {
  buildMotionPathNodes,
  buildMotionPathSpatialHandles,
  projectMotionPathPosition,
  resolveMotionPathEligibility,
  resolveMotionPathPositionDelta,
  sampleMotionPath,
  sampleMotionPathOnionPositions,
  type MotionPathEligibility,
  type MotionPathNode,
  type MotionPathPosition,
  type MotionPathProjectionContext,
  type MotionPathSpatialHandle,
} from './motionPathGeometry';
import type {
  MotionPathOverlayProps,
  ProjectedMotionPathHandle,
  ProjectedMotionPathNode,
  ProjectedMotionPathOnionPoint,
  ProjectedMotionPathPoint,
} from './MotionPathOverlay';

const EMPTY_KEYFRAMES: Keyframe[] = [];
const APPLY_OPTIONS: ApplyTimelineEditOperationOptions = {
  source: 'ui',
  historyLabel: 'Edit motion path',
};
let transactionSequence = 0;

export interface UseMotionPathEditingOptions {
  enabled: boolean;
  clip: TimelineClip | null;
  projection: MotionPathProjectionContext | null;
  editableSource: boolean;
  sourceMonitorActive: boolean;
  playbackActive: boolean;
  maskModeActive: boolean;
  textModeActive: boolean;
  trackLocked?: boolean;
  playheadPosition: number;
  frameRate: number;
  viewZoom: number;
  onionFrameOffset?: number;
  samplesPerSegment?: number;
}

export interface UseMotionPathEditingResult {
  eligibility: MotionPathEligibility;
  overlayProps: Omit<MotionPathOverlayProps, 'width' | 'height'>;
  cancelActiveEdit: () => void;
}

interface ActiveMotionPathDragBase {
  clipId: string;
  inputMode: 'pointer' | 'keyboard';
  pointerId: number | null;
  captureTarget: SVGCircleElement | null;
  startClient: MotionPathPosition;
  startPosition: MotionPathPosition;
  latestPosition: MotionPathPosition;
  projection: MotionPathProjectionContext;
  viewZoom: number;
  transactionId: string;
  historyBatchId: string;
  keyframeIds: string[];
  moved: boolean;
  latestOperations: readonly KeyframeEditOperation[];
}

interface ActiveMotionPathNodeDrag extends ActiveMotionPathDragBase {
  kind: 'node';
  node: MotionPathNode;
}

interface ActiveMotionPathHandleDrag extends ActiveMotionPathDragBase {
  kind: 'handle';
  handle: MotionPathSpatialHandle;
}

type ActiveMotionPathDrag = ActiveMotionPathNodeDrag | ActiveMotionPathHandleDrag;

function nextTransactionId(clipId: string): string {
  transactionSequence += 1;
  return `viewport-motion-path:${clipId}:${Date.now()}:${transactionSequence}`;
}

function buildMotionPathSelectionOperation(keyframeIds: readonly string[]): KeyframeEditOperation {
  return {
    type: 'keyframe-select',
    selectedKeyframeIds: keyframeIds,
    mode: 'replace',
  };
}

function releaseDragPointerCapture(drag: ActiveMotionPathDrag | null): void {
  if (!drag?.captureTarget || drag.pointerId === null) return;
  try {
    if (!drag.captureTarget.hasPointerCapture
      || drag.captureTarget.hasPointerCapture(drag.pointerId)) {
      drag.captureTarget.releasePointerCapture?.(drag.pointerId);
    }
  } catch {
    // The browser may already have released capture after pointerup/cancel.
  }
}

export function buildMotionPathPositionUpsertOperations(
  clipId: string,
  node: Pick<MotionPathNode,
    'time' | 'xKeyframeId' | 'yKeyframeId' | 'xEasing' | 'yEasing'>,
  position: MotionPathPosition,
): KeyframeEditOperation[] {
  const xOperation: KeyframeEditOperation = node.xKeyframeId
    ? {
        type: 'keyframe-update-value',
        keyframeId: node.xKeyframeId,
        clipId,
        property: 'position.x',
        value: { value: position.x },
      }
    : {
        type: 'keyframe-create',
        clipId,
        property: 'position.x',
        time: node.time,
        value: { value: position.x },
        easing: node.yEasing ?? 'linear',
      };
  const yOperation: KeyframeEditOperation = node.yKeyframeId
    ? {
        type: 'keyframe-update-value',
        keyframeId: node.yKeyframeId,
        clipId,
        property: 'position.y',
        value: { value: position.y },
      }
    : {
        type: 'keyframe-create',
        clipId,
        property: 'position.y',
        time: node.time,
        value: { value: position.y },
        easing: node.xEasing ?? 'linear',
      };

  return [xOperation, yOperation];
}

export function buildMotionPathBezierHandleOperations(
  clipId: string,
  handle: Pick<MotionPathSpatialHandle,
    'direction' | 'nodePosition' | 'temporalOffset' | 'xKeyframeId' | 'yKeyframeId'>,
  position: MotionPathPosition,
): KeyframeEditOperation[] {
  return [
    {
      type: 'keyframe-update-bezier-handle',
      keyframeId: handle.xKeyframeId,
      clipId,
      property: 'position.x',
      handle: handle.direction,
      position: {
        x: handle.temporalOffset,
        y: position.x - handle.nodePosition.x,
      },
    },
    {
      type: 'keyframe-update-bezier-handle',
      keyframeId: handle.yKeyframeId,
      clipId,
      property: 'position.y',
      handle: handle.direction,
      position: {
        x: handle.temporalOffset,
        y: position.y - handle.nodePosition.y,
      },
    },
  ];
}

export function useMotionPathEditing({
  enabled,
  clip,
  projection,
  editableSource,
  sourceMonitorActive,
  playbackActive,
  maskModeActive,
  textModeActive,
  trackLocked,
  playheadPosition,
  frameRate,
  viewZoom,
  onionFrameOffset = 1,
  samplesPerSegment,
}: UseMotionPathEditingOptions): UseMotionPathEditingResult {
  const clipId = clip?.id ?? null;
  const keyframes = useTimelineStore(useCallback(
    (state) => clipId ? state.clipKeyframes.get(clipId) ?? EMPTY_KEYFRAMES : EMPTY_KEYFRAMES,
    [clipId],
  ));
  const selectedKeyframeIds = useTimelineStore((state) => state.selectedKeyframeIds);
  const getClipKeyframes = useTimelineStore((state) => state.getClipKeyframes);
  const applyTimelineEditOperation = useTimelineStore((state) => state.applyTimelineEditOperation);
  const dragRef = useRef<ActiveMotionPathDrag | null>(null);
  const cancelRef = useRef<() => void>(() => undefined);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [activeHandleId, setActiveHandleId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const eligibility = useMemo(() => resolveMotionPathEligibility({
    enabled,
    clip,
    editableSource,
    sourceMonitorActive,
    playbackActive,
    maskModeActive,
    textModeActive,
    trackLocked,
    hasProjection: projection !== null,
  }), [
    clip,
    editableSource,
    enabled,
    maskModeActive,
    playbackActive,
    projection,
    sourceMonitorActive,
    textModeActive,
    trackLocked,
  ]);

  const basePosition = useMemo(
    () => clip?.transform.position ?? { x: 0, y: 0, z: 0 },
    [clip],
  );
  const nodes = useMemo(
    () => buildMotionPathNodes(keyframes, basePosition),
    [basePosition, keyframes],
  );
  const samples = useMemo(
    () => sampleMotionPath(keyframes, basePosition, samplesPerSegment),
    [basePosition, keyframes, samplesPerSegment],
  );
  const spatialHandles = useMemo(
    () => buildMotionPathSpatialHandles(keyframes, basePosition, selectedKeyframeIds),
    [basePosition, keyframes, selectedKeyframeIds],
  );
  const onionPositions = useMemo(() => clip
    ? sampleMotionPathOnionPositions({
        keyframes,
        basePosition,
        localTime: playheadPosition - clip.startTime,
        frameRate,
        frameOffset: onionFrameOffset,
        clipDuration: clip.duration,
      })
    : [], [basePosition, clip, frameRate, keyframes, onionFrameOffset, playheadPosition]);

  const projectedNodes = useMemo<ProjectedMotionPathNode[]>(() => projection
    ? nodes.map((node) => ({
        id: node.id,
        time: node.time,
        selected: (node.xKeyframeId !== null && selectedKeyframeIds.has(node.xKeyframeId))
          || (node.yKeyframeId !== null && selectedKeyframeIds.has(node.yKeyframeId)),
        ...projectMotionPathPosition(node, projection),
      }))
    : [], [nodes, projection, selectedKeyframeIds]);
  const projectedHandles = useMemo<ProjectedMotionPathHandle[]>(() => projection
    ? spatialHandles.map((handle) => ({
        id: handle.id,
        nodeId: handle.nodeId,
        direction: handle.direction,
        time: handle.nodeTime,
        nodeX: projectMotionPathPosition(handle.nodePosition, projection).x,
        nodeY: projectMotionPathPosition(handle.nodePosition, projection).y,
        ...projectMotionPathPosition(handle.position, projection),
      }))
    : [], [projection, spatialHandles]);
  const projectedSamples = useMemo<ProjectedMotionPathPoint[]>(() => projection
    ? samples.map((sample) => ({
        time: sample.time,
        ...projectMotionPathPosition(sample, projection),
      }))
    : [], [projection, samples]);
  const projectedOnions = useMemo<ProjectedMotionPathOnionPoint[]>(() => projection
    ? onionPositions.map((position) => ({
        direction: position.direction,
        frameOffset: position.frameOffset,
        time: position.time,
        ...projectMotionPathPosition(position, projection),
      }))
    : [], [onionPositions, projection]);

  const clearDrag = useCallback(() => {
    releaseDragPointerCapture(dragRef.current);
    dragRef.current = null;
    setActiveNodeId(null);
    setActiveHandleId(null);
    setIsDragging(false);
  }, []);

  const cancelActiveEdit = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const operation: KeyframeTransactionCancelOperation = {
      id: `${drag.transactionId}:cancel`,
      type: 'keyframe-transaction-cancel',
      transactionId: drag.transactionId,
      historyBatchId: drag.historyBatchId,
      source: 'ui',
      phase: 'cancel',
      clipId: drag.clipId,
      keyframeIds: drag.keyframeIds,
      restoreKeyframeIds: drag.keyframeIds,
      discardKeyframeIds: [],
    };
    applyTimelineEditOperation(operation, APPLY_OPTIONS);
    clearDrag();
  }, [applyTimelineEditOperation, clearDrag]);
  useEffect(() => {
    cancelRef.current = cancelActiveEdit;
  }, [cancelActiveEdit]);

  const beginMotionPathTransaction = useCallback((targetClipId: string, keyframeIds: string[]) => {
    const transactionId = nextTransactionId(targetClipId);
    const historyBatchId = `${transactionId}:history`;
    const operation: KeyframeTransactionBeginOperation = {
      id: `${transactionId}:begin`,
      type: 'keyframe-transaction-begin',
      transactionId,
      historyBatchId,
      source: 'ui',
      phase: 'begin',
      clipId: targetClipId,
      keyframeIds,
      intent: 'viewport-motion-path',
    };
    const result = applyTimelineEditOperation(operation, {
      ...APPLY_OPTIONS,
      deferHistoryCommit: true,
    });
    return result.success ? { transactionId, historyBatchId } : null;
  }, [applyTimelineEditOperation]);

  const applyActiveDragPosition = useCallback((
    drag: ActiveMotionPathDrag,
    nextPosition: MotionPathPosition,
  ): boolean => {
    const contentOperations = drag.kind === 'node'
      ? buildMotionPathPositionUpsertOperations(drag.clipId, drag.node, nextPosition)
      : buildMotionPathBezierHandleOperations(drag.clipId, drag.handle, nextPosition);
    const operations: KeyframeEditOperation[] = [
      ...contentOperations,
      buildMotionPathSelectionOperation(drag.keyframeIds),
    ];
    const operation: KeyframeTransactionUpdateOperation = {
      id: `${drag.transactionId}:update`,
      type: 'keyframe-transaction-update',
      transactionId: drag.transactionId,
      historyBatchId: drag.historyBatchId,
      source: 'ui',
      phase: 'update',
      clipId: drag.clipId,
      keyframeIds: drag.keyframeIds,
      operations,
    };
    const result = applyTimelineEditOperation(operation, {
      ...APPLY_OPTIONS,
      deferHistoryCommit: true,
    });
    if (!result.success) {
      cancelActiveEdit();
      return false;
    }

    if (drag.kind === 'node' && (!drag.node.xKeyframeId || !drag.node.yKeyframeId)) {
      const updatedKeyframes = getClipKeyframes(drag.clipId);
      const xKeyframe = updatedKeyframes.find((keyframe) => (
        keyframe.property === 'position.x' && keyframe.time === drag.node.time
      ));
      const yKeyframe = updatedKeyframes.find((keyframe) => (
        keyframe.property === 'position.y' && keyframe.time === drag.node.time
      ));
      if (!xKeyframe || !yKeyframe) {
        cancelActiveEdit();
        return false;
      }

      const stableKeyframeIds = [xKeyframe.id, yKeyframe.id];
      drag.node = {
        ...drag.node,
        xKeyframeId: xKeyframe.id,
        yKeyframeId: yKeyframe.id,
        xEasing: xKeyframe.easing,
        yEasing: yKeyframe.easing,
      };
      drag.keyframeIds = stableKeyframeIds;
      const selectionOperation = buildMotionPathSelectionOperation(stableKeyframeIds);
      const selectionUpdate: KeyframeTransactionUpdateOperation = {
        id: `${drag.transactionId}:resolve-companion`,
        type: 'keyframe-transaction-update',
        transactionId: drag.transactionId,
        historyBatchId: drag.historyBatchId,
        source: 'ui',
        phase: 'update',
        clipId: drag.clipId,
        keyframeIds: stableKeyframeIds,
        operations: [selectionOperation],
      };
      const selectionResult = applyTimelineEditOperation(selectionUpdate, {
        ...APPLY_OPTIONS,
        deferHistoryCommit: true,
      });
      if (!selectionResult.success) {
        cancelActiveEdit();
        return false;
      }
      drag.latestOperations = [...contentOperations, selectionOperation];
    } else {
      drag.latestOperations = operations;
    }

    drag.latestPosition = nextPosition;
    drag.moved = true;
    return true;
  }, [applyTimelineEditOperation, cancelActiveEdit, getClipKeyframes]);

  const commitActiveEdit = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      cancelActiveEdit();
      return;
    }
    const operation: KeyframeTransactionCommitOperation = {
      id: `${drag.transactionId}:commit`,
      type: 'keyframe-transaction-commit',
      transactionId: drag.transactionId,
      historyBatchId: drag.historyBatchId,
      source: 'ui',
      phase: 'commit',
      clipId: drag.clipId,
      keyframeIds: drag.keyframeIds,
      operations: drag.latestOperations,
    };
    const result = applyTimelineEditOperation(operation, APPLY_OPTIONS);
    if (!result.success) {
      cancelActiveEdit();
      return;
    }
    clearDrag();
  }, [applyTimelineEditOperation, cancelActiveEdit, clearDrag]);

  const handleNodePointerDown = useCallback((
    event: ReactPointerEvent<SVGCircleElement>,
    projectedNode: ProjectedMotionPathNode,
  ) => {
    if (event.button !== 0 || !eligibility.eligible || !clip || !projection || dragRef.current) return;
    const node = nodes.find((candidate) => candidate.id === projectedNode.id);
    if (!node) return;

    event.preventDefault();
    event.stopPropagation();
    const keyframeIds = [node.xKeyframeId, node.yKeyframeId]
      .filter((keyframeId): keyframeId is string => keyframeId !== null);
    const transaction = beginMotionPathTransaction(clip.id, keyframeIds);
    if (!transaction) return;

    const drag: ActiveMotionPathNodeDrag = {
      kind: 'node',
      inputMode: 'pointer',
      clipId: clip.id,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: { x: node.x, y: node.y },
      latestPosition: { x: node.x, y: node.y },
      node,
      projection,
      viewZoom: Math.max(0.0001, Number.isFinite(viewZoom) ? viewZoom : 1),
      ...transaction,
      keyframeIds,
      moved: false,
      latestOperations: [],
    };
    dragRef.current = drag;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      cancelActiveEdit();
      return;
    }
    setActiveNodeId(node.id);
    setIsDragging(true);
  }, [beginMotionPathTransaction, cancelActiveEdit, clip, eligibility.eligible, nodes, projection, viewZoom]);

  const startHandleEdit = useCallback((
    handle: MotionPathSpatialHandle,
    inputMode: 'pointer' | 'keyboard',
    pointer?: {
      pointerId: number;
      clientX: number;
      clientY: number;
      captureTarget: SVGCircleElement;
    },
  ): ActiveMotionPathHandleDrag | null => {
    if (!clip || !projection || dragRef.current) return null;
    const keyframeIds = [handle.xKeyframeId, handle.yKeyframeId];
    const transaction = beginMotionPathTransaction(clip.id, keyframeIds);
    if (!transaction) return null;

    const drag: ActiveMotionPathHandleDrag = {
      kind: 'handle',
      inputMode,
      clipId: clip.id,
      pointerId: pointer?.pointerId ?? null,
      captureTarget: pointer?.captureTarget ?? null,
      startClient: { x: pointer?.clientX ?? 0, y: pointer?.clientY ?? 0 },
      startPosition: { ...handle.position },
      latestPosition: { ...handle.position },
      handle,
      projection,
      viewZoom: Math.max(0.0001, Number.isFinite(viewZoom) ? viewZoom : 1),
      ...transaction,
      keyframeIds,
      moved: false,
      latestOperations: [],
    };
    dragRef.current = drag;
    if (pointer) {
      try {
        pointer.captureTarget.setPointerCapture?.(pointer.pointerId);
      } catch {
        cancelActiveEdit();
        return null;
      }
    }
    setActiveHandleId(handle.id);
    setIsDragging(true);
    return drag;
  }, [beginMotionPathTransaction, cancelActiveEdit, clip, projection, viewZoom]);

  const handleHandlePointerDown = useCallback((
    event: ReactPointerEvent<SVGCircleElement>,
    projectedHandle: ProjectedMotionPathHandle,
  ) => {
    if (event.button !== 0 || !eligibility.eligible || dragRef.current) return;
    const handle = spatialHandles.find((candidate) => candidate.id === projectedHandle.id);
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    startHandleEdit(handle, 'pointer', {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      captureTarget: event.currentTarget,
    });
  }, [eligibility.eligible, spatialHandles, startHandleEdit]);

  const handleHandleKeyDown = useCallback((
    event: ReactKeyboardEvent<SVGCircleElement>,
    projectedHandle: ProjectedMotionPathHandle,
  ) => {
    const isArrow = event.key === 'ArrowLeft'
      || event.key === 'ArrowRight'
      || event.key === 'ArrowUp'
      || event.key === 'ArrowDown';
    if (!isArrow && event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();

    const active = dragRef.current;
    if (event.key === 'Escape') {
      if (active?.inputMode === 'keyboard' && active.kind === 'handle'
        && active.handle.id === projectedHandle.id) {
        cancelActiveEdit();
      }
      return;
    }
    if (event.key === 'Enter' && active) {
      if (active.inputMode === 'keyboard' && active.kind === 'handle'
        && active.handle.id === projectedHandle.id) {
        commitActiveEdit();
      }
      return;
    }
    if (!eligibility.eligible) return;

    const handle = spatialHandles.find((candidate) => candidate.id === projectedHandle.id);
    if (!handle) return;
    const drag = active ?? startHandleEdit(handle, 'keyboard');
    if (!drag || drag.inputMode !== 'keyboard' || drag.kind !== 'handle'
      || drag.handle.id !== handle.id) return;
    if (event.key === 'Enter') return;

    const step = event.shiftKey ? 10 : 1;
    const canvasDelta = {
      x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    };
    const storedDelta = resolveMotionPathPositionDelta(drag.latestPosition, {
      x: canvasDelta.x / drag.viewZoom,
      y: canvasDelta.y / drag.viewZoom,
    }, drag.projection);
    applyActiveDragPosition(drag, {
      x: drag.latestPosition.x + storedDelta.x,
      y: drag.latestPosition.y + storedDelta.y,
    });
  }, [
    applyActiveDragPosition,
    cancelActiveEdit,
    commitActiveEdit,
    eligibility.eligible,
    spatialHandles,
    startHandleEdit,
  ]);

  const handleHandleBlur = useCallback((
    _event: ReactFocusEvent<SVGCircleElement>,
    projectedHandle: ProjectedMotionPathHandle,
  ) => {
    const active = dragRef.current;
    if (active?.inputMode === 'keyboard' && active.kind === 'handle'
      && active.handle.id === projectedHandle.id) {
      cancelActiveEdit();
    }
  }, [cancelActiveEdit]);

  useEffect(() => {
    if (!isDragging) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.inputMode !== 'pointer' || event.pointerId !== drag.pointerId) return;
      const screenDelta = {
        x: event.clientX - drag.startClient.x,
        y: event.clientY - drag.startClient.y,
      };
      if (screenDelta.x === 0 && screenDelta.y === 0) return;
      event.preventDefault();

      const storedDelta = resolveMotionPathPositionDelta(drag.startPosition, {
        x: screenDelta.x / drag.viewZoom,
        y: screenDelta.y / drag.viewZoom,
      }, drag.projection);
      applyActiveDragPosition(drag, {
        x: drag.startPosition.x + storedDelta.x,
        y: drag.startPosition.y + storedDelta.y,
      });
    };

    const commitFromPointer = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.inputMode !== 'pointer' || event.pointerId !== drag.pointerId) return;
      commitActiveEdit();
    };

    const cancelFromPointer = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.inputMode !== 'pointer' || event.pointerId !== drag.pointerId) return;
      cancelActiveEdit();
    };
    const cancelFromBlur = () => cancelActiveEdit();

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', commitFromPointer);
    document.addEventListener('pointercancel', cancelFromPointer);
    window.addEventListener('blur', cancelFromBlur);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', commitFromPointer);
      document.removeEventListener('pointercancel', cancelFromPointer);
      window.removeEventListener('blur', cancelFromBlur);
    };
  }, [
    applyActiveDragPosition,
    cancelActiveEdit,
    commitActiveEdit,
    isDragging,
  ]);

  useEffect(() => {
    const drag = dragRef.current;
    if (drag && (!eligibility.eligible || drag.clipId !== clipId)) {
      const timeoutId = window.setTimeout(cancelActiveEdit, 0);
      return () => window.clearTimeout(timeoutId);
    }
    return undefined;
  }, [cancelActiveEdit, clipId, eligibility.eligible]);

  useEffect(() => () => cancelRef.current(), []);

  return {
    eligibility,
    overlayProps: {
      visible: eligibility.eligible,
      samples: projectedSamples,
      nodes: projectedNodes,
      handles: projectedHandles,
      onionPositions: projectedOnions,
      activeNodeId,
      activeHandleId,
      onNodePointerDown: handleNodePointerDown,
      onHandlePointerDown: handleHandlePointerDown,
      onHandleKeyDown: handleHandleKeyDown,
      onHandleBlur: handleHandleBlur,
    },
    cancelActiveEdit,
  };
}
