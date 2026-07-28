import {
  rangesOverlap,
  type AnalysisSceneRange,
  type AnalysisSceneSpeakerTurn,
  type AnalysisSceneTranscriptWord,
  type AnalysisSceneView,
} from './analysisSceneViewModel';

export const ANALYSIS_TRANSCRIPT_CHUNK_TARGET_SECONDS = 10;
export const ANALYSIS_TRANSCRIPT_CHUNK_MIN_SECONDS = 3;
export const ANALYSIS_TRANSCRIPT_CHUNK_MAX_SECONDS = 15;
export const ANALYSIS_TRANSCRIPT_CHUNK_SILENCE_SECONDS = 1.5;
const ANALYSIS_TRANSCRIPT_CHUNK_MAX_WORDS = 28;
const ANALYSIS_TRANSCRIPT_CHARACTER_WIDTH_PX = 6.5;
const ANALYSIS_TRANSCRIPT_MIN_CHARACTER_CAPACITY = 24;
const ANALYSIS_TRANSCRIPT_MAX_CHARACTER_CAPACITY = 180;
const SENTENCE_END = /[.!?…](?:["'’”»)\]}]+)?$/u;

export interface AnalysisTranscriptChunkPause {
  start: number;
  end: number;
}

export interface AnalysisTranscriptChunkOptions {
  pauses?: readonly AnalysisTranscriptChunkPause[];
  maxTextCharacters?: number;
}

interface ResolvedTranscriptWord {
  word: AnalysisSceneTranscriptWord;
  speakerKey: string;
  speakerId?: string;
  speakerLabel: string;
  personId?: string;
  state: AnalysisSceneSpeakerTurn['state'];
}

export interface AnalysisTranscriptChunk extends AnalysisSceneRange {
  id: string;
  sceneId: string;
  words: readonly AnalysisSceneTranscriptWord[];
  speakerId?: string;
  speakerLabel?: string;
  personId?: string;
  speakerState?: AnalysisSceneSpeakerTurn['state'];
  partIndex: number;
  partCount: number;
  fallback: boolean;
}

function validWord(word: AnalysisSceneTranscriptWord): boolean {
  return Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start;
}

function sentenceEndsAt(word: AnalysisSceneTranscriptWord): boolean {
  return SENTENCE_END.test(word.text.trim());
}

function resolveWords(scene: AnalysisSceneView): readonly ResolvedTranscriptWord[] {
  const turns = scene.speakerTurns
    .filter(turn => Number.isFinite(turn.start) && Number.isFinite(turn.end) && turn.end > turn.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
  return scene.transcript
    .filter(word => validWord(word) && rangesOverlap(scene.range, word))
    .toSorted((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id))
    .map((word): ResolvedTranscriptWord => {
      const turn = turns.find(candidate => rangesOverlap(candidate, word));
      const speakerId = turn?.speakerId ?? word.speakerId;
      const speakerLabel = turn?.speakerLabel ?? (word.speakerLabel?.trim() || 'Unknown speaker');
      return {
        word,
        speakerKey: speakerId ? `id:${speakerId}` : `label:${speakerLabel}`,
        speakerId,
        speakerLabel,
        personId: turn?.personId,
        state: turn?.state ?? (speakerId || word.speakerLabel ? 'offscreen' : 'unknown'),
      };
    });
}

function gapOverlapsVadPause(
  previous: AnalysisSceneTranscriptWord,
  next: AnalysisSceneTranscriptWord,
  pauses: readonly AnalysisTranscriptChunkPause[],
): boolean {
  if (next.start <= previous.end) return false;
  return pauses.some(pause => (
    Number.isFinite(pause.start)
    && Number.isFinite(pause.end)
    && pause.end - pause.start >= 0.5
    && pause.start < next.start
    && previous.end < pause.end
  ));
}

function splitIntoSpeechRuns(
  words: readonly ResolvedTranscriptWord[],
  pauses: readonly AnalysisTranscriptChunkPause[] = [],
): readonly ResolvedTranscriptWord[][] {
  const runs: ResolvedTranscriptWord[][] = [];
  for (const resolved of words) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    const speakerChanged = previous && previous.speakerKey !== resolved.speakerKey;
    const longSilence = previous
      && resolved.word.start - previous.word.end >= ANALYSIS_TRANSCRIPT_CHUNK_SILENCE_SECONDS;
    const vadPause = previous
      && gapOverlapsVadPause(previous.word, resolved.word, pauses);
    if (!run || speakerChanged || longSilence || vadPause) {
      runs.push([resolved]);
    } else {
      run.push(resolved);
    }
  }
  return runs;
}

function rangeDuration(words: readonly ResolvedTranscriptWord[], startIndex: number, endIndex: number): number {
  return Math.max(0, words[endIndex].word.end - words[startIndex].word.start);
}

function remainingDuration(words: readonly ResolvedTranscriptWord[], afterIndex: number): number {
  const next = words[afterIndex + 1];
  return next ? Math.max(0, words.at(-1)!.word.end - next.word.start) : 0;
}

function rangeTextCharacters(
  words: readonly ResolvedTranscriptWord[],
  startIndex: number,
  endIndex: number,
): number {
  let characters = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    // Each word is an individual button. One extra character-equivalent per
    // word accounts for its horizontal padding in addition to the word gap.
    characters += words[index].word.text.trim().length + (index === startIndex ? 1 : 2);
  }
  return characters;
}

export function getAnalysisTranscriptCharacterCapacity(
  textWidth: number,
): number | undefined {
  if (!Number.isFinite(textWidth) || textWidth <= 0) return undefined;
  return Math.max(
    ANALYSIS_TRANSCRIPT_MIN_CHARACTER_CAPACITY,
    Math.min(
      ANALYSIS_TRANSCRIPT_MAX_CHARACTER_CAPACITY,
      Math.floor(textWidth / ANALYSIS_TRANSCRIPT_CHARACTER_WIDTH_PX),
    ),
  );
}

function closestToTarget(
  words: readonly ResolvedTranscriptWord[],
  startIndex: number,
  candidates: readonly number[],
): number | undefined {
  return candidates.reduce<number | undefined>((best, candidate) => {
    if (best === undefined) return candidate;
    const candidateDistance = Math.abs(
      rangeDuration(words, startIndex, candidate) - ANALYSIS_TRANSCRIPT_CHUNK_TARGET_SECONDS,
    );
    const bestDistance = Math.abs(
      rangeDuration(words, startIndex, best) - ANALYSIS_TRANSCRIPT_CHUNK_TARGET_SECONDS,
    );
    return candidateDistance < bestDistance ? candidate : best;
  }, undefined);
}

function chooseChunkEnd(
  words: readonly ResolvedTranscriptWord[],
  startIndex: number,
  maxTextCharacters?: number,
): number {
  const finalIndex = words.length - 1;
  const characterLimit = Number.isFinite(maxTextCharacters)
    ? Math.max(1, Math.floor(maxTextCharacters as number))
    : Number.POSITIVE_INFINITY;
  let limitIndex = startIndex;
  while (limitIndex < finalIndex) {
    const nextIndex = limitIndex + 1;
    const nextDuration = rangeDuration(words, startIndex, nextIndex);
    const nextWordCount = nextIndex - startIndex + 1;
    const nextCharacterCount = rangeTextCharacters(words, startIndex, nextIndex);
    if (
      nextDuration > ANALYSIS_TRANSCRIPT_CHUNK_MAX_SECONDS
      || nextWordCount > ANALYSIS_TRANSCRIPT_CHUNK_MAX_WORDS
      || nextCharacterCount > characterLimit
    ) break;
    limitIndex = nextIndex;
  }

  // A single unusually long token stays atomic even when its timestamp exceeds
  // the normal maximum; splitting a transcript word would invent timing data.
  if (limitIndex === startIndex && startIndex === finalIndex) return finalIndex;

  const forcedSplit = limitIndex < finalIndex;
  const preferredCandidates: number[] = [];
  for (let index = startIndex; index <= limitIndex; index += 1) {
    const duration = rangeDuration(words, startIndex, index);
    if (duration < ANALYSIS_TRANSCRIPT_CHUNK_MIN_SECONDS) continue;
    const leavesUsableTail = index === finalIndex
      || remainingDuration(words, index) >= ANALYSIS_TRANSCRIPT_CHUNK_MIN_SECONDS;
    if (leavesUsableTail && sentenceEndsAt(words[index].word)) preferredCandidates.push(index);
  }

  const preferred = closestToTarget(words, startIndex, preferredCandidates);
  if (preferred !== undefined) return preferred;
  if (!forcedSplit) return finalIndex;

  const wordBoundaryCandidates: number[] = [];
  for (let index = startIndex; index <= limitIndex; index += 1) {
    const duration = rangeDuration(words, startIndex, index);
    if (duration < ANALYSIS_TRANSCRIPT_CHUNK_MIN_SECONDS) continue;
    if (remainingDuration(words, index) >= ANALYSIS_TRANSCRIPT_CHUNK_MIN_SECONDS) {
      wordBoundaryCandidates.push(index);
    }
  }
  return closestToTarget(words, startIndex, wordBoundaryCandidates) ?? limitIndex;
}

function chunkSpeechRun(
  words: readonly ResolvedTranscriptWord[],
  maxTextCharacters?: number,
): readonly ResolvedTranscriptWord[][] {
  const chunks: ResolvedTranscriptWord[][] = [];
  let startIndex = 0;
  while (startIndex < words.length) {
    const endIndex = chooseChunkEnd(words, startIndex, maxTextCharacters);
    chunks.push(words.slice(startIndex, endIndex + 1));
    startIndex = endIndex + 1;
  }
  return chunks;
}

function chunkId(
  sceneId: string,
  words: readonly ResolvedTranscriptWord[],
  partIndex: number,
): string {
  const first = words[0].word;
  const last = words.at(-1)!.word;
  return [
    sceneId,
    'speech',
    partIndex,
    first.id,
    first.start.toFixed(3),
    last.id,
    last.end.toFixed(3),
  ].join(':');
}

/**
 * Builds presentation-only transcript chunks without changing the semantic
 * scene boundaries used by the overview, coverage, and analysis data.
 */
export function buildAnalysisTranscriptChunks(
  scene: AnalysisSceneView,
  options?: AnalysisTranscriptChunkOptions,
): readonly AnalysisTranscriptChunk[] {
  const resolvedWords = resolveWords(scene);
  if (resolvedWords.length === 0) {
    return [{
      id: `${scene.id}:speech:fallback`,
      sceneId: scene.id,
      ...scene.range,
      words: [],
      partIndex: 1,
      partCount: 1,
      fallback: true,
    }];
  }

  const wordChunks = splitIntoSpeechRuns(resolvedWords, options?.pauses)
    .flatMap(words => chunkSpeechRun(words, options?.maxTextCharacters));
  const partCount = wordChunks.length;
  return wordChunks.map((words, index) => ({
    id: chunkId(scene.id, words, index + 1),
    sceneId: scene.id,
    start: Math.max(scene.range.start, words[0].word.start),
    end: Math.min(scene.range.end, words.at(-1)!.word.end),
    words: words.map(item => item.word),
    speakerId: words[0].speakerId,
    speakerLabel: words[0].speakerLabel,
    personId: words[0].personId,
    speakerState: words[0].state,
    partIndex: index + 1,
    partCount,
    fallback: false,
  }));
}
