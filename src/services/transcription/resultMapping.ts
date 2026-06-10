import type { TranscriptWord } from '../../types/clipMetadata';

export interface TranscriptApiWord {
  word?: string;
  text?: string;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: number | string;
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

export function mergeTranscriptWords(
  existingWords: TranscriptWord[],
  newWords: TranscriptWord[],
): TranscriptWord[] {
  const merged = [...existingWords];

  for (const word of newWords) {
    const duplicate = merged.some(
      (w: TranscriptWord) => Math.abs(w.start - word.start) < 0.05 && Math.abs(w.end - word.end) < 0.05,
    );
    if (!duplicate) merged.push(word);
  }

  return merged.sort((a, b) => a.start - b.start);
}

export function mapOpenAIWords(
  rawWords: Array<{ word: string; start: number; end: number }>,
  inPointOffset: number,
  startIndex: number = 0,
): TranscriptWord[] {
  return rawWords.map((word, index) => ({
    id: `word-${startIndex + index}`,
    text: word.word,
    start: (word.start || 0) + inPointOffset,
    end: (word.end || word.start + 0.1) + inPointOffset,
    confidence: 1,
    speaker: 'Speaker 1',
  }));
}

export function mapAssemblyAIWords(
  rawWords: TranscriptApiWord[],
  inPointOffset: number,
): TranscriptWord[] {
  return rawWords.map((word, index) => {
    const startMs = typeof word.start === 'number' ? word.start : 0;
    const endMs = typeof word.end === 'number' ? word.end : startMs + 100;
    return {
      id: `word-${index}`,
      text: word.text ?? word.word ?? '',
      start: (startMs / 1000) + inPointOffset,
      end: (endMs / 1000) + inPointOffset,
      confidence: word.confidence || 1,
      speaker: word.speaker ? String(word.speaker) : 'Speaker 1',
    };
  });
}

export function mapDeepgramWords(
  rawWords: TranscriptApiWord[],
  inPointOffset: number,
): TranscriptWord[] {
  return rawWords.map((word, index) => {
    const start = typeof word.start === 'number' ? word.start : 0;
    const end = typeof word.end === 'number' ? word.end : start + 0.1;
    const speaker = typeof word.speaker === 'number'
      ? `Speaker ${word.speaker + 1}`
      : word.speaker ?? 'Speaker 1';

    return {
      id: `word-${index}`,
      text: word.word ?? word.text ?? '',
      start: start + inPointOffset,
      end: end + inPointOffset,
      confidence: word.confidence || 1,
      speaker,
    };
  });
}
