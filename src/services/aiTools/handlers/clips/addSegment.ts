import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import type { ToolResult } from '../../types.ts';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from '../mutationEntityResults';
import {
  MIN_CLIP_DURATION,
} from '../../../../stores/timeline/editOperations/trimOperations';
import type { ClipAudioEditOperation } from '../../../../types';
import { clearProcessedAudioAnalysisRefs } from '../../../../stores/timeline/helpers/audioAnalysisStateHelpers';
import { createAudioEditOperationId } from '../../../../stores/timeline/audioEdit/audioEditHelpers';
import {
  createAutomaticCutDeClickOperation,
  MAX_AUTOMATIC_DE_CLICK_FADE_SECONDS,
} from '../../../audio/automaticCutDeClick';

export function insertedClipAlreadyMatchesRequestedSegment(
  clip: { inPoint: number; outPoint: number },
  inPoint: number,
  outPoint: number,
): boolean {
  return Math.abs(clip.inPoint - inPoint) < 1e-6
    && Math.abs(clip.outPoint - outPoint) < 1e-6;
}

export function resolveAddClipSegmentTrackId(
  requestedTrackId: string | null,
  mediaType: string,
  tracks: readonly { id: string; type: string }[],
): string | undefined {
  if (requestedTrackId !== null) {
    return tracks.find((track) => track.id === requestedTrackId)?.id;
  }
  const preferredTrackType = mediaType === 'audio' ? 'audio' : 'video';
  return tracks.find((track) => track.type === preferredTrackType)?.id;
}

/**
 * Add a clip segment from the media pool with specific in/out points.
 * Self-contained handler — fetches both stores internally.
 */
export async function handleAddClipSegment(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const mediaFileId = args.mediaFileId as string;
  const requestedTrackId = typeof args.trackId === 'string' ? args.trackId : null;
  const startTime = args.startTime as number;
  const inPoint = args.inPoint as number;
  const outPoint = args.outPoint as number;
  const deClickFadeSeconds = typeof args.deClickFadeSeconds === 'number'
    && Number.isFinite(args.deClickFadeSeconds)
    ? Math.max(0, Math.min(MAX_AUTOMATIC_DE_CLICK_FADE_SECONDS, args.deClickFadeSeconds))
    : 0;

  if (inPoint >= outPoint) {
    return { success: false, error: 'inPoint must be less than outPoint' };
  }
  if (isNaN(startTime) || isNaN(inPoint) || isNaN(outPoint)) {
    return { success: false, error: 'startTime, inPoint, and outPoint must be valid numbers' };
  }
  const duration = outPoint - inPoint;
  if (duration < MIN_CLIP_DURATION) {
    return {
      success: false,
      error:
        `Clip segment duration must be at least ${MIN_CLIP_DURATION}s`,
    };
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

  // A null track id is the deterministic runtime binding used by private
  // kernel edit programs after creating and opening a destination composition.
  const preferredTrackType = mediaFile.type === 'audio' ? 'audio' : 'video';
  const trackId = resolveAddClipSegmentTrackId(
    requestedTrackId,
    mediaFile.type,
    timelineStore.tracks,
  );
  if (!trackId) {
    return {
      success: false,
      error: requestedTrackId === null
        ? `No compatible ${preferredTrackType} track is available in the active composition`
        : `Track not found: ${requestedTrackId}`,
    };
  }

  const mutationSnapshot = captureMutationEntitySnapshot('clip', timelineStore.clips);

  // Add the clip (this creates video + linked audio for video files)
  await timelineStore.addClip(trackId, mediaFile.file, startTime, duration, mediaFileId);

  // Find newly created clips
  const clipsAfter = useTimelineStore.getState().clips;
  const newClips = clipsAfter.filter(c => !mutationSnapshot.entitiesById.has(c.id));

  if (newClips.length === 0) {
    return { success: false, error: 'Failed to create clip' };
  }

  // Trim all new clips (video + linked audio) through the shared operation
  // kernel so export-lock, history, and linked-pair policy stay centralized.
  const trimmedClipIds = new Set<string>();
  for (const clip of newClips) {
    if (trimmedClipIds.has(clip.id)) continue;
    const insertedClip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clip.id);
    if (insertedClip && insertedClipAlreadyMatchesRequestedSegment(insertedClip, inPoint, outPoint)) {
      trimmedClipIds.add(clip.id);
      if (clip.linkedClipId) trimmedClipIds.add(clip.linkedClipId);
      continue;
    }
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

  let deClickFadesApplied = 0;
  if (deClickFadeSeconds > 0) {
    const newClipIds = new Set(newClips.map((clip) => clip.id));
    const audioTrackIds = new Set(
      useTimelineStore.getState().tracks
        .filter((candidate) => candidate.type === 'audio')
        .map((candidate) => candidate.id),
    );
    useTimelineStore.setState((state) => ({
      clips: state.clips.map((clip) => {
        if (!newClipIds.has(clip.id) || !audioTrackIds.has(clip.trackId)) return clip;
        const operations = (['in', 'out'] as const)
          .map((edge) => createAutomaticCutDeClickOperation(
            clip,
            edge,
            deClickFadeSeconds,
            { createdAt: Date.now(), id: createAudioEditOperationId() },
          ))
          .filter((operation): operation is ClipAudioEditOperation => operation !== null);
        if (operations.length === 0) return clip;
        deClickFadesApplied += operations.length;
        return clearProcessedAudioAnalysisRefs({
          ...clip,
          audioState: {
            ...(clip.audioState ?? {}),
            editStack: [...(clip.audioState?.editStack ?? []), ...operations],
          },
        });
      }),
    }));
    if (deClickFadesApplied > 0) useTimelineStore.getState().invalidateCache();
  }

  // Return info about created clips
  const createdClips = useTimelineStore.getState().clips.filter(c => newClips.some(n => n.id === c.id));
  return {
    success: true,
    data: {
      clipCount: createdClips.length,
      deClickFadesApplied,
      clips: createdClips.map(c => ({
        id: c.id,
        trackId: c.trackId,
        startTime: c.startTime,
        duration: c.duration,
        inPoint: c.inPoint,
        outPoint: c.outPoint,
        linkedClipId: c.linkedClipId,
      })),
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
      ),
    },
  };
}
