import type { ToolResult } from '../../types.ts';
import type { TimelineStore } from './runtime';

export async function handleSelectClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipIds = args.clipIds as string[];
  timelineStore.selectClips(clipIds, { revealProperties: false });

  return { success: true, data: { selectedClipIds: clipIds } };
}

export async function handleClearSelection(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  timelineStore.clearClipSelection();
  return { success: true, data: { message: 'Selection cleared' } };
}
