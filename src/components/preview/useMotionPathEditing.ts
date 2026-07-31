import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  projectMotionPathPosition,
  resolveMotionPathEligibility,
  resolveMotionPathPositionDelta,
  sampleMotionPath,
  sampleMotionPathOnionPositions,
  type MotionPathEligibility,
  type MotionPathNode,
  type MotionPathPosition,
  type MotionPathProjectionContext,
} from './motionPathGeometry';
import type {
  MotionPathOverlayProps,
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

interface ActiveMotionPathDrag {
  clipId: string;
  pointerId: number;
  startClient: MotionPathPosition;
  startPosition: MotionPathPosition;
  node: MotionPathNode;
  projection: MotionPathProjectionContext;
  viewZoom: number;
  transactionId: string;
  historyBatchId: string;
  keyframeIds: string[];
  moved: boolean;
  latestOperations: readonly KeyframeEditOperation[];
}

function nextTransactionId(clipId: string): string {
  transactionSequence += 1;
  return `viewport-motion-path:${clipId}:${Date.now()}:${transactionSequence}`;
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
  const applyTimelineEditOperation = useTimelineStore((state) => state.applyTimelineEditOperation);
  const dragRef = useRef<ActiveMotionPathDrag | null>(null);
  const cancelRef = useRef<() => void>(() => undefined);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
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
        ...projectMotionPathPosition(node, projection),
      }))
    : [], [nodes, projection]);
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
    dragRef.current = null;
    setActiveNodeId(null);
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

  const handleNodePointerDown = useCallback((
    event: ReactPointerEvent<SVGCircleElement>,
    projectedNode: ProjectedMotionPathNode,
  ) => {
    if (event.button !== 0 || !eligibility.eligible || !clip || !projection || dragRef.current) return;
    const node = nodes.find((candidate) => candidate.id === projectedNode.id);
    if (!node) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const transactionId = nextTransactionId(clip.id);
    const historyBatchId = `${transactionId}:history`;
    const keyframeIds = [node.xKeyframeId, node.yKeyframeId]
      .filter((keyframeId): keyframeId is string => keyframeId !== null);
    const operation: KeyframeTransactionBeginOperation = {
      id: `${transactionId}:begin`,
      type: 'keyframe-transaction-begin',
      transactionId,
      historyBatchId,
      source: 'ui',
      phase: 'begin',
      clipId: clip.id,
      keyframeIds,
      intent: 'viewport-motion-path',
    };
    const result = applyTimelineEditOperation(operation, {
      ...APPLY_OPTIONS,
      deferHistoryCommit: true,
    });
    if (!result.success) return;

    dragRef.current = {
      clipId: clip.id,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: { x: node.x, y: node.y },
      node,
      projection,
      viewZoom: Math.max(0.0001, Number.isFinite(viewZoom) ? viewZoom : 1),
      transactionId,
      historyBatchId,
      keyframeIds,
      moved: false,
      latestOperations: [],
    };
    setActiveNodeId(node.id);
    setIsDragging(true);
  }, [applyTimelineEditOperation, clip, eligibility.eligible, nodes, projection, viewZoom]);

  useEffect(() => {
    if (!isDragging) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
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
      const operations = buildMotionPathPositionUpsertOperations(drag.clipId, drag.node, {
        x: drag.startPosition.x + storedDelta.x,
        y: drag.startPosition.y + storedDelta.y,
      });
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
        return;
      }
      drag.moved = true;
      drag.latestOperations = operations;
    };

    const commitActiveEdit = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
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
      applyTimelineEditOperation(operation, APPLY_OPTIONS);
      clearDrag();
    };

    const cancelFromPointer = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      cancelActiveEdit();
    };
    const cancelFromBlur = () => cancelActiveEdit();

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', commitActiveEdit);
    document.addEventListener('pointercancel', cancelFromPointer);
    window.addEventListener('blur', cancelFromBlur);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', commitActiveEdit);
      document.removeEventListener('pointercancel', cancelFromPointer);
      window.removeEventListener('blur', cancelFromBlur);
    };
  }, [
    applyTimelineEditOperation,
    cancelActiveEdit,
    clearDrag,
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
      onionPositions: projectedOnions,
      activeNodeId,
      onNodePointerDown: handleNodePointerDown,
    },
    cancelActiveEdit,
  };
}
