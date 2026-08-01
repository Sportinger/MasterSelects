import type { TranscriptWord } from '../../types/clipMetadata';

export interface TranscriptApiWord {
  word?: string;
  text?: string;
  start?: number;
  end?: number;
  confidence?: number;
  punctuated_word?: string;
  speaker?: number | string;
  speakerConfidence?: number;
  speaker_confidence?: number;
}

export interface TranscriptApiSegment {
  end?: number;
  speaker?: number | string;
  start?: number;
  text?: string;
}

function transcriptTokenWeight(value: string): number {
  const normalizedLength = Array.from(value.replace(/[^\p{L}\p{N}]/gu, '')).length;
  return Math.max(1, normalizedLength);
}

/**
 * OpenAI's diarization model returns timestamped speaker segments rather than
 * word timestamps. Expand each speaker segment into monotonic approximate word
 * spans so its diarization boundaries can be projected onto Deepgram's exact
 * timing backbone. OpenAI's token text and these approximate timings are never
 * used in the displayed transcript.
 */
export function expandDiarizedSegmentsToWords(
  segments: TranscriptApiSegment[],
): TranscriptApiWord[] {
  return segments.flatMap((segment) => {
    const tokens = segment.text?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (tokens.length === 0) return [];

    const start = typeof segment.start === 'number' ? segment.start : 0;
    const requestedEnd = typeof segment.end === 'number' ? segment.end : start + tokens.length * 0.2;
    const end = Math.max(start + tokens.length * 0.04, requestedEnd);
    const duration = end - start;
    const weights = tokens.map(transcriptTokenWeight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = start;

    return tokens.map((token, index): TranscriptApiWord => {
      const tokenEnd = index === tokens.length - 1
        ? end
        : cursor + duration * (weights[index] / totalWeight);
      const word = {
        end: tokenEnd,
        speaker: segment.speaker,
        start: cursor,
        word: token,
      };
      cursor = tokenEnd;
      return word;
    });
  });
}

function formatTranscriptSpeaker(value: number | string | undefined): string {
  if (typeof value === 'number') return `Speaker ${value + 1}`;
  if (!value) return 'Speaker 1';
  return /^speaker(?:\s|$)/i.test(value) ? value : `Speaker ${value}`;
}

/**
 * Calculate coverage ratio from a set of time ranges vs total duration.
 * Merges overlapping ranges and returns 0-1.
 */
export function calcCoverage(ranges: [number, number][], totalDuration: number): number {
  if (totalDuration <= 0 || ranges.length === 0) return 0;
  const merged = mergeRanges(ranges);
  const covered = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
  return Math.min(1, covered / totalDuration);
}

/**
 * Merge and sort a list of ranges, combining overlapping ones.
 */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push([...sorted[i]]);
    }
  }

  return merged;
}

/**
 * Find uncovered time gaps within a range given a set of covered ranges.
 */
export function findGaps(
  coveredRanges: [number, number][],
  rangeStart: number,
  rangeEnd: number,
): [number, number][] {
  const clipped: [number, number][] = [];
  for (const [s, e] of coveredRanges) {
    const cs = Math.max(s, rangeStart);
    const ce = Math.min(e, rangeEnd);
    if (cs < ce) clipped.push([cs, ce]);
  }

  const merged = mergeRanges(clipped);
  const gaps: [number, number][] = [];
  let cursor = rangeStart;

  for (const [s, e] of merged) {
    if (cursor < s) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < rangeEnd) gaps.push([cursor, rangeEnd]);

  return gaps;
}

export interface TranscriptWordMatch {
  existingIndex: number;
  newIndex: number;
}

const COHERENT_MATCH_CENTER_TOLERANCE = 0.25;
const COHERENT_MATCH_OFFSET_TOLERANCE = 0.15;
const MIN_COHERENT_MATCH_LENGTH = 3;

export function normalizeTranscriptToken(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function wordCenter(word: TranscriptWord): number {
  return (word.start + word.end) / 2;
}

function spansOverlap(left: TranscriptWord, right: TranscriptWord): boolean {
  return left.start < right.end && right.start < left.end;
}

function isTextTimingMatch(left: TranscriptWord, right: TranscriptWord): boolean {
  const normalized = normalizeTranscriptToken(left.text);
  return normalized.length > 0
    && normalized === normalizeTranscriptToken(right.text)
    && (
      Math.abs(wordCenter(left) - wordCenter(right)) <= COHERENT_MATCH_CENTER_TOLERANCE
      || spansOverlap(left, right)
    );
}

/**
 * Find monotonic duplicate word pairs backed by at least three consecutive
 * token matches. A locally stable center offset tolerates provider drift while
 * preventing isolated repeated words from being collapsed.
 */
export function findCoherentTranscriptWordMatches(
  existingWords: TranscriptWord[],
  newWords: TranscriptWord[],
): TranscriptWordMatch[] {
  const existing = existingWords
    .map((word, index) => ({ index, word }))
    .toSorted((left, right) => left.word.start - right.word.start);
  const incoming = newWords
    .map((word, index) => ({ index, word }))
    .toSorted((left, right) => left.word.start - right.word.start);
  const existingByToken = new Map<string, number[]>();

  for (let index = 0; index < existing.length; index++) {
    const token = normalizeTranscriptToken(existing[index].word.text);
    if (!token) continue;
    const indices = existingByToken.get(token) ?? [];
    indices.push(index);
    existingByToken.set(token, indices);
  }

  const matches = new Map<number, TranscriptWordMatch>();
  for (let newStart = 0; newStart < incoming.length; newStart++) {
    const token = normalizeTranscriptToken(incoming[newStart].word.text);
    for (const existingStart of existingByToken.get(token) ?? []) {
      if (!isTextTimingMatch(existing[existingStart].word, incoming[newStart].word)) continue;

      let minimumOffset = Number.POSITIVE_INFINITY;
      let maximumOffset = Number.NEGATIVE_INFINITY;
      let length = 0;
      while (
        existingStart + length < existing.length
        && newStart + length < incoming.length
        && isTextTimingMatch(
          existing[existingStart + length].word,
          incoming[newStart + length].word,
        )
      ) {
        const offset = wordCenter(incoming[newStart + length].word)
          - wordCenter(existing[existingStart + length].word);
        minimumOffset = Math.min(minimumOffset, offset);
        maximumOffset = Math.max(maximumOffset, offset);
        if (maximumOffset - minimumOffset > COHERENT_MATCH_OFFSET_TOLERANCE) break;
        length += 1;
      }

      if (length < MIN_COHERENT_MATCH_LENGTH) continue;
      for (let offset = 0; offset < length; offset++) {
        const incomingEntry = incoming[newStart + offset];
        if (!matches.has(incomingEntry.index)) {
          matches.set(incomingEntry.index, {
            existingIndex: existing[existingStart + offset].index,
            newIndex: incomingEntry.index,
          });
        }
      }
    }
  }

  return [...matches.values()].toSorted((left, right) => left.newIndex - right.newIndex);
}

export function mergeTranscriptWords(
  existingWords: TranscriptWord[],
  newWords: TranscriptWord[],
): TranscriptWord[] {
  const merged = [...existingWords];
  const coherentDuplicateIndices = new Set(
    findCoherentTranscriptWordMatches(existingWords, newWords)
      .map(match => match.newIndex),
  );

  for (let index = 0; index < newWords.length; index++) {
    const word = newWords[index];
    const duplicate = merged.some(
      (w: TranscriptWord) => Math.abs(w.start - word.start) < 0.05 && Math.abs(w.end - word.end) < 0.05,
    );
    if (!duplicate && !coherentDuplicateIndices.has(index)) merged.push(word);
  }

  return merged.sort((a, b) => a.start - b.start);
}

export function mapOpenAIWords(
  rawWords: TranscriptApiWord[],
  inPointOffset: number,
  startIndex: number = 0,
): TranscriptWord[] {
  return rawWords.map((word, index) => ({
    id: `word-${startIndex + index}`,
    text: word.word ?? word.text ?? '',
    start: (word.start || 0) + inPointOffset,
    end: (word.end || (word.start ?? 0) + 0.1) + inPointOffset,
    confidence: typeof word.confidence === 'number' ? word.confidence : 1,
    speaker: formatTranscriptSpeaker(word.speaker),
  }));
}

export function mapDeepgramWords(
  rawWords: TranscriptApiWord[],
  inPointOffset: number,
  startIndex: number = 0,
): TranscriptWord[] {
  return rawWords.map((word, index) => {
    const start = typeof word.start === 'number' ? word.start : 0;
    const end = typeof word.end === 'number' ? word.end : start + 0.1;
    const speaker = typeof word.speaker === 'number'
      ? `Speaker ${word.speaker + 1}`
      : word.speaker ?? 'Speaker 1';

    return {
      id: `word-${startIndex + index}`,
      text: word.punctuated_word ?? word.word ?? word.text ?? '',
      start: start + inPointOffset,
      end: end + inPointOffset,
      confidence: typeof word.confidence === 'number' ? word.confidence : 1,
      speaker,
      speakerConfidence: word.speakerConfidence ?? word.speaker_confidence,
    };
  });
}
