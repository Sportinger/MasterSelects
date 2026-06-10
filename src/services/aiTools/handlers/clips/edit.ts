import { useTimelineStore } from '../../../../stores/timeline';
import type { ToolResult } from '../../types.ts';
import { isAIExecutionActive } from '../../executionState';
import type { TimelineStore } from './runtime';

export async function handleMoveClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const newStartTime = (args.newStartTime ?? args.startTime) as number;
  const newTrackId = (args.newTrackId ?? args.trackId) as string | undefined;
  const withLinked = (args.withLinked as boolean | undefined) ?? true;

  if (newStartTime == null || isNaN(newStartTime)) {
    return { success: false, error: 'newStartTime is required and must be a valid number' };
  }

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  if (newTrackId) {
    const track = timelineStore.tracks.find(t => t.id === newTrackId);
    if (!track) {
      return { success: false, error: `Track not found: ${newTrackId}` };
    }
  }

  // Visual feedback: animate move from old to new position
  const oldStartTime = clip.startTime;
  if (isAIExecutionActive() && Math.abs(oldStartTime - newStartTime) > 0.01) {
    const store = useTimelineStore.getState();
    store.setAIMovingClip(clipId, oldStartTime, 200);
    // Also animate linked clip
    if (withLinked && clip.linkedClipId) {
      store.setAIMovingClip(clip.linkedClipId, oldStartTime, 200);
    }
  }

  const moveResult = timelineStore.applyTimelineEditOperation({
    id: `ai-move-clip:${clipId}:${newStartTime}:${newTrackId ?? clip.trackId}`,
    type: 'move-clips',
    moves: [{ clipId, startTime: newStartTime, trackId: newTrackId }],
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: move clip',
  });

  if (!moveResult.success) {
    return {
      success: false,
      error: moveResult.warnings.map((warning) => warning.message).join(' '),
    };
  }

  return {
    success: true,
    data: {
      clipId,
      newStartTime,
      newTrackId: newTrackId || clip.trackId,
      withLinked,
    },
  };
}

export async function handleTrimClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const inPoint = args.inPoint as number;
  const outPoint = args.outPoint as number;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  if (inPoint >= outPoint) {
    return { success: false, error: 'In point must be less than out point' };
  }

  const oldInPoint = clip.inPoint;
  const oldOutPoint = clip.outPoint;
  const trimResult = timelineStore.applyTimelineEditOperation({
    id: `ai-trim-clip:${clipId}:${inPoint}:${outPoint}`,
    type: 'trim-clip',
    clipId,
    inPoint,
    outPoint,
    includeLinked: true,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: trim clip',
  });

  if (!trimResult.success) {
    return {
      success: false,
      error: trimResult.warnings.map((warning) => warning.message).join(' '),
    };
  }

  // Visual feedback: trim highlight at the changed edge
  if (isAIExecutionActive()) {
    const store = useTimelineStore.getState();
    const trimmedClip = store.clips.find(c => c.id === clipId);
    if (trimmedClip) {
      // Show highlight at left edge if inPoint changed, right edge if outPoint changed
      if (Math.abs(inPoint - oldInPoint) > 0.01) {
        store.addAIOverlay({ type: 'trim-highlight', trackId: trimmedClip.trackId, timePosition: trimmedClip.startTime, duration: 400 });
      }
      if (Math.abs(outPoint - oldOutPoint) > 0.01) {
        store.addAIOverlay({ type: 'trim-highlight', trackId: trimmedClip.trackId, timePosition: trimmedClip.startTime + trimmedClip.duration, duration: 400 });
      }
    }
  }

  return { success: true, data: { clipId, inPoint, outPoint, newDuration: outPoint - inPoint } };
}

export async function handleReorderClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipIds = args.clipIds as string[];
  const withLinked = (args.withLinked as boolean | undefined) ?? true;

  if (!clipIds || clipIds.length < 2) {
    return { success: false, error: 'Need at least 2 clip IDs to reorder' };
  }

  // Get fresh state
  const state = useTimelineStore.getState();
  const allClips = state.clips;

  // Resolve all clips and validate
  const orderedClips = clipIds.map(id => allClips.find(c => c.id === id));
  const missing = clipIds.filter((_id, i) => !orderedClips[i]);
  if (missing.length > 0) {
    return { success: false, error: `Clips not found: ${missing.join(', ')}` };
  }

  // Find the earliest startTime among the clips to reorder
  const startPosition = Math.min(...orderedClips.map(c => c!.startTime));

  // Build a map of new positions: clipId -> newStartTime
  const newPositions = new Map<string, number>();
  let currentTime = startPosition;

  for (const clip of orderedClips) {
    newPositions.set(clip!.id, currentTime);
    currentTime += clip!.duration;
  }

  // Also move linked audio clips (same delta as their video clip)
  if (withLinked) {
    for (const clip of orderedClips) {
      if (clip!.linkedClipId) {
        const linkedClip = allClips.find(c => c.id === clip!.linkedClipId);
        if (linkedClip && !newPositions.has(linkedClip.id)) {
          const delta = newPositions.get(clip!.id)! - clip!.startTime;
          newPositions.set(linkedClip.id, linkedClip.startTime + delta);
        }
      }
    }
  }

  // Reorder as one kernel operation so linked behavior, export lock, and history stay consistent.
  if (isAIExecutionActive()) {
    const moves: { clipId: string; linkedId?: string }[] = [];
    for (const clip of orderedClips) {
      const newStart = newPositions.get(clip!.id)!;
      if (Math.abs(clip!.startTime - newStart) > 0.01) {
        const linkedId = withLinked && clip!.linkedClipId ? clip!.linkedClipId : undefined;
        moves.push({ clipId: clip!.id, linkedId });
      }
    }

    for (const { clipId, linkedId } of moves) {
      const store = useTimelineStore.getState();
      const currentClip = store.clips.find(c => c.id === clipId);
      if (currentClip) {
        store.setAIMovingClip(clipId, currentClip.startTime, 200);
      }
      if (linkedId) {
        const linkedClip = store.clips.find(c => c.id === linkedId);
        if (linkedClip) {
          store.setAIMovingClip(linkedId, linkedClip.startTime, 200);
        }
      }
    }
  }

  const reorderResult = timelineStore.applyTimelineEditOperation({
    id: `ai-reorder-clips:${clipIds.join(',')}`,
    type: 'move-clips',
    moves: [...newPositions].map(([clipId, startTime]) => ({ clipId, startTime })),
    includeLinked: false,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: reorder clips',
  });

  if (!reorderResult.success) {
    return {
      success: false,
      error: reorderResult.warnings.map((warning) => warning.message).join(' '),
    };
  }

  return {
    success: true,
    data: {
      reorderedCount: clipIds.length,
      withLinked,
      newOrder: clipIds.map((id, i) => ({
        clipId: id,
        newStartTime: newPositions.get(id),
        position: i + 1,
      })),
    },
  };
}
