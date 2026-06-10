import { useTimelineStore } from '../../../../stores/timeline';
import type { ToolResult } from '../../types.ts';
import { isAIExecutionActive } from '../../executionState';
import type { TimelineStore } from './runtime';
import { getClipColor } from './runtime';

export async function handleDeleteClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const withLinked = (args.withLinked as boolean | undefined) ?? true;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  // Visual feedback: delete ghost before removing
  if (isAIExecutionActive()) {
    const store = useTimelineStore.getState();
    store.addAIOverlay({
      type: 'delete-ghost', trackId: clip.trackId,
      timePosition: clip.startTime, width: clip.duration,
      clipName: clip.name, clipColor: getClipColor(clip), duration: 350,
    });
    if (withLinked && clip.linkedClipId) {
      const linked = timelineStore.clips.find(c => c.id === clip.linkedClipId);
      if (linked) {
        store.addAIOverlay({
          type: 'delete-ghost', trackId: linked.trackId,
          timePosition: linked.startTime, width: linked.duration,
          clipName: linked.name, clipColor: getClipColor(linked), duration: 350,
        });
      }
    }
  }

  const deleteResult = timelineStore.applyTimelineEditOperation({
    id: `ai-delete-clip:${clipId}`,
    type: 'delete-clips',
    clipIds: [clipId],
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: delete clip',
  });
  if (!deleteResult.success) {
    return {
      success: false,
      error: deleteResult.warnings.map((warning) => warning.message).join(' ') || 'Delete clip operation failed',
    };
  }

  return { success: true, data: { deletedClipId: clipId, clipName: clip.name, withLinked } };
}

export async function handleDeleteClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipIds = args.clipIds as string[];
  const withLinked = (args.withLinked as boolean | undefined) ?? true;
  const currentClips = useTimelineStore.getState().clips;
  const deleted = clipIds.filter((clipId) => currentClips.some((clip) => clip.id === clipId));
  const notFound = clipIds.filter((clipId) => !currentClips.some((clip) => clip.id === clipId));

  if (deleted.length === 0) {
    return {
      success: true,
      data: { deleted, notFound, deletedCount: 0, withLinked },
    };
  }

  for (const clipId of deleted) {
    const clip = currentClips.find(c => c.id === clipId);
    if (clip) {
      // Visual feedback: delete ghost
      if (isAIExecutionActive()) {
        useTimelineStore.getState().addAIOverlay({
          type: 'delete-ghost', trackId: clip.trackId,
          timePosition: clip.startTime, width: clip.duration,
          clipName: clip.name, clipColor: getClipColor(clip), duration: 350,
        });
      }
    }
  }

  const deleteResult = timelineStore.applyTimelineEditOperation({
    id: `ai-delete-clips:${clipIds.join(',')}`,
    type: 'delete-clips',
    clipIds,
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: delete clips',
  });
  if (!deleteResult.success) {
    return {
      success: false,
      error: deleteResult.warnings.map((warning) => warning.message).join(' ') || 'Delete clips operation failed',
    };
  }

  return {
    success: true,
    data: { deleted, notFound, deletedCount: deleted.length, withLinked },
  };
}

export async function handleCutRangesFromClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const ranges = args.ranges as Array<{ timelineStart: number; timelineEnd: number }>;

  // Get initial clip info
  const initialClip = timelineStore.clips.find(c => c.id === clipId);
  if (!initialClip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  const trackId = initialClip.trackId;
  const results: Array<{ range: { start: number; end: number }; status: string }> = [];

  // Sort ranges from END to START (so we don't shift positions)
  const sortedRanges = [...ranges].sort((a, b) => b.timelineStart - a.timelineStart);

  for (const range of sortedRanges) {
    const { timelineStart, timelineEnd } = range;

    // Find the clip that currently contains this range
    // (clip IDs change after splits, so we need to find by position)
    const currentClips = useTimelineStore.getState().clips;
    const targetClip = currentClips.find(c =>
      c.trackId === trackId &&
      c.startTime <= timelineStart &&
      c.startTime + c.duration >= timelineEnd
    );

    if (!targetClip) {
      results.push({ range: { start: timelineStart, end: timelineEnd }, status: 'skipped - no clip at this position' });
      continue;
    }

    const clipEnd = targetClip.startTime + targetClip.duration;

    try {
      // Split at the end of the range (if not at clip boundary)
      if (timelineEnd < clipEnd - 0.01) {
        const splitEndResult = timelineStore.applyTimelineEditOperation({
          id: `ai-cut-range-split-end:${targetClip.id}:${timelineEnd}`,
          type: 'split-at-time',
          clipIds: [targetClip.id],
          time: timelineEnd,
          includeLinked: true,
        }, {
          source: 'ai-tool',
          historyLabel: 'AI: cut range split end',
        });
        if (!splitEndResult.success) {
          results.push({
            range: { start: timelineStart, end: timelineEnd },
            status: `error - ${splitEndResult.warnings.map((warning) => warning.message).join(' ')}`,
          });
          continue;
        }
      }

      // Find the clip again (it may have changed after the split)
      const clipsAfterEndSplit = useTimelineStore.getState().clips;
      const clipForStartSplit = clipsAfterEndSplit.find(c =>
        c.trackId === trackId &&
        c.startTime <= timelineStart &&
        c.startTime + c.duration >= timelineStart + 0.01
      );

      if (!clipForStartSplit) {
        results.push({ range: { start: timelineStart, end: timelineEnd }, status: 'error - lost clip after end split' });
        continue;
      }

      // Split at the start of the range (if not at clip boundary)
      if (timelineStart > clipForStartSplit.startTime + 0.01) {
        const splitStartResult = timelineStore.applyTimelineEditOperation({
          id: `ai-cut-range-split-start:${clipForStartSplit.id}:${timelineStart}`,
          type: 'split-at-time',
          clipIds: [clipForStartSplit.id],
          time: timelineStart,
          includeLinked: true,
        }, {
          source: 'ai-tool',
          historyLabel: 'AI: cut range split start',
        });
        if (!splitStartResult.success) {
          results.push({
            range: { start: timelineStart, end: timelineEnd },
            status: `error - ${splitStartResult.warnings.map((warning) => warning.message).join(' ')}`,
          });
          continue;
        }
      }

      // Find and delete the middle clip (the unwanted section)
      const clipsAfterSplits = useTimelineStore.getState().clips;
      const clipToDelete = clipsAfterSplits.find(c =>
        c.trackId === trackId &&
        Math.abs(c.startTime - timelineStart) < 0.1
      );

      if (clipToDelete) {
        const deleteResult = timelineStore.applyTimelineEditOperation({
          id: `ai-cut-range-delete:${clipToDelete.id}`,
          type: 'delete-clips',
          clipIds: [clipToDelete.id],
          includeLinked: true,
        }, {
          source: 'ai-tool',
          historyLabel: 'AI: cut range delete',
        });
        results.push({
          range: { start: timelineStart, end: timelineEnd },
          status: deleteResult.success
            ? 'removed'
            : `error - ${deleteResult.warnings.map((warning) => warning.message).join(' ')}`,
        });
      } else {
        results.push({ range: { start: timelineStart, end: timelineEnd }, status: 'error - could not find section to delete' });
      }
    } catch (err) {
      results.push({ range: { start: timelineStart, end: timelineEnd }, status: `error: ${err}` });
    }
  }

  const removedCount = results.filter(r => r.status === 'removed').length;
  return {
    success: true,
    data: {
      originalClipId: clipId,
      rangesProcessed: ranges.length,
      rangesRemoved: removedCount,
      results,
    },
  };
}
