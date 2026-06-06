// Transition-related actions slice.
// The public actions stay as compatibility wrappers; the operation kernel owns mutation and batching.

import type { TransitionActions, SliceCreator } from './types';
import { createTransitionJunctionGeometryReference } from './editOperations/transitionOperations';
import type { TimelineEditResult } from './editOperations/types';
import { Logger } from '../../services/logger';

const log = Logger.create('Transitions');

const JUNCTION_THRESHOLD_SECONDS = 0.5;

function logFailedTransition(action: string, result: TimelineEditResult): void {
  if (result.success) return;
  log.warn(action, { warnings: result.warnings });
}

export const createTransitionSlice: SliceCreator<TransitionActions> = (_set, get) => ({
  /**
   * Apply a transition between two adjacent clips.
   * Creates overlap by moving clipB earlier; the operation kernel owns validation and batching.
   */
  applyTransition: (clipAId, clipBId, type, duration, options = {}) => {
    const operationId = `transition-apply:${Date.now()}`;
    const { clips } = get();
    const clipA = clips.find(c => c.id === clipAId);
    const clipB = clips.find(c => c.id === clipBId);
    const junctionTime = clipA ? clipA.startTime + clipA.duration : clipB?.startTime ?? 0;
    const trackId = clipA?.trackId ?? clipB?.trackId ?? '';

    const result = get().applyTimelineEditOperation({
      id: operationId,
      type: 'transition-apply',
      transactionId: operationId,
      historyBatchId: operationId,
      source: options.source ?? 'ui',
      geometrySnapshotId: `transition-geometry:${operationId}`,
      clipAId,
      clipBId,
      transitionType: type,
      requestedDuration: duration,
      junction: createTransitionJunctionGeometryReference({
        operationId,
        trackId,
        clipAId,
        clipBId,
        junctionTime,
        thresholdSeconds: JUNCTION_THRESHOLD_SECONDS,
      }),
    }, {
      source: options.source ?? 'ui',
      historyLabel: options.historyLabel ?? 'Apply transition',
    });
    logFailedTransition('Cannot apply transition', result);
    return result;
  },

  /**
   * Remove a transition from a clip edge.
   */
  removeTransition: (clipId, edge, options = {}) => {
    const operationId = `transition-remove:${Date.now()}`;
    const result = get().applyTimelineEditOperation({
      id: operationId,
      type: 'transition-remove',
      transactionId: operationId,
      historyBatchId: operationId,
      source: options.source ?? 'ui',
      clipId,
      edge,
    }, {
      source: options.source ?? 'ui',
      historyLabel: options.historyLabel ?? 'Remove transition',
    });
    logFailedTransition('Cannot remove transition', result);
    return result;
  },

  /**
   * Update the duration of an existing transition.
   */
  updateTransitionDuration: (clipId, edge, newDuration, options = {}) => {
    const operationId = `transition-update-duration:${Date.now()}`;
    const result = get().applyTimelineEditOperation({
      id: operationId,
      type: 'transition-update-duration',
      transactionId: operationId,
      historyBatchId: operationId,
      source: options.source ?? 'ui',
      clipId,
      edge,
      requestedDuration: newDuration,
    }, {
      source: options.source ?? 'ui',
      historyLabel: options.historyLabel ?? 'Update transition duration',
    });
    logFailedTransition('Cannot update transition duration', result);
    return result;
  },

  /**
   * Find a junction between two clips at a given time.
   */
  findClipJunction: (trackId: string, time: number, threshold: number = JUNCTION_THRESHOLD_SECONDS) => {
    const { clips } = get();

    const trackClips = clips
      .filter(c => c.trackId === trackId)
      .toSorted((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < trackClips.length - 1; i++) {
      const clipA = trackClips[i];
      const clipB = trackClips[i + 1];
      const clipAEnd = clipA.startTime + clipA.duration;
      const gap = clipB.startTime - clipAEnd;

      if (Math.abs(gap) < 0.1 || (clipA.transitionOut && clipB.transitionIn)) {
        const junctionTime = clipA.transitionOut
          ? clipAEnd - clipA.transitionOut.duration / 2
          : clipAEnd;

        if (Math.abs(time - junctionTime) < threshold) {
          return { clipA, clipB, junctionTime };
        }
      }
    }

    return null;
  },
});
