import { useMediaStore } from '../../../stores/mediaStore';
import type { useTimelineStore } from '../../../stores/timeline';
import type { TranscriptWord } from '../../../types/clipMetadata';
import { propagateTranscriptToMediaFile } from '../../transcription/artifactPersistence';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

/** Checks the given words and returns them as transcript words, or the reason they are refused. */
export function knownTranscriptWords(input: unknown, mediaFileId: string): TranscriptWord[] | string {
  if (!Array.isArray(input) || input.length === 0) return 'words must be a non-empty array of { text, start, end }';
  const words: TranscriptWord[] = [];
  for (const [index, word] of input.entries()) {
    const { text, start, end } = (word ?? {}) as { text?: unknown; start?: unknown; end?: unknown };
    if (typeof text !== 'string' || !text.trim()) return `word ${index} has no text`;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
      return `word ${index} ("${text}") needs numeric start and end`;
    }
    if (start < 0 || end < start) return `word ${index} ("${text}") has start ${start} and end ${end}; need 0 <= start <= end`;
    words.push({ id: `known:${mediaFileId}:word-${index}`, text: text.trim(), start, end, confidence: 1 });
  }
  return words.toSorted((left, right) => left.start - right.start);
}

export async function handleSetClipTranscript(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
  if (!mediaFileId) return { success: false, error: `Clip has no source media file: ${clipId}` };

  const words = knownTranscriptWords(args.words, mediaFileId);
  if (typeof words === 'string') return { success: false, error: words };

  const file = useMediaStore.getState().files.find(item => item.id === mediaFileId);
  if (!file) return { success: false, error: `Media file not found: ${mediaFileId}` };
  // The whole file is covered, so the new words replace every earlier word of this media.
  const coveredEnd = Math.max(file.duration ?? 0, words.at(-1)!.end);
  const saved = await propagateTranscriptToMediaFile(mediaFileId, words, [[0, coveredEnd]]);
  const beyond = file.duration ? words.filter(word => word.end > file.duration! + 0.05).length : 0;
  const warnings = [
    ...(saved ? [] : ['The transcript is set in the editor but was not saved to the project folder (no project folder open?).']),
    ...(beyond ? [`${beyond} words end after the media's duration of ${file.duration} s; check the times.`] : []),
  ];
  return {
    success: true,
    data: { clipId, mediaFileId, wordCount: words.length, savedToProject: saved, ...(warnings.length ? { warnings } : {}) },
  };
}
