import { useTimelineStore } from '../../../../stores/timeline';
import type { ToolResult } from '../../types';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from '../mutationEntityResults';
import {
  handleMoveClip as handleMoveClipBase,
  handleReorderClips as handleReorderClipsBase,
} from './edit';
import type { TimelineStore } from './runtime';

export async function handleMoveClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  return withClipEntityReporting(handleMoveClipBase, args, timelineStore);
}

export async function handleReorderClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  return withClipEntityReporting(handleReorderClipsBase, args, timelineStore);
}

async function withClipEntityReporting(
  handler: (
    args: Record<string, unknown>,
    timelineStore: TimelineStore,
  ) => Promise<ToolResult>,
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );
  const result = await handler(args, timelineStore);
  if (!result.success) return result;

  return {
    ...result,
    data: {
      ...(isRecord(result.data) ? result.data : {}),
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
      ),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
