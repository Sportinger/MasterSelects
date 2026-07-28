import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_TRANSCRIPT_CHUNK_MAX_SECONDS,
  buildAnalysisTranscriptChunks,
  getAnalysisTranscriptCharacterCapacity,
} from '../../src/components/panels/properties/analysisWorkspace/analysisTranscriptChunks';
import type {
  AnalysisSceneTranscriptWord,
  AnalysisSceneView,
} from '../../src/components/panels/properties/analysisWorkspace/analysisSceneViewModel';

function word(
  index: number,
  speaker = 'Ava',
  text = `word${index}`,
  start = index,
): AnalysisSceneTranscriptWord {
  return {
    id: `word-${index}`,
    text,
    start,
    end: start + 0.4,
    speakerId: speaker,
    speakerLabel: speaker,
  };
}

function scene(
  transcript: readonly AnalysisSceneTranscriptWord[],
  end = 82,
): AnalysisSceneView {
  return {
    id: 'scene',
    index: 1,
    boundarySource: 'shot-fallback',
    range: { start: 0, end },
    people: [],
    speakerTurns: [],
    transcript,
    ocr: [],
    qualityIssues: [],
    coverage: {},
  };
}

describe('analysis transcript chunks', () => {
  it('turns one long visual scene into sentence-sized presentation chunks', () => {
    const words = Array.from({ length: 82 }, (_, index) => (
      word(index, 'Ava', (index + 1) % 10 === 0 ? `word${index}.` : `word${index}`)
    ));
    const chunks = buildAnalysisTranscriptChunks(scene(words));

    expect(chunks).toHaveLength(8);
    expect(chunks.every(chunk => chunk.end - chunk.start <= ANALYSIS_TRANSCRIPT_CHUNK_MAX_SECONDS)).toBe(true);
    expect(chunks.flatMap(chunk => chunk.words.map(item => item.id))).toEqual(words.map(item => item.id));
    expect(chunks.map(chunk => chunk.partIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('prefers a sentence end near ten seconds', () => {
    const words = Array.from({ length: 18 }, (_, index) => (
      word(index, 'Ava', index === 9 || index === 17 ? `word${index}.` : `word${index}`)
    ));
    const chunks = buildAnalysisTranscriptChunks(scene(words, 18));

    expect(chunks[0]).toMatchObject({ start: 0, end: 9.4 });
    expect(chunks[0].words.at(-1)?.text).toBe('word9.');
  });

  it('forces unpunctuated speech to word boundaries before fifteen seconds', () => {
    const words = Array.from({ length: 31 }, (_, index) => word(index));
    const chunks = buildAnalysisTranscriptChunks(scene(words, 31));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.end - chunk.start <= ANALYSIS_TRANSCRIPT_CHUNK_MAX_SECONDS)).toBe(true);
    expect(chunks.flatMap(chunk => chunk.words)).toHaveLength(words.length);
  });

  it('uses the word-cap boundary instead of emitting single words for dense speech', () => {
    const words = Array.from({ length: 100 }, (_, index) => (
      word(index, 'Ava', `word${index}`, index * 0.05)
    )).map(item => ({ ...item, end: item.start + 0.02 }));
    const chunks = buildAnalysisTranscriptChunks(scene(words, 5));

    expect(chunks.length).toBeLessThan(10);
    expect(chunks.every(chunk => chunk.words.length > 1)).toBe(true);
    expect(chunks.flatMap(chunk => chunk.words)).toHaveLength(words.length);
  });

  it('adapts presentation chunks to the available transcript width', () => {
    const words = Array.from({ length: 40 }, (_, index) => (
      word(index, 'Ava', `word${index}`, index * 0.1)
    )).map(item => ({ ...item, end: item.start + 0.08 }));
    const narrowChunks = buildAnalysisTranscriptChunks(scene(words, 4), {
      maxTextCharacters: 32,
    });
    const wideChunks = buildAnalysisTranscriptChunks(scene(words, 4), {
      maxTextCharacters: 96,
    });

    expect(narrowChunks.length).toBeGreaterThan(wideChunks.length);
    expect(narrowChunks.flatMap(chunk => chunk.words.map(item => item.id)))
      .toEqual(words.map(item => item.id));
    expect(wideChunks.flatMap(chunk => chunk.words.map(item => item.id)))
      .toEqual(words.map(item => item.id));
  });

  it('turns measured text width into a bounded character budget', () => {
    expect(getAnalysisTranscriptCharacterCapacity(208)).toBe(32);
    expect(getAnalysisTranscriptCharacterCapacity(624)).toBe(96);
    expect(getAnalysisTranscriptCharacterCapacity(20)).toBe(24);
    expect(getAnalysisTranscriptCharacterCapacity(2000)).toBe(180);
    expect(getAnalysisTranscriptCharacterCapacity(0)).toBeUndefined();
  });

  it('hard-splits a speaker change even before the target duration', () => {
    const words = [
      ...Array.from({ length: 4 }, (_, index) => word(index, 'Ava')),
      ...Array.from({ length: 8 }, (_, index) => word(index + 4, 'Ben')),
    ];
    const chunks = buildAnalysisTranscriptChunks(scene(words, 12));

    expect(chunks).toHaveLength(2);
    expect(chunks.map(chunk => chunk.speakerLabel)).toEqual(['Ava', 'Ben']);
    expect(chunks[0].end - chunks[0].start).toBeLessThan(4);
  });

  it('uses a long silence as a natural boundary and keeps words immutable', () => {
    const words = [
      word(0, 'Ava', 'One', 0),
      word(1, 'Ava', 'thought.', 1),
      word(2, 'Ava', 'Next', 5),
      word(3, 'Ava', 'thought.', 6),
    ].toReversed();
    const originalOrder = words.map(item => item.id);
    const chunks = buildAnalysisTranscriptChunks(scene(words, 7));

    expect(chunks).toHaveLength(2);
    expect(chunks.map(chunk => chunk.start)).toEqual([0, 5]);
    expect(words.map(item => item.id)).toEqual(originalOrder);
  });

  it('splits at the existing word boundary when a qualifying VAD pause overlaps the gap', () => {
    const words = [
      word(0, 'Ava', 'First', 0),
      word(1, 'Ava', 'Second', 1.2),
    ];

    const chunks = buildAnalysisTranscriptChunks(scene(words, 2), {
      pauses: [{ start: 0.5, end: 1.05 }],
    });

    expect(chunks.map(chunk => chunk.words.map(item => item.id))).toEqual([
      ['word-0'],
      ['word-1'],
    ]);
    expect(chunks.map(chunk => ({ start: chunk.start, end: chunk.end }))).toEqual([
      { start: 0, end: 0.4 },
      { start: 1.2, end: 1.6 },
    ]);
  });

  it('does not split for an overlapping VAD pause shorter than half a second', () => {
    const words = [
      word(0, 'Ava', 'First', 0),
      word(1, 'Ava', 'Second', 1.2),
    ];

    const chunks = buildAnalysisTranscriptChunks(scene(words, 2), {
      pauses: [{ start: 0.55, end: 0.95 }],
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].words.map(item => item.id)).toEqual(['word-0', 'word-1']);
  });

  it('keeps a no-speech scene as one fallback row', () => {
    expect(buildAnalysisTranscriptChunks(scene([], 20))).toEqual([
      expect.objectContaining({
        sceneId: 'scene',
        start: 0,
        end: 20,
        words: [],
        fallback: true,
        partIndex: 1,
        partCount: 1,
      }),
    ]);
  });

  it('makes duplicate word ids at different times produce unique chunk ids', () => {
    const words = [
      { ...word(0, 'Ava', 'First.', 0), id: 'duplicate' },
      { ...word(1, 'Ava', 'Second.', 10), id: 'duplicate' },
      { ...word(2, 'Ava', 'Third.', 20), id: 'duplicate' },
    ];
    const chunks = buildAnalysisTranscriptChunks(scene(words, 21));

    expect(new Set(chunks.map(chunk => chunk.id)).size).toBe(chunks.length);
  });
});
