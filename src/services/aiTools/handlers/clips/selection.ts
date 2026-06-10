import type { ToolResult } from '../../types.ts';
import { activateDockPanel } from '../../aiFeedback';
import type { TimelineStore } from './runtime';

export async function handleSelectClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipIds = args.clipIds as string[];
  timelineStore.selectClips(clipIds);

  // Visual feedback: activate properties panel
  activateDockPanel('clip-properties');

  return { success: true, data: { selectedClipIds: clipIds } };
}

export async function handleClearSelection(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  timelineStore.clearClipSelection();
  return { success: true, data: { message: 'Selection cleared' } };
}
