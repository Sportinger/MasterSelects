import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../types/timeline';
import { Logger } from '../../../../services/logger';
import { isAIExecutionActive } from '../../executionState';

const log = Logger.create('AITool:Clips');

/** Resolve clip background color for ghost overlays */
export function getClipColor(clip: TimelineClip): string {
  if (clip.source?.type === 'audio') return '#2d6b4a';
  if (clip.source?.type === 'text') return '#5c3d7a';
  if (clip.source?.type === 'solid' && clip.solidColor) return clip.solidColor;
  return '#3d5a80';
}

export type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

function getHeapSnapshot():
  | {
      heapUsedMB: number;
      heapTotalMB: number;
      heapLimitMB: number;
    }
  | undefined {
  const perf = performance as Performance & {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  };
  const memory = perf.memory;
  if (!memory) return undefined;

  return {
    heapUsedMB: Math.round(memory.usedJSHeapSize / (1024 * 1024)),
    heapTotalMB: Math.round(memory.totalJSHeapSize / (1024 * 1024)),
    heapLimitMB: Math.round(memory.jsHeapSizeLimit / (1024 * 1024)),
  };
}

export function logSplitCheckpoint(
  stage: string,
  clip: TimelineClip,
  splitCount: number,
  withLinked: boolean
): void {
  const state = useTimelineStore.getState();
  log.warn(`[split-checkpoint:${stage}] ${clip.id}`, {
    clipId: clip.id,
    clipName: clip.name,
    splitCount,
    withLinked,
    aiExecutionActive: isAIExecutionActive(),
    totalClips: state.clips.length,
    totalTracks: state.tracks.length,
    selectedClipIds: state.selectedClipIds.size,
    ...getHeapSnapshot(),
  });
}

/**
 * Bulk split via the shared timeline operation kernel.
 * The kernel owns clip cloning, linked-audio handling, export lock, and history.
 */
export function splitClipBatch(clip: TimelineClip, splitTimes: number[], withLinked = true): void {
  const result = useTimelineStore.getState().applyTimelineEditOperation({
    id: `ai-split-at-times:${clip.id}:${splitTimes.join(',')}`,
    type: 'split-at-times',
    clipId: clip.id,
    times: splitTimes,
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: split clip at times',
  });
  if (!result.success) {
    throw new Error(result.warnings.map((warning) => warning.message).join(' ') || 'Split operation failed');
  }
}
