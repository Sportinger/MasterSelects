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
const SENTENCE_END = /[.!?…](?:["'’”»)\]}]+)?$/u;

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

function splitIntoSpeechRuns(words: readonly ResolvedTranscriptWord[]): readonly ResolvedTranscriptWord[][] {
  const runs: ResolvedTranscriptWord[][] = [];
  for (const resolved of words) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    const speakerChanged = previous && previous.speakerKey !== resolved.speakerKey;
    const longSilence = previous
      && resolved.word.start - previous.word.end >= ANALYSIS_TRANSCRIPT_CHUNK_SILENCE_SECONDS;
    if (!run || speakerChanged || longSilence) {
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

function chooseChunkEnd(words: readonly ResolvedTranscriptWord[], startIndex: number): number {
  const finalIndex = words.length - 1;
  let limitIndex = startIndex;
  while (limitIndex < finalIndex) {
    const nextIndex = limitIndex + 1;
    const nextDuration = rangeDuration(words, startIndex, nextIndex);
    const nextWordCount = nextIndex - startIndex + 1;
    if (
      nextDuration > ANALYSIS_TRANSCRIPT_CHUNK_MAX_SECONDS
      || nextWordCount > ANALYSIS_TRANSCRIPT_CHUNK_MAX_WORDS
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

function chunkSpeechRun(words: readonly ResolvedTranscriptWord[]): readonly ResolvedTranscriptWord[][] {
  const chunks: ResolvedTranscriptWord[][] = [];
  let startIndex = 0;
  while (startIndex < words.length) {
    const endIndex = chooseChunkEnd(words, startIndex);
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

  const wordChunks = splitIntoSpeechRuns(resolvedWords).flatMap(chunkSpeechRun);
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
