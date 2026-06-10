import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import type { ToolResult } from '../../types.ts';

/**
 * Add a clip segment from the media pool with specific in/out points.
 * Self-contained handler — fetches both stores internally.
 */
export async function handleAddClipSegment(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const mediaFileId = args.mediaFileId as string;
  const trackId = args.trackId as string;
  const startTime = args.startTime as number;
  const inPoint = args.inPoint as number;
  const outPoint = args.outPoint as number;

  if (inPoint >= outPoint) {
    return { success: false, error: 'inPoint must be less than outPoint' };
  }
  if (isNaN(startTime) || isNaN(inPoint) || isNaN(outPoint)) {
    return { success: false, error: 'startTime, inPoint, and outPoint must be valid numbers' };
  }

  const mediaStore = useMediaStore.getState();
  const timelineStore = useTimelineStore.getState();

  // Find media file
  const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);
  if (!mediaFile) {
    return { success: false, error: `Media file not found: ${mediaFileId}` };
  }
  if (!mediaFile.file) {
    return { success: false, error: `File object not available for media: ${mediaFileId}. Try re-importing the file.` };
  }

  // Validate track
  const track = timelineStore.tracks.find(t => t.id === trackId);
  if (!track) {
    return { success: false, error: `Track not found: ${trackId}` };
  }

  const duration = outPoint - inPoint;

  // Snapshot clip count before adding
  const clipsBefore = new Set(timelineStore.clips.map(c => c.id));

  // Add the clip (this creates video + linked audio for video files)
  await timelineStore.addClip(trackId, mediaFile.file, startTime, duration, mediaFileId);

  // Find newly created clips
  const clipsAfter = useTimelineStore.getState().clips;
  const newClips = clipsAfter.filter(c => !clipsBefore.has(c.id));

  if (newClips.length === 0) {
    return { success: false, error: 'Failed to create clip' };
  }

  // Trim all new clips (video + linked audio) through the shared operation
  // kernel so export-lock, history, and linked-pair policy stay centralized.
  const trimmedClipIds = new Set<string>();
  for (const clip of newClips) {
    if (trimmedClipIds.has(clip.id)) continue;
    const trimResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: `ai-insert-media-trim:${clip.id}:${inPoint}:${outPoint}`,
      type: 'trim-clip',
      clipId: clip.id,
      inPoint,
      outPoint,
      includeLinked: true,
    }, {
      source: 'ai-tool',
      historyLabel: 'AI: trim inserted media clip',
    });
    if (!trimResult.success) {
      return {
        success: false,
        error: trimResult.warnings.map((warning) => warning.message).join(' ') || 'Failed to trim inserted media clip',
      };
    }
    trimmedClipIds.add(clip.id);
    if (clip.linkedClipId) trimmedClipIds.add(clip.linkedClipId);
  }

  // Return info about created clips
  const createdClips = useTimelineStore.getState().clips.filter(c => newClips.some(n => n.id === c.id));
  return {
    success: true,
    data: {
      clipCount: createdClips.length,
      clips: createdClips.map(c => ({
        id: c.id,
        trackId: c.trackId,
        startTime: c.startTime,
        duration: c.duration,
        inPoint: c.inPoint,
        outPoint: c.outPoint,
        linkedClipId: c.linkedClipId,
      })),
    },
  };
}
