import { useMediaStore } from '../../stores/mediaStore';
import type { TranscriptWord } from '../../types/clipMetadata';
import type { TimelineClip } from '../../types/timeline';

/**
 * Transcripts are anchored to the media file (propagateTranscriptToMediaFile);
 * clip instances only carry a copy captured when the clip was added or when a
 * transcription run targeted that exact clip id. Clips that are re-added,
 * restored, or otherwise created after transcription can miss the copy, so all
 * transcript reads must go through this resolver: clip-level words win, the
 * media file's words are the fallback. Both live in source time, so downstream
 * inPoint/outPoint clamping is unaffected.
 */
export function resolveClipTranscriptWords(
  clip: Pick<TimelineClip, 'transcript' | 'mediaFileId' | 'source'>,
): TranscriptWord[] | undefined {
  if (clip.transcript?.length) return clip.transcript;
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) return undefined;
  const file = useMediaStore.getState().files.find(f => f.id === mediaFileId);
  return file?.transcript?.length ? file.transcript : undefined;
}

export function resolveClipTranscriptWindow(
  clip: Pick<
    TimelineClip,
    'inPoint' | 'outPoint' | 'transcript' | 'mediaFileId' | 'source'
  >,
): TranscriptWord[] | undefined {
  const transcript = resolveClipTranscriptWords(clip);
  if (!transcript) return undefined;
  const sourceStart = Math.min(clip.inPoint, clip.outPoint);
  const sourceEnd = Math.max(clip.inPoint, clip.outPoint);
  return transcript.filter((word) => word.end >= sourceStart && word.start <= sourceEnd);
}

export function clipHasTranscript(
  clip: Pick<TimelineClip, 'transcript' | 'mediaFileId' | 'source'>,
): boolean {
  return resolveClipTranscriptWords(clip) !== undefined;
}
