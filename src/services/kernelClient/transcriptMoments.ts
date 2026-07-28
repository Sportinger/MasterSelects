import {
  executeAIToolCalls,
  type AIToolCallExecution,
} from '../aiTools';
import type { KernelTranscriptMoment } from './types';

export const TRANSCRIPT_MOMENT_INDEX_VERSION = 'app-transcript-v2';
export const TRANSCRIPT_MOMENT_WORD_CAP = 400;
const TRANSCRIPT_PAGE_SIZE = 120;
const MAX_MARKERS_PER_MOMENT = 20;
const MAX_PAUSES_PER_MOMENT = 10;
const MAX_EMPHASIS_PER_MOMENT = 10;

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
      if (pauses.length < MAX_PAUSES_PER_MOMENT) {
        pauses.push({ startSeconds: start, endSeconds: end });
        moment.evidence.pauses = pauses;
        addAnalysisSource(moment, 'speech-markers');
      }
      continue;
    }

    if (type === 'emphasis') {
      const text = readString(rawMarker.text);
      const score = readFiniteNumber(rawMarker.confidence);
      const emphasis = moment.evidence.emphasis ?? [];
      if (text && score !== undefined && emphasis.length < MAX_EMPHASIS_PER_MOMENT) {
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
    if (kind && markers.length < MAX_MARKERS_PER_MOMENT) {
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
      if (pauses.length >= MAX_PAUSES_PER_MOMENT) continue;
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
      if (emphasis.length >= MAX_EMPHASIS_PER_MOMENT) continue;
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
  let wordCount = 0;

  for (const clip of transcriptClips(snapshot)) {
    const firstClipMomentIndex = moments.length;
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
          schemaVersion: 1,
          handle: `$m${moments.length + 1}`,
          source: { mediaId: clip.mediaId },
          sourceRange: { startSeconds: start, endSeconds: end },
          evidence: { transcript: text },
          confidence: 1,
          indexVersion: TRANSCRIPT_MOMENT_INDEX_VERSION,
          analysisSources: ['transcript'],
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

    if (moments.length > firstClipMomentIndex) {
      const markerExecution: AIToolCallExecution = {
        id: `kernel-speech-markers-${clip.clipId}`,
        tool: 'getSpeechMarkers',
        args: {
          clipId: clip.clipId,
          ...(clip.sourceStart === undefined ? {} : { sourceStart: clip.sourceStart }),
          ...(clip.sourceEnd === undefined ? {} : { sourceEnd: clip.sourceEnd }),
          offset: 0,
          limit: 250,
        },
      };
      const [markerResult] = await executor([markerExecution], 'chat', {
        guidedReplay: false,
        suppressHistory: true,
      });
      if (markerResult?.result.success && isRecord(markerResult.result.data)) {
        attachSpeechMarkerEvidence(moments, firstClipMomentIndex, markerResult.result.data);
        attachStructuredEvidence(moments, firstClipMomentIndex, markerResult.result.data);
      }
    }

    if (wordCount >= TRANSCRIPT_MOMENT_WORD_CAP) {
      break;
    }
  }

  return moments;
}
