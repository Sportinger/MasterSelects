import type { TranscriptWord } from '../../../../types/clipMetadata';
import type { SpeechMarker } from '../../speechMarkersManifest';
import type { AudioSpan } from '../../voiceActivityManifest';
import { isFillerToken, normalizeToken } from './fillerLexicon';

export interface FillerDetectionInput {
  words: readonly TranscriptWord[];
  vadSegments?: readonly AudioSpan[];
  language?: string;
}

interface TimedWord {
  word: TranscriptWord;
  start: number;
  end: number;
  token: string;
}

function timing(word: TranscriptWord): TimedWord {
  return {
    word,
    start: word.alignedStart ?? word.start,
    end: word.alignedEnd ?? word.end,
    token: normalizeToken(word.text),
  };
}

function stableId(type: SpeechMarker['type'], words: readonly TranscriptWord[], start: number): string {
  const identity = words.map((word) => word.id).filter(Boolean).join('-');
  return `${type}-${identity || Math.round(start * 1000)}`;
}

// VAD segments carry edge padding, so a pause is still "speech-free" when
// speech only grazes its boundaries.
const LONG_PAUSE_SPEECH_OVERLAP_TOLERANCE_SECONDS = 0.15;

function speechOverlapSeconds(start: number, end: number, segments: readonly AudioSpan[]): number {
  let overlap = 0;
  for (const segment of segments) {
    overlap += Math.max(0, Math.min(end, segment.end) - Math.max(start, segment.start));
  }
  return overlap;
}

export function detectFillerMarkers(input: FillerDetectionInput): SpeechMarker[] {
  const words = input.words.map(timing).sort((left, right) => left.start - right.start);
  const markers: SpeechMarker[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const current = words[index]!;
    if (isFillerToken(current.word.text, input.language)) {
      const pauseBefore = index === 0 ? Number.POSITIVE_INFINITY
        : Math.max(0, current.start - words[index - 1]!.end);
      const pauseAfter = index === words.length - 1 ? Number.POSITIVE_INFINITY
        : Math.max(0, words[index + 1]!.start - current.end);
      const isolated = pauseBefore >= 0.15 && pauseAfter >= 0.15;
      markers.push({
        id: stableId('filler', [current.word], current.start),
        type: 'filler',
        start: current.start,
        end: current.end,
        confidence: isolated ? 0.85 : 0.7,
        text: current.word.text,
        wordIds: [current.word.id],
        language: input.language,
        evidence: {
          pauseBeforeMs: Number.isFinite(pauseBefore) ? pauseBefore * 1000 : undefined,
          pauseAfterMs: Number.isFinite(pauseAfter) ? pauseAfter * 1000 : undefined,
        },
      });
    }

    if (current.token.length >= 2) {
      let runEnd = index + 1;
      while (runEnd < words.length && words[runEnd]!.token === current.token) runEnd += 1;
      if (runEnd - index >= 2) {
        const repeated = words.slice(index, runEnd - 1);
        markers.push({
          id: stableId('repetition', repeated.map((item) => item.word), current.start),
          type: 'repetition',
          start: current.start,
          end: repeated.at(-1)!.end,
          confidence: 0.6,
          text: repeated.map((item) => item.word.text).join(' '),
          wordIds: repeated.map((item) => item.word.id),
          language: input.language,
        });
        index = runEnd - 2;
        continue;
      }
    }

    const next = words[index + 1];
    const pauseAfter = next ? next.start - current.end : 0;
    const hasFalseStartShape = current.word.text.trimEnd().endsWith('-')
      || current.token.length === 1 || current.token.length === 2;
    if (next && hasFalseStartShape && pauseAfter >= 0.3 && current.token !== next.token) {
      markers.push({
        id: stableId('false-start', [current.word], current.start),
        type: 'false-start',
        start: current.start,
        end: current.end,
        confidence: 0.5,
        text: current.word.text,
        wordIds: [current.word.id],
        language: input.language,
        evidence: { pauseAfterMs: pauseAfter * 1000 },
      });
    }
  }

  for (let index = 0; index + 1 < words.length; index += 1) {
    const previous = words[index]!;
    const next = words[index + 1]!;
    const start = previous.end;
    const end = next.start;
    if (end - start < 1) continue;
    if (input.vadSegments
      && speechOverlapSeconds(start, end, input.vadSegments) > LONG_PAUSE_SPEECH_OVERLAP_TOLERANCE_SECONDS) {
      continue;
    }
    markers.push({
      id: `long-pause-${Math.round(start * 1000)}`,
      type: 'long-pause',
      start,
      end,
      confidence: input.vadSegments ? 0.9 : 0.5,
      evidence: { pauseBeforeMs: (end - start) * 1000 },
    });
  }
  return markers.sort((left, right) => left.start - right.start || left.type.localeCompare(right.type));
}
