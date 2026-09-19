import { useCallback } from 'react';
import type { TimelineStore } from '../../../stores/timeline/types';

export function useTimelineKeyframeContextMenuDelete(
  applyTimelineEditOperation: TimelineStore['applyTimelineEditOperation'],
): (keyframeIds: string[]) => void {
  return useCallback((keyframeIds: string[]) => {
    const transactionId = `context-menu-delete-keyframes:${Date.now()}`;
    applyTimelineEditOperation({
      id: transactionId,
      type: 'keyboard-delete-command',
      transactionId,
      historyBatchId: transactionId,
      source: 'context-menu',
      command: 'delete',
      priority: 'keyframes-only',
      keyframeIds,
      clipIds: [],
      includeLinked: false,
    }, {
      source: 'context-menu',
      historyLabel: keyframeIds.length > 1 ? 'Delete keyframes' : 'Delete keyframe',
    });
  }, [applyTimelineEditOperation]);
}
