import type { useTimelineStore } from '../../../stores/timeline';
import { repairTranscriptDuplicates } from '../../transcription/repairTranscriptDuplicates';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleRepairClipTranscript(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
  if (!mediaFileId) {
    return { success: false, error: `Clip has no source media file: ${clipId}` };
  }

  try {
    const report = await repairTranscriptDuplicates(mediaFileId);
    return { success: true, data: { clipId, mediaFileId, ...report } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
