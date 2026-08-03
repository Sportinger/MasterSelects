import { useTimelineStore } from '../../../../stores/timeline';
import type { ClipAudioEditOperation } from '../../../../types';
import { clearProcessedAudioAnalysisRefs } from '../../../../stores/timeline/helpers/audioAnalysisStateHelpers';
import { createAudioEditOperationId } from '../../../../stores/timeline/audioEdit/audioEditHelpers';
import {
  collectAutomaticAudioFadeTargets,
  collectLinkedDeletionIds,
  createAutomaticCutDeClickOperation,
  MAX_AUTOMATIC_DE_CLICK_FADE_SECONDS,
  type AutomaticAudioFadeEdge,
  type AutomaticAudioFadeTarget,
} from '../../../audio/automaticCutDeClick';
import type { ToolResult } from '../../types.ts';
import { isAIExecutionActive } from '../../executionState';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from '../mutationEntityResults';
import type { TimelineStore } from './runtime';
import { getClipColor } from './runtime';

const TIMELINE_EPSILON = 1e-6;

function applyAutomaticAudioFades(
  targets: readonly AutomaticAudioFadeTarget[],
  requestedDuration: number,
): number {
  if (targets.length === 0 || requestedDuration <= 0) return 0;
  const targetByClipId = new Map<string, AutomaticAudioFadeEdge[]>();
  for (const target of targets) {
    const edges = targetByClipId.get(target.clipId) ?? [];
    edges.push(target.edge);
    targetByClipId.set(target.clipId, edges);
  }
  let applied = 0;
  useTimelineStore.setState((state) => ({
    clips: state.clips.map((clip) => {
      const edges = targetByClipId.get(clip.id);
      if (!edges) return clip;
      const operations = edges
        .map((edge) => createAutomaticCutDeClickOperation(
          clip,
          edge,
          requestedDuration,
          { createdAt: Date.now(), id: createAudioEditOperationId() },
        ))
        .filter((operation): operation is ClipAudioEditOperation => operation !== null);
      if (operations.length === 0) return clip;
      applied += operations.length;
      return clearProcessedAudioAnalysisRefs({
        ...clip,
        audioState: {
          ...(clip.audioState ?? {}),
          editStack: [...(clip.audioState?.editStack ?? []), ...operations],
        },
      });
    }),
  }));
  if (applied > 0) useTimelineStore.getState().invalidateCache();
  return applied;
}

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
  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );

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

  return {
    success: true,
    data: {
      deletedClipId: clipId,
      clipName: clip.name,
      withLinked,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
      ),
    },
  };
}

export async function handleDeleteClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipIds = args.clipIds as string[];
  const withLinked = (args.withLinked as boolean | undefined) ?? true;
  const requestedDeClickFadeSeconds = typeof args.deClickFadeSeconds === 'number'
    && Number.isFinite(args.deClickFadeSeconds)
    ? Math.max(0, Math.min(MAX_AUTOMATIC_DE_CLICK_FADE_SECONDS, args.deClickFadeSeconds))
    : 0;
  const currentClips = useTimelineStore.getState().clips;
  const mutationSnapshot = captureMutationEntitySnapshot('clip', currentClips);
  const deleted = clipIds.filter((clipId) => currentClips.some((clip) => clip.id === clipId));
  const notFound = clipIds.filter((clipId) => !currentClips.some((clip) => clip.id === clipId));

  if (deleted.length === 0) {
    return {
      success: true,
      data: {
        deleted,
        notFound,
        deletedCount: 0,
        deClickFadesApplied: 0,
        withLinked,
        ...describeMutationEntities(
          mutationSnapshot,
          useTimelineStore.getState().clips,
        ),
      },
    };
  }

  const deletionIds = collectLinkedDeletionIds(currentClips, deleted, withLinked);
  const audioFadeTargets = requestedDeClickFadeSeconds > 0
    ? collectAutomaticAudioFadeTargets(currentClips, deletionIds)
    : [];

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

  const deClickFadesApplied = applyAutomaticAudioFades(
    audioFadeTargets,
    requestedDeClickFadeSeconds,
  );

  return {
    success: true,
    data: {
      deleted,
      notFound,
      deletedCount: deleted.length,
      deClickFadeSeconds: requestedDeClickFadeSeconds,
      deClickFadesApplied,
      withLinked,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
      ),
    },
  };
}

export async function handleCutRangesFromClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const ranges = args.ranges as Array<{ timelineStart: number; timelineEnd: number }>;
  const ripple = args.ripple === true;

  // Get initial clip info
  const initialClip = timelineStore.clips.find(c => c.id === clipId);
  if (!initialClip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }
  const initialClipEnd = initialClip.startTime + initialClip.duration;
  if (
    ranges.length === 0 ||
    ranges.some(({ timelineStart, timelineEnd }) =>
      !Number.isFinite(timelineStart) ||
      !Number.isFinite(timelineEnd) ||
      timelineEnd <= timelineStart ||
      timelineStart < initialClip.startTime - TIMELINE_EPSILON ||
      timelineEnd > initialClipEnd + TIMELINE_EPSILON
    )
  ) {
    return { success: false, error: 'Cut ranges must be finite, non-empty, have end after start, and stay inside the target clip.' };
  }

  const trackId = initialClip.trackId;
  const results: Array<{ range: { start: number; end: number }; status: string }> = [];
  const targetClipIds = [initialClip.id, initialClip.linkedClipId]
    .filter((id): id is string => id !== undefined);
  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );

  // End-to-start keeps every supplied timeline range valid even when later
  // deletions ripple subsequent clips to the left.
  const sortedRanges = [...ranges].sort((a, b) => b.timelineStart - a.timelineStart);

  for (const range of sortedRanges) {
    const { timelineStart, timelineEnd } = range;

    // Find the clip that currently contains this range
    // (clip IDs change after splits, so we need to find by position)
    const currentClips = useTimelineStore.getState().clips;
    const targetClip = currentClips.find(c =>
      c.trackId === trackId &&
      c.startTime <= timelineStart + TIMELINE_EPSILON &&
      c.startTime + c.duration >= timelineEnd - TIMELINE_EPSILON
    );

    if (!targetClip) {
      results.push({ range: { start: timelineStart, end: timelineEnd }, status: 'skipped - no clip at this position' });
      continue;
    }

    const clipEnd = targetClip.startTime + targetClip.duration;

    try {
      // Split at the end of the range (if not at clip boundary)
      if (timelineEnd < clipEnd - TIMELINE_EPSILON) {
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
        c.startTime <= timelineStart + TIMELINE_EPSILON &&
        c.startTime + c.duration >= timelineStart + TIMELINE_EPSILON
      );

      if (!clipForStartSplit) {
        results.push({ range: { start: timelineStart, end: timelineEnd }, status: 'error - lost clip after end split' });
        continue;
      }

      // Split at the start of the range (if not at clip boundary)
      if (timelineStart > clipForStartSplit.startTime + TIMELINE_EPSILON) {
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
        Math.abs(c.startTime - timelineStart) <= TIMELINE_EPSILON
      );

      if (clipToDelete) {
        const deleteResult = timelineStore.applyTimelineEditOperation({
          id: `ai-cut-range-delete:${clipToDelete.id}`,
          type: ripple ? 'ripple-delete-selection' : 'delete-clips',
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
  const success = removedCount === sortedRanges.length;
  return {
    success,
    ...(!success ? { error: `Removed ${removedCount} of ${sortedRanges.length} requested ranges.` } : {}),
    data: {
      originalClipId: clipId,
      ripple,
      rangesProcessed: ranges.length,
      rangesRemoved: removedCount,
      results,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
        { updatedEntityIds: targetClipIds },
      ),
    },
  };
}
