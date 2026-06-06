import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleAddTransition(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipAId = args.clipAId as string;
  const clipBId = args.clipBId as string;
  const type = (args.type as string) || 'crossfade';
  const duration = (args.duration as number) || 0.5;

  const clipA = timelineStore.clips.find(c => c.id === clipAId);
  const clipB = timelineStore.clips.find(c => c.id === clipBId);
  if (!clipA) return { success: false, error: `Clip not found: ${clipAId}` };
  if (!clipB) return { success: false, error: `Clip not found: ${clipBId}` };

  const { applyTransition } = useTimelineStore.getState();
  const result = applyTransition(clipAId, clipBId, type, duration, {
    source: 'ai-tool',
    historyLabel: 'AI: add transition',
  });
  if (!result.success) {
    return {
      success: false,
      error: result.warnings.map(warning => warning.message).join('; ') || 'Could not add transition',
      data: result,
    };
  }

  return {
    success: true,
    data: { clipAId, clipBId, type, duration, changedClipIds: result.changedClipIds },
  };
}

export async function handleRemoveTransition(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const edge = args.edge as 'in' | 'out';
  if (edge !== 'in' && edge !== 'out') {
    return { success: false, error: 'Edge must be "in" or "out"' };
  }

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const { removeTransition } = useTimelineStore.getState();
  const result = removeTransition(clipId, edge, {
    source: 'ai-tool',
    historyLabel: 'AI: remove transition',
  });
  if (!result.success) {
    return {
      success: false,
      error: result.warnings.map(warning => warning.message).join('; ') || 'Could not remove transition',
      data: result,
    };
  }

  return {
    success: true,
    data: { clipId, edge, removed: true, changedClipIds: result.changedClipIds },
  };
}
