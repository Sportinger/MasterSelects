import { useCallback, useRef } from 'react';
import type { AnimatableProperty, Keyframe } from '../../../types';
import { Logger } from '../../../services/logger';
import type { ClipInteractionShellCommandContext } from '../interactionShell';
import type { TimelineTrackProps } from '../types';

type KeyframeTickMovePhase = 'begin' | 'update' | 'commit';

type KeyframeTickTransaction = {
  transactionId: string;
  historyBatchId: string;
  clipId: string;
  property?: AnimatableProperty;
  keyframeIds: string[];
  originalTimes: Map<string, number>;
  hasUpdate: boolean;
};

export type UseClipInteractionShellKeyframeGroupMoveArgs = {
  applyTimelineEditOperation?: TimelineTrackProps['applyTimelineEditOperation'];
  onMoveKeyframeGroup?: TimelineTrackProps['onMoveKeyframeGroup'];
};

const log = Logger.create('ClipInteractionShellKeyframeGroupMove');

export function useClipInteractionShellKeyframeGroupMove({
  applyTimelineEditOperation,
  onMoveKeyframeGroup,
}: UseClipInteractionShellKeyframeGroupMoveArgs) {
  const keyframeTickTransactionRef = useRef<KeyframeTickTransaction | null>(null);
  const keyframeTickTransactionCounterRef = useRef(0);

  return useCallback((
    keyframeIds: string[],
    newTime: number,
    context: ClipInteractionShellCommandContext,
    phase: KeyframeTickMovePhase = 'update',
  ) => {
    const keyframeIdSet = new Set(keyframeIds);
    const targetKeyframes = (context.activeModules.keyframe?.keyframes ?? [])
      .filter((keyframe): keyframe is Keyframe => keyframeIdSet.has(keyframe.id));

    if (!applyTimelineEditOperation) {
      if (phase === 'update') {
        onMoveKeyframeGroup?.(keyframeIds, newTime);
      }
      return;
    }

    const targetKeyframeIdSet = new Set(targetKeyframes.map((keyframe) => keyframe.id));
    const missingKeyframeIds = keyframeIds.filter((keyframeId) => !targetKeyframeIdSet.has(keyframeId));
    if (missingKeyframeIds.length > 0) {
      const existing = keyframeTickTransactionRef.current;
      const shouldClearSession = existing?.clipId === context.clip.id &&
        keyframeIds.some((keyframeId) => existing.originalTimes.has(keyframeId));
      if (shouldClearSession) {
        applyTimelineEditOperation({
          id: `${existing.transactionId}:cancel:missing-target`,
          type: 'keyframe-transaction-cancel',
          transactionId: existing.transactionId,
          historyBatchId: existing.historyBatchId,
          source: 'ui',
          phase: 'cancel',
          clipId: existing.clipId,
          property: existing.property,
          keyframeIds: existing.keyframeIds,
          restoreKeyframeIds: existing.keyframeIds,
          discardKeyframeIds: [],
        }, { source: 'ui', historyLabel: 'Cancel keyframe move' });
        keyframeTickTransactionRef.current = null;
      }
      if (shouldClearSession || phase !== 'update') {
        log.warn('Skipped keyframe group move for missing typed targets', {
          clipId: context.clip.id,
          keyframeIds,
          missingKeyframeIds,
          phase,
        });
      }
      return;
    }

    const resolvedKeyframeIds = targetKeyframes.map((keyframe) => keyframe.id);
    const sessionMatches = (session: KeyframeTickTransaction) => (
      session.clipId === context.clip.id &&
      resolvedKeyframeIds.length === session.keyframeIds.length &&
      resolvedKeyframeIds.every((keyframeId) => session.originalTimes.has(keyframeId))
    );

    const ensureSession = () => {
      const existing = keyframeTickTransactionRef.current;
      if (existing && sessionMatches(existing)) return existing;

      keyframeTickTransactionCounterRef.current += 1;
      const transactionId = `keyframe-tick:${context.clip.id}:${keyframeTickTransactionCounterRef.current}`;
      const session: KeyframeTickTransaction = {
        transactionId,
        historyBatchId: `${transactionId}:history`,
        clipId: context.clip.id,
        property: targetKeyframes[0]?.property,
        keyframeIds: resolvedKeyframeIds,
        originalTimes: new Map(targetKeyframes.map((keyframe) => [keyframe.id, keyframe.time])),
        hasUpdate: false,
      };
      keyframeTickTransactionRef.current = session;
      applyTimelineEditOperation({
        id: `${transactionId}:begin`,
        type: 'keyframe-transaction-begin',
        transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'begin',
        clipId: context.clip.id,
        property: session.property,
        keyframeIds: resolvedKeyframeIds,
        intent: 'drag-diamond',
      }, {
        source: 'ui',
        historyLabel: 'Begin keyframe move',
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
        keyframeIds: session.keyframeIds,
        restoreKeyframeIds: session.keyframeIds,
        discardKeyframeIds: [],
      }, { source: 'ui', historyLabel: 'Cancel keyframe move' });
      keyframeTickTransactionRef.current = null;
      return;
    }

    const operations = targetKeyframes.map((keyframe) => ({
      type: 'keyframe-move' as const,
      keyframeId: keyframe.id,
      clipId: keyframe.clipId,
      property: keyframe.property,
      originalTime: session.originalTimes.get(keyframe.id) ?? keyframe.time,
      requestedTime: newTime,
      resolvedTime: newTime,
    }));

    if (phase === 'commit') {
      applyTimelineEditOperation({
        id: `${session.transactionId}:commit:${newTime.toFixed(6)}`,
        type: 'keyframe-transaction-commit',
        transactionId: session.transactionId,
        historyBatchId: session.historyBatchId,
        source: 'ui',
        phase: 'commit',
        clipId: context.clip.id,
        property: session.property,
        keyframeIds: session.keyframeIds,
        operations,
      }, {
        source: 'ui',
        historyLabel: 'Move keyframes',
      });
      keyframeTickTransactionRef.current = null;
      return;
    }

    session.hasUpdate = true;
    applyTimelineEditOperation({
      id: `${session.transactionId}:update:${newTime.toFixed(6)}`,
      type: 'keyframe-transaction-update',
      transactionId: session.transactionId,
      historyBatchId: session.historyBatchId,
      source: 'ui',
      phase: 'update',
      clipId: context.clip.id,
      property: session.property,
      keyframeIds: session.keyframeIds,
      operations,
    }, {
      source: 'ui',
      historyLabel: 'Move keyframes',
      deferHistoryCommit: true,
    });
  }, [applyTimelineEditOperation, onMoveKeyframeGroup]);
}
