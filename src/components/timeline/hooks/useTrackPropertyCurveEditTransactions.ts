import { useCallback, useRef } from 'react';
import type { AnimatableProperty, BezierHandle, Keyframe } from '../../../types';
import type { CurveEditorEditPhase } from '../CurveEditor';
import type { TimelineTrackProps } from '../types';
import { Logger } from '../../../services/logger';

const log = Logger.create('TrackPropertyCurveEditTransactions');

type CurveKeyframeSession = {
  transactionId: string;
  historyBatchId: string;
  clipId: string;
  property: AnimatableProperty;
  keyframeId: string;
  originalTime: number;
  originalValue: number;
  hasUpdate: boolean;
};

type CurveBezierSession = {
  transactionId: string;
  historyBatchId: string;
  clipId: string;
  property: AnimatableProperty;
  keyframeId: string;
  handle: 'in' | 'out';
  hasUpdate: boolean;
};

export type UseTrackPropertyCurveEditTransactionsArgs = {
  allKeyframes: readonly Keyframe[];
  applyTimelineEditOperation?: TimelineTrackProps['applyTimelineEditOperation'];
  onMoveKeyframe: TimelineTrackProps['onMoveKeyframe'];
  onUpdateBezierHandle: TimelineTrackProps['onUpdateBezierHandle'];
};

export function useTrackPropertyCurveEditTransactions({
  allKeyframes,
  applyTimelineEditOperation,
  onMoveKeyframe,
  onUpdateBezierHandle,
}: UseTrackPropertyCurveEditTransactionsArgs) {
  const curveTransactionCounterRef = useRef(0);
  const curveKeyframeTransactionRef = useRef<CurveKeyframeSession | null>(null);
  const curveBezierTransactionRef = useRef<CurveBezierSession | null>(null);

  const findCurveKeyframe = useCallback(
    (keyframeId: string) => allKeyframes.find((keyframe) => keyframe.id === keyframeId),
    [allKeyframes],
  );

  const nextCurveTransactionId = useCallback((kind: string, keyframeId: string) => {
    curveTransactionCounterRef.current += 1;
    return `curve-editor:${kind}:${keyframeId}:${curveTransactionCounterRef.current}`;
  }, []);

  const handleCurveKeyframeMove = useCallback((
    keyframeId: string,
    newTime: number,
    newValue: number,
    phase?: CurveEditorEditPhase,
  ) => {
    const target = findCurveKeyframe(keyframeId);
    if (!applyTimelineEditOperation) {
      if (phase === undefined || phase === 'update') {
        onMoveKeyframe(keyframeId, newTime);
      }
      return;
    }
    if (!target) {
      const clearedSession = curveKeyframeTransactionRef.current?.keyframeId === keyframeId;
      if (curveKeyframeTransactionRef.current?.keyframeId === keyframeId) {
        const session = curveKeyframeTransactionRef.current;
        applyTimelineEditOperation({
          id: `${session.transactionId}:cancel:missing-target`,
          type: 'keyframe-transaction-cancel',
          transactionId: session.transactionId,
          historyBatchId: session.historyBatchId,
          source: 'ui',
          phase: 'cancel',
          clipId: session.clipId,
          property: session.property,
          keyframeIds: [session.keyframeId],
          restoreKeyframeIds: [session.keyframeId],
          discardKeyframeIds: [],
        }, { source: 'ui', historyLabel: 'Cancel curve keyframe edit' });
        curveKeyframeTransactionRef.current = null;
      }
      if (clearedSession || phase !== 'update') {
        log.warn('Skipped curve keyframe edit for missing typed target', {
          keyframeId,
          phase: phase ?? 'single',
        });
      }
      return;
    }

    const ensureSession = () => {
      const existing = curveKeyframeTransactionRef.current;
      if (existing?.keyframeId === keyframeId) return existing;

      const transactionId = nextCurveTransactionId('keyframe', keyframeId);
      const session: CurveKeyframeSession = {
        transactionId,
        historyBatchId: `${transactionId}:history`,
        clipId: target.clipId,
        property: target.property,
        keyframeId,
        originalTime: target.time,
        originalValue: target.value,
        hasUpdate: false,
      };
      curveKeyframeTransactionRef.current = session;
      applyTimelineEditOperation({
        id: `${transactionId}:begin`,
        type: 'keyframe-transaction-begin',
        transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'begin',
        clipId: target.clipId,
        property: target.property,
        keyframeIds: [keyframeId],
        intent: 'curve-editor',
      }, {
        source: 'ui',
        historyLabel: 'Begin curve keyframe edit',
      });
      return session;
    };

    const session = ensureSession();
    if (phase === 'begin') return;
    if (phase === 'commit' && !session.hasUpdate) {
      applyTimelineEditOperation({
        id: `${session.transactionId}:cancel:no-update`,
        type: 'keyframe-transaction-cancel',
        transactionId: session.transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'cancel',
        clipId: session.clipId,
        property: session.property,
        keyframeIds: [session.keyframeId],
        restoreKeyframeIds: [session.keyframeId],
        discardKeyframeIds: [],
      }, { source: 'ui', historyLabel: 'Cancel curve keyframe edit' });
      curveKeyframeTransactionRef.current = null;
      return;
    }

    const operations = [
      {
        type: 'keyframe-move' as const,
        keyframeId,
        clipId: session.clipId,
        property: session.property,
        originalTime: session.originalTime,
        requestedTime: newTime,
        resolvedTime: newTime,
      },
      {
        type: 'keyframe-update-value' as const,
        keyframeId,
        clipId: session.clipId,
        property: session.property,
        value: { value: newValue },
      },
    ];

    if (phase === 'commit') {
      applyTimelineEditOperation({
        id: `${session.transactionId}:commit:${newTime.toFixed(6)}:${newValue.toFixed(6)}`,
        type: 'keyframe-transaction-commit',
        transactionId: session.transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'commit',
        clipId: session.clipId,
        property: session.property,
        keyframeIds: [keyframeId],
        operations,
      }, {
        source: 'ui',
        historyLabel: 'Edit curve keyframe',
      });
      curveKeyframeTransactionRef.current = null;
      return;
    }

    session.hasUpdate = true;
    applyTimelineEditOperation({
      id: `${session.transactionId}:update:${newTime.toFixed(6)}:${newValue.toFixed(6)}`,
      type: 'keyframe-transaction-update',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'update',
      clipId: session.clipId,
      property: session.property,
      keyframeIds: [keyframeId],
      operations,
    }, {
      source: 'ui',
      historyLabel: 'Edit curve keyframe',
      deferHistoryCommit: true,
    });
  }, [applyTimelineEditOperation, findCurveKeyframe, nextCurveTransactionId, onMoveKeyframe]);

  const handleCurveBezierHandleUpdate = useCallback((
    keyframeId: string,
    handle: 'in' | 'out',
    position: BezierHandle,
    phase?: CurveEditorEditPhase,
  ) => {
    const target = findCurveKeyframe(keyframeId);
    if (!applyTimelineEditOperation) {
      if (phase === undefined || phase === 'update') {
        onUpdateBezierHandle(keyframeId, handle, position);
      }
      return;
    }
    if (!target) {
      const existing = curveBezierTransactionRef.current;
      const clearedSession = existing?.keyframeId === keyframeId && existing.handle === handle;
      if (existing?.keyframeId === keyframeId && existing.handle === handle) {
        applyTimelineEditOperation({
          id: `${existing.transactionId}:cancel:missing-target`,
          type: 'keyframe-transaction-cancel',
          transactionId: existing.transactionId,
          historyBatchId: existing.historyBatchId,
          source: 'ui',
          phase: 'cancel',
          clipId: existing.clipId,
          property: existing.property,
          keyframeIds: [existing.keyframeId],
          restoreKeyframeIds: [existing.keyframeId],
          discardKeyframeIds: [],
        }, { source: 'ui', historyLabel: 'Cancel bezier handle edit' });
        curveBezierTransactionRef.current = null;
      }
      if (clearedSession || phase !== 'update') {
        log.warn('Skipped curve bezier handle edit for missing typed target', {
          keyframeId,
          handle,
          phase: phase ?? 'single',
        });
      }
      return;
    }

    const buildOperation = (session: {
      clipId: string;
      property: AnimatableProperty;
      keyframeId: string;
    }) => ({
      type: 'keyframe-update-bezier-handle' as const,
      keyframeId: session.keyframeId,
      clipId: session.clipId,
      property: session.property,
      handle,
      position,
    });

    if (phase === undefined) {
      const transactionId = nextCurveTransactionId(`bezier-${handle}`, keyframeId);
      applyTimelineEditOperation({
        id: `${transactionId}:commit`,
        type: 'keyframe-transaction-commit',
        transactionId,
        historyBatchId: `${transactionId}:history`,
        source: 'ui',
        phase: 'commit',
        clipId: target.clipId,
        property: target.property,
        keyframeIds: [keyframeId],
        operations: [buildOperation({
          clipId: target.clipId,
          property: target.property,
          keyframeId,
        })],
      }, {
        source: 'ui',
        historyLabel: 'Edit bezier handle',
      });
      return;
    }

    const ensureSession = () => {
      const existing = curveBezierTransactionRef.current;
      if (existing?.keyframeId === keyframeId && existing.handle === handle) return existing;

      const transactionId = nextCurveTransactionId(`bezier-${handle}`, keyframeId);
      const session: CurveBezierSession = {
        transactionId,
        historyBatchId: `${transactionId}:history`,
        clipId: target.clipId,
        property: target.property,
        keyframeId,
        handle,
        hasUpdate: false,
      };
      curveBezierTransactionRef.current = session;
      applyTimelineEditOperation({
        id: `${transactionId}:begin`,
        type: 'keyframe-transaction-begin',
        transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'begin',
        clipId: target.clipId,
        property: target.property,
        keyframeIds: [keyframeId],
        intent: 'curve-editor',
      }, {
        source: 'ui',
        historyLabel: 'Begin bezier handle edit',
      });
      return session;
    };

    const session = ensureSession();
    if (phase === 'begin') return;
    if (phase === 'commit' && !session.hasUpdate) {
      applyTimelineEditOperation({
        id: `${session.transactionId}:cancel:no-update`,
        type: 'keyframe-transaction-cancel',
        transactionId: session.transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'cancel',
        clipId: session.clipId,
        property: session.property,
        keyframeIds: [session.keyframeId],
        restoreKeyframeIds: [session.keyframeId],
        discardKeyframeIds: [],
      }, { source: 'ui', historyLabel: 'Cancel bezier handle edit' });
      curveBezierTransactionRef.current = null;
      return;
    }

    const operation = buildOperation(session);
    if (phase === 'commit') {
      applyTimelineEditOperation({
        id: `${session.transactionId}:commit`,
        type: 'keyframe-transaction-commit',
        transactionId: session.transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'commit',
        clipId: session.clipId,
        property: session.property,
        keyframeIds: [keyframeId],
        operations: [operation],
      }, {
        source: 'ui',
        historyLabel: 'Edit bezier handle',
      });
      curveBezierTransactionRef.current = null;
      return;
    }

    session.hasUpdate = true;
    applyTimelineEditOperation({
      id: `${session.transactionId}:update:${position.x.toFixed(6)}:${position.y.toFixed(6)}`,
      type: 'keyframe-transaction-update',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'update',
      clipId: session.clipId,
      property: session.property,
      keyframeIds: [keyframeId],
      operations: [operation],
    }, {
      source: 'ui',
      historyLabel: 'Edit bezier handle',
      deferHistoryCommit: true,
    });
  }, [applyTimelineEditOperation, findCurveKeyframe, nextCurveTransactionId, onUpdateBezierHandle]);

  return {
    handleCurveBezierHandleUpdate,
    handleCurveKeyframeMove,
  };
}
