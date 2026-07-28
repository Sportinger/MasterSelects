import { describe, expect, it } from 'vitest';
import type { TranscriptWord } from '../../src/types';
import {
  createTranscriptProviderRun,
  fuseTranscriptProviderRuns,
} from '../../src/services/transcription/fusion/transcriptFusion';

function word(
  id: string,
  text: string,
  start: number,
  end: number,
  options: Partial<TranscriptWord> = {},
): TranscriptWord {
  return {
    id,
    text,
    start,
    end,
    confidence: 0.95,
    speaker: 'Speaker 1',
    speakerConfidence: 0.9,
    ...options,
  };
}

function fuse(deepgramWords: TranscriptWord[], openaiWords: TranscriptWord[]) {
  const range: [number, number] = [0, 4];
  return fuseTranscriptProviderRuns(
    createTranscriptProviderRun({
      createdAt: 100,
      language: 'en',
      provider: 'deepgram',
      range,
      words: deepgramWords,
    }),
    createTranscriptProviderRun({
      createdAt: 100,
      language: 'en',
      provider: 'openai',
      range,
      words: openaiWords,
    }),
  );
}

describe('Best Quality transcript projection', () => {
  it('keeps Deepgram text, word timing, and confidence unchanged', () => {
    const artifact = fuse([
      word('dg-0', 'exact', 0, 0.4, { confidence: 0.42 }),
      word('dg-1', 'wording', 0.4, 0.9, { confidence: 0.98 }),
    ], [
      word('oa-0', 'different', 0, 0.45, { speaker: 'Speaker A' }),
      word('oa-1', 'text', 0.45, 0.9, { speaker: 'Speaker A' }),
    ]);

    expect(artifact.words.map(candidate => candidate.text)).toEqual(['exact', 'wording']);
    expect(artifact.words.map(candidate => [candidate.start, candidate.end])).toEqual([
      [0, 0.4],
      [0.4, 0.9],
    ]);
    expect(artifact.words.map(candidate => candidate.confidence)).toEqual([0.42, 0.98]);
    expect(artifact.words.every(candidate => candidate.sourceProvider === 'deepgram')).toBe(true);
  });

  it('projects OpenAI speaker turns automatically and canonicalizes labels by first appearance', () => {
    const artifact = fuse([
      word('dg-0', 'one', 0, 0.4, { speaker: 'Speaker 3' }),
      word('dg-1', 'two', 0.4, 0.8, { speaker: 'Speaker 3' }),
      word('dg-2', 'three', 1, 1.4, { speaker: 'Speaker 1' }),
      word('dg-3', 'four', 1.4, 1.8, { speaker: 'Speaker 1' }),
    ], [
      word('oa-0', 'ignored', 0, 0.8, { speaker: 'Speaker B' }),
      word('oa-1', 'ignored', 1, 1.8, { speaker: 'Speaker A' }),
    ]);

    expect(artifact.words.map(candidate => candidate.speaker)).toEqual([
      'Speaker 1',
      'Speaker 1',
      'Speaker 2',
      'Speaker 2',
    ]);
    expect(artifact.words.every(candidate =>
      candidate.speakerSourceProvider === 'openai')).toBe(true);
    expect(artifact.words.every(candidate =>
      candidate.speakerConfidence === undefined)).toBe(true);
    expect(artifact.conflicts).toEqual([]);
    expect(artifact.words.every(candidate => candidate.needsReview === false)).toBe(true);
    expect(artifact.agent.status).toBe('not-requested');
    expect(artifact.patches.every(patch => patch.operation === 'reassign-speaker')).toBe(true);
  });

  it('falls back to Deepgram speakers if OpenAI diarization is unavailable', () => {
    const artifact = fuse([
      word('dg-0', 'hello', 0, 0.4, { speaker: 'Speaker 2' }),
      word('dg-1', 'there', 0.4, 0.8, { speaker: 'Speaker 2' }),
    ], []);

    expect(artifact.words.map(candidate => candidate.speaker)).toEqual([
      'Speaker 2',
      'Speaker 2',
    ]);
    expect(artifact.words.every(candidate =>
      candidate.speakerSourceProvider === 'deepgram')).toBe(true);
    expect(artifact.words.every(candidate =>
      candidate.speakerConfidence === 0.9)).toBe(true);
    expect(artifact.conflicts).toEqual([]);
  });
});
