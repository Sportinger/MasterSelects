import type { TranscriptWord } from '../../types/clipMetadata';

export interface EffectiveWordTiming {
  start: number;
  end: number;
  aligned: boolean;
}

export function effectiveWordTiming(
  word: Pick<
    TranscriptWord,
    'start' | 'end' | 'alignedStart' | 'alignedEnd' | 'alignmentConfidence'
  >,
  options?: { minConfidence?: number },
): EffectiveWordTiming {
  const minimum = Number.isFinite(options?.minConfidence)
    ? options?.minConfidence as number
    : 0.3;
  const alignedStart = word.alignedStart;
  const alignedEnd = word.alignedEnd;
  const confidence = word.alignmentConfidence;
  if (
    Number.isFinite(alignedStart)
    && Number.isFinite(alignedEnd)
    && Number.isFinite(confidence)
    && (alignedEnd as number) > (alignedStart as number)
    && (confidence as number) >= minimum
  ) {
    return {
      start: alignedStart as number,
      end: alignedEnd as number,
      aligned: true,
    };
  }
  return { start: word.start, end: word.end, aligned: false };
}
