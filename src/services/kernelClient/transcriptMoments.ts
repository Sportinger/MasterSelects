import {
  executeAIToolCalls,
  type AIToolCallExecution,
} from '../aiTools';
import type { KernelTranscriptMoment } from './types';

export const TRANSCRIPT_MOMENT_INDEX_VERSION = 'app-transcript-v1';
export const TRANSCRIPT_MOMENT_WORD_CAP = 400;
const TRANSCRIPT_PAGE_SIZE = 120;

export type TranscriptMomentExecutor = typeof executeAIToolCalls;

interface TranscriptClipReference {
  clipId: string;
  mediaId: string;
  sourceEnd?: number;
  sourceStart?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function transcriptClips(snapshot: unknown): TranscriptClipReference[] {
  if (!isRecord(snapshot)) {
    return [];
  }

  const clips: TranscriptClipReference[] = [];
  const seenSourceRanges = new Set<string>();

  for (const trackKey of ['videoTracks', 'audioTracks']) {
    const tracks = snapshot[trackKey];
    if (!Array.isArray(tracks)) continue;

    for (const track of tracks) {
      if (!isRecord(track) || !Array.isArray(track.clips)) continue;

      for (const clip of track.clips) {
        if (!isRecord(clip) || clip.hasTranscript !== true) continue;

        const clipId = readString(clip.id);
        const mediaId = readString(clip.mediaId);
        if (!clipId || !mediaId) continue;

        const sourceStart = readFiniteNumber(clip.inPoint);
        const sourceEnd = readFiniteNumber(clip.outPoint);
        const sourceKey = sourceStart !== undefined && sourceEnd !== undefined
          ? `${mediaId}:${sourceStart}:${sourceEnd}`
          : `${mediaId}:clip:${clipId}`;
        if (seenSourceRanges.has(sourceKey)) continue;
        seenSourceRanges.add(sourceKey);

        clips.push({
          clipId,
          mediaId,
          ...(sourceStart === undefined ? {} : { sourceStart }),
          ...(sourceEnd === undefined ? {} : { sourceEnd }),
        });
      }
    }
  }

  return clips;
}

function countWords(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

export async function buildTranscriptMoments(
  snapshot: unknown,
  executor: TranscriptMomentExecutor = executeAIToolCalls,
): Promise<KernelTranscriptMoment[]> {
  const moments: KernelTranscriptMoment[] = [];
  let wordCount = 0;

  for (const clip of transcriptClips(snapshot)) {
    let offset = 0;
    const visitedOffsets = new Set<number>();

    while (wordCount < TRANSCRIPT_MOMENT_WORD_CAP && !visitedOffsets.has(offset)) {
      visitedOffsets.add(offset);
      const remainingWords = TRANSCRIPT_MOMENT_WORD_CAP - wordCount;
      const execution: AIToolCallExecution = {
        id: `kernel-transcript-${clip.clipId}-${offset}`,
        tool: 'getClipTranscript',
        args: {
          clipId: clip.clipId,
          ...(clip.sourceStart === undefined ? {} : { sourceStart: clip.sourceStart }),
          ...(clip.sourceEnd === undefined ? {} : { sourceEnd: clip.sourceEnd }),
          offset,
          limit: Math.min(TRANSCRIPT_PAGE_SIZE, remainingWords),
          includeSegments: true,
        },
      };
      const [result] = await executor([execution], 'chat', {
        guidedReplay: false,
        suppressHistory: true,
      });
      if (!result?.result.success || !isRecord(result.result.data)) break;

      const data = result.result.data;
      if (data.hasTranscript === false || !Array.isArray(data.segments)) break;

      let capReached = false;
      for (const segment of data.segments) {
        if (!isRecord(segment)) continue;

        const start = readFiniteNumber(segment.start);
        const end = readFiniteNumber(segment.end);
        const text = readString(segment.text);
        if (start === undefined || end === undefined || end < start || !text) continue;

        const segmentWords = countWords(text);
        if (segmentWords === 0) continue;
        if (wordCount + segmentWords > TRANSCRIPT_MOMENT_WORD_CAP) {
          capReached = true;
          break;
        }

        wordCount += segmentWords;
        moments.push({
          handle: `$m${moments.length + 1}`,
          source: clip.mediaId,
          sourceRange: [start, end],
          evidence: { transcript: text },
          confidence: 1,
          indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION,
        });
      }

      if (capReached || wordCount >= TRANSCRIPT_MOMENT_WORD_CAP || data.hasMore !== true) {
        break;
      }

      const nextOffset = readFiniteNumber(data.nextOffset);
      if (nextOffset === undefined || !Number.isInteger(nextOffset) || nextOffset <= offset) {
        break;
      }
      offset = nextOffset;
    }

    if (wordCount >= TRANSCRIPT_MOMENT_WORD_CAP) {
      break;
    }
  }

  return moments;
}
