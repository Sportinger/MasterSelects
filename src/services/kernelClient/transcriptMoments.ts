import {
  executeAIToolCalls,
  type AIToolCallExecution,
} from '../aiTools';
import type { KernelTranscriptMoment } from './types';

export const TRANSCRIPT_MOMENT_INDEX_VERSION = 'app-transcript-v2';
const TRANSCRIPT_PAGE_SIZE = 120;
const SPEECH_MARKERS_PAGE_SIZE = 250;
// A longer pause represents a natural phrase boundary.
const PHRASE_GAP_BOUNDARY_SECONDS = 0.6;
// Keep each phrase small enough to be useful as a single editing moment.
const PHRASE_MAX_DURATION_SECONDS = 8;
// Avoid overly broad moments during fast speech.
const PHRASE_MAX_WORDS = 25;

export type TranscriptMomentExecutor = typeof executeAIToolCalls;

export interface TranscriptClipReference {
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

export function transcriptClips(snapshot: unknown): TranscriptClipReference[] {
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

interface TranscriptWordSegment {
  endSeconds: number;
  startSeconds: number;
  text: string;
  wordCount: number;
}

function endsSentence(text: string): boolean {
  return /(?:\.\.\.|[.!?:;])\s*$/u.test(text);
}

function appendPhraseMoments(
  moments: KernelTranscriptMoment[],
  clip: TranscriptClipReference,
  words: readonly TranscriptWordSegment[],
): void {
  let chunk: TranscriptWordSegment[] = [];
  let chunkWordCount = 0;

  const flushChunk = () => {
    if (chunk.length === 0) return;
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    moments.push({
      schemaVersion: 1,
      handle: `$m${moments.length + 1}`,
      source: { mediaId: clip.mediaId },
      sourceRange: { startSeconds: first.startSeconds, endSeconds: last.endSeconds },
      evidence: { transcript: chunk.map(word => word.text).join(' ').trim() },
      confidence: 1,
      indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION,
      analysisSources: ['transcript'],
    });
    chunk = [];
    chunkWordCount = 0;
  };

  for (const word of words) {
    const previous = chunk[chunk.length - 1];
    const startsNewPhrase = previous !== undefined && (
      word.startSeconds - previous.endSeconds > PHRASE_GAP_BOUNDARY_SECONDS
      || word.endSeconds - chunk[0].startSeconds > PHRASE_MAX_DURATION_SECONDS
      || chunkWordCount + word.wordCount > PHRASE_MAX_WORDS
      || endsSentence(previous.text)
    );
    if (startsNewPhrase) flushChunk();
    chunk.push(word);
    chunkWordCount += word.wordCount;
  }

  flushChunk();
}
function nearestMomentIndex(
  moments: readonly KernelTranscriptMoment[],
  firstIndex: number,
  time: number,
): number | undefined {
  let nearest: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = firstIndex; index < moments.length; index += 1) {
    const range = moments[index]?.sourceRange;
    if (!range) continue;
    const distance = time < range.startSeconds
      ? range.startSeconds - time
      : time > range.endSeconds
        ? time - range.endSeconds
        : 0;
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function addAnalysisSource(
  moment: KernelTranscriptMoment,
  source: KernelTranscriptMoment['analysisSources'][number],
): void {
  if (!moment.analysisSources.includes(source)) {
    moment.analysisSources.push(source);
  }
}

function attachSpeechMarkerEvidence(
  moments: KernelTranscriptMoment[],
  firstIndex: number,
  data: Record<string, unknown>,
): void {
  if (!Array.isArray(data.markers)) return;

  for (const rawMarker of data.markers) {
    if (!isRecord(rawMarker)) continue;
    const type = readString(rawMarker.type);
    const start = readFiniteNumber(rawMarker.start);
    const end = readFiniteNumber(rawMarker.end) ?? start;
    if (!type || start === undefined || end === undefined || end < start) continue;

    const momentIndex = nearestMomentIndex(moments, firstIndex, start);
    const moment = momentIndex === undefined ? undefined : moments[momentIndex];
    if (!moment) continue;

    if (type === 'long-pause') {
      const pauses = moment.evidence.pauses ?? [];
      pauses.push({ startSeconds: start, endSeconds: end });
      moment.evidence.pauses = pauses;
      addAnalysisSource(moment, 'speech-markers');
      continue;
    }

    if (type === 'emphasis') {
      const text = readString(rawMarker.text);
      const score = readFiniteNumber(rawMarker.confidence);
      const emphasis = moment.evidence.emphasis ?? [];
      if (text && score !== undefined) {
        emphasis.push({ text, startSeconds: start, score });
        moment.evidence.emphasis = emphasis;
        addAnalysisSource(moment, 'prosody');
      }
      continue;
    }

    const kind = type === 'breath'
      ? 'breath'
      : type === 'filler'
        ? 'filler'
        : type === 'repetition' || type === 'false-start'
          ? 'disfluency'
          : undefined;
    const markers = moment.evidence.markers ?? [];
    if (kind) {
      markers.push({ kind, timeSeconds: start });
      moment.evidence.markers = markers;
      addAnalysisSource(moment, 'speech-markers');
    }
  }
}

function attachStructuredEvidence(
  moments: KernelTranscriptMoment[],
  firstIndex: number,
  data: Record<string, unknown>,
): void {
  if (Array.isArray(data.pauses)) {
    for (const rawPause of data.pauses) {
      if (!isRecord(rawPause)) continue;
      const start = readFiniteNumber(rawPause.startSeconds) ?? readFiniteNumber(rawPause.start);
      const end = readFiniteNumber(rawPause.endSeconds) ?? readFiniteNumber(rawPause.end);
      if (start === undefined || end === undefined || end < start) continue;
      const momentIndex = nearestMomentIndex(moments, firstIndex, start);
      const moment = momentIndex === undefined ? undefined : moments[momentIndex];
      if (!moment) continue;
      const pauses = moment.evidence.pauses ?? [];
      pauses.push({ startSeconds: start, endSeconds: end });
      moment.evidence.pauses = pauses;
      addAnalysisSource(moment, 'voice-activity');
    }
  }

  if (Array.isArray(data.emphasis)) {
    for (const rawEmphasis of data.emphasis) {
      if (!isRecord(rawEmphasis)) continue;
      const text = readString(rawEmphasis.text);
      const start = readFiniteNumber(rawEmphasis.startSeconds) ?? readFiniteNumber(rawEmphasis.start);
      const score = readFiniteNumber(rawEmphasis.score) ?? readFiniteNumber(rawEmphasis.confidence);
      if (!text || start === undefined || score === undefined) continue;
      const momentIndex = nearestMomentIndex(moments, firstIndex, start);
      const moment = momentIndex === undefined ? undefined : moments[momentIndex];
      if (!moment) continue;
      const emphasis = moment.evidence.emphasis ?? [];
      emphasis.push({ text, startSeconds: start, score });
      moment.evidence.emphasis = emphasis;
      addAnalysisSource(moment, 'prosody');
    }
  }
}

export async function buildTranscriptMoments(
  snapshot: unknown,
  executor: TranscriptMomentExecutor = executeAIToolCalls,
): Promise<KernelTranscriptMoment[]> {
  const moments: KernelTranscriptMoment[] = [];

  for (const clip of transcriptClips(snapshot)) {
    const firstClipMomentIndex = moments.length;
    let offset = 0;
    const visitedOffsets = new Set<number>();
    const words: TranscriptWordSegment[] = [];

    while (!visitedOffsets.has(offset)) {
      visitedOffsets.add(offset);
      const execution: AIToolCallExecution = {
        id: `kernel-transcript-${clip.clipId}-${offset}`,
        tool: 'getClipTranscript',
        args: {
          clipId: clip.clipId,
          ...(clip.sourceStart === undefined ? {} : { sourceStart: clip.sourceStart }),
          ...(clip.sourceEnd === undefined ? {} : { sourceEnd: clip.sourceEnd }),
          offset,
          limit: TRANSCRIPT_PAGE_SIZE,
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

      for (const segment of data.segments) {
        if (!isRecord(segment)) continue;

        const start = readFiniteNumber(segment.start);
        const end = readFiniteNumber(segment.end);
        const text = readString(segment.text);
        if (start === undefined || end === undefined || end < start || !text) continue;

        const wordCount = countWords(text);
        if (wordCount === 0) continue;
        words.push({ startSeconds: start, endSeconds: end, text, wordCount });
      }

      if (data.hasMore !== true) break;

      const nextOffset = readFiniteNumber(data.nextOffset);
      if (nextOffset === undefined || !Number.isInteger(nextOffset) || nextOffset <= offset) {
        break;
      }
      offset = nextOffset;
    }

    appendPhraseMoments(moments, clip, words);

    if (moments.length > firstClipMomentIndex) {
      let markerOffset = 0;
      const visitedMarkerOffsets = new Set<number>();
      while (!visitedMarkerOffsets.has(markerOffset)) {
        visitedMarkerOffsets.add(markerOffset);
        const markerExecution: AIToolCallExecution = {
          id: `kernel-speech-markers-${clip.clipId}-${markerOffset}`,
          tool: 'getSpeechMarkers',
          args: {
            clipId: clip.clipId,
            ...(clip.sourceStart === undefined ? {} : { sourceStart: clip.sourceStart }),
            ...(clip.sourceEnd === undefined ? {} : { sourceEnd: clip.sourceEnd }),
            offset: markerOffset,
            limit: SPEECH_MARKERS_PAGE_SIZE,
          },
        };
        const [markerResult] = await executor([markerExecution], 'chat', {
          guidedReplay: false,
          suppressHistory: true,
        });
        if (!markerResult?.result.success || !isRecord(markerResult.result.data)) break;

        const data = markerResult.result.data;
        attachSpeechMarkerEvidence(moments, firstClipMomentIndex, data);
        attachStructuredEvidence(moments, firstClipMomentIndex, data);
        if (data.hasMore !== true) break;

        const nextOffset = readFiniteNumber(data.nextOffset);
        if (nextOffset === undefined || !Number.isInteger(nextOffset) || nextOffset <= markerOffset) {
          break;
        }
        markerOffset = nextOffset;
      }
    }
  }

  return moments;
}
