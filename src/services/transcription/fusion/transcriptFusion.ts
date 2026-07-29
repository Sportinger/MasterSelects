import type {
  TranscriptFusionArtifact,
  TranscriptPatch,
  TranscriptProviderId,
  TranscriptProviderRun,
  TranscriptWord,
} from '../../../types/clipMetadata';

export const TRANSCRIPT_FUSION_MODELS = {
  deepgram: 'nova-3',
  openai: 'gpt-4o-transcribe-diarize',
} as const;

interface SpeakerSpan {
  end: number;
  rawSpeaker: string;
  speaker: string;
  start: number;
}

interface SpeakerProjectionRun {
  after: string;
  before: string;
  words: TranscriptWord[];
}

function buildOpenAISpeakerSpans(words: TranscriptWord[]): SpeakerSpan[] {
  const ordered = words
    .filter(word => Boolean(word.speaker))
    .toSorted((left, right) => left.start - right.start);
  const speakerAliases = new Map<string, string>();
  const spans: SpeakerSpan[] = [];

  for (const word of ordered) {
    const rawSpeaker = word.speaker!;
    if (!speakerAliases.has(rawSpeaker)) {
      speakerAliases.set(rawSpeaker, `Speaker ${speakerAliases.size + 1}`);
    }
    const speaker = speakerAliases.get(rawSpeaker)!;
    const active = spans.at(-1);
    if (
      active
      && active.rawSpeaker === rawSpeaker
      && word.start - active.end <= 0.35
    ) {
      active.end = Math.max(active.end, word.end);
      continue;
    }
    spans.push({
      end: word.end,
      rawSpeaker,
      speaker,
      start: word.start,
    });
  }
  return spans;
}

function distanceToSpan(time: number, span: SpeakerSpan): number {
  if (time < span.start) return span.start - time;
  if (time > span.end) return time - span.end;
  return 0;
}

function findSpeakerForWord(word: TranscriptWord, spans: SpeakerSpan[]): string | undefined {
  const center = (word.start + word.end) / 2;
  let closest: SpeakerSpan | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const span of spans) {
    const distance = distanceToSpan(center, span);
    if (distance < closestDistance) {
      closest = span;
      closestDistance = distance;
    }
    if (distance === 0) break;
  }

  return closestDistance <= 1.25 ? closest?.speaker : undefined;
}

function projectOpenAISpeakers(
  deepgramWords: TranscriptWord[],
  openaiWords: TranscriptWord[],
): { patches: TranscriptPatch[]; words: TranscriptWord[] } {
  const spans = buildOpenAISpeakerSpans(openaiWords);
  const words = deepgramWords.map((word): TranscriptWord => {
    const openAISpeaker = findSpeakerForWord(word, spans);
    return {
      ...word,
      agreement: undefined,
      alternatives: undefined,
      needsReview: false,
      originalSpeaker: undefined,
      sourceProvider: 'deepgram',
      speaker: openAISpeaker ?? word.speaker ?? 'Speaker 1',
      speakerConfidence: openAISpeaker ? undefined : word.speakerConfidence,
      speakerSourceProvider: openAISpeaker ? 'openai' : 'deepgram',
    };
  });

  const changedRuns: SpeakerProjectionRun[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const before = deepgramWords[index].speaker ?? 'Speaker 1';
    const after = words[index].speaker ?? 'Speaker 1';
    if (before === after) continue;
    const active = changedRuns.at(-1);
    if (
      active
      && active.before === before
      && active.after === after
      && words[index].start - active.words.at(-1)!.end <= 0.45
    ) {
      active.words.push(words[index]);
      continue;
    }
    changedRuns.push({ after, before, words: [words[index]] });
  }

  const patches = changedRuns.map((run): TranscriptPatch => {
    const start = run.words[0].start;
    const end = run.words.at(-1)!.end;
    const id = `speaker-projection-${Math.round(start * 1000)}-${Math.round(end * 1000)}`;
    return {
      id,
      conflictId: id,
      source: 'deterministic',
      operation: 'reassign-speaker',
      wordIds: run.words.map(word => word.id),
      before: run.before,
      after: run.after,
      confidence: 1,
      reason: 'Best Quality uses OpenAI diarization as the authoritative speaker partition.',
      createdAt: Date.now(),
    };
  });

  return { patches, words };
}

export function createTranscriptProviderRun({
  createdAt = Date.now(),
  language,
  provider,
  range,
  words,
}: {
  createdAt?: number;
  language: string;
  provider: TranscriptProviderId;
  range: [number, number];
  words: TranscriptWord[];
}): TranscriptProviderRun {
  const rangeId = `${Math.round(range[0] * 1000)}-${Math.round(range[1] * 1000)}`;
  const runId = `${provider}-${rangeId}-${createdAt}`;
  return {
    id: runId,
    provider,
    model: TRANSCRIPT_FUSION_MODELS[provider],
    language,
    range,
    createdAt,
    words: words.map((word, index) => ({
      ...word,
      id: `${runId}:word-${index}`,
      sourceProvider: provider,
    })),
  };
}

/**
 * Best Quality has fixed provider ownership:
 * Deepgram owns every word, timestamp, and confidence; OpenAI owns only the
 * speaker partition. Provider text is intentionally never compared or merged.
 */
export function fuseTranscriptProviderRuns(
  deepgramRun: TranscriptProviderRun,
  openaiRun: TranscriptProviderRun,
): TranscriptFusionArtifact {
  const projection = projectOpenAISpeakers(deepgramRun.words, openaiRun.words);
  return {
    schemaVersion: 1,
    primaryProvider: 'deepgram',
    createdAt: Math.max(deepgramRun.createdAt, openaiRun.createdAt),
    providerStatuses: { deepgram: 'complete', openai: 'complete' },
    rawRuns: [deepgramRun, openaiRun],
    words: projection.words,
    conflicts: [],
    patches: projection.patches,
    agent: { status: 'not-requested' },
  };
}

export function mergeTranscriptFusionArtifacts(
  artifacts: TranscriptFusionArtifact[],
  finalWords: TranscriptWord[],
): TranscriptFusionArtifact | undefined {
  if (artifacts.length === 0) return undefined;
  return {
    schemaVersion: 1,
    primaryProvider: 'deepgram',
    createdAt: Math.max(...artifacts.map(artifact => artifact.createdAt)),
    providerStatuses: {
      deepgram: artifacts.some(artifact => artifact.providerStatuses?.deepgram === 'error')
        ? 'error'
        : 'complete',
      openai: artifacts.some(artifact => artifact.providerStatuses?.openai === 'error')
        ? 'error'
        : 'complete',
    },
    rawRuns: artifacts.flatMap(artifact => artifact.rawRuns),
    words: finalWords.map(word => ({
      ...word,
      alternatives: undefined,
      needsReview: false,
      originalSpeaker: undefined,
    })),
    conflicts: [],
    patches: artifacts
      .flatMap(artifact => artifact.patches)
      .filter(patch => patch.operation === 'reassign-speaker'),
    agent: { status: 'not-requested' },
  };
}

function rangesOverlap(left: [number, number], right: [number, number]): boolean {
  return left[0] < right[1] && right[0] < left[1];
}

export function replaceTranscriptFusionRanges(
  existing: TranscriptFusionArtifact | undefined,
  replacements: TranscriptFusionArtifact[],
  replacedRanges: [number, number][],
  finalWords: TranscriptWord[],
): TranscriptFusionArtifact | undefined {
  if (!existing) return mergeTranscriptFusionArtifacts(replacements, finalWords);
  const retained: TranscriptFusionArtifact = {
    ...existing,
    rawRuns: existing.rawRuns.filter(run =>
      !replacedRanges.some(range => rangesOverlap(run.range, range))),
    words: [],
    conflicts: [],
    patches: [],
    agent: { status: 'not-requested' },
  };
  return mergeTranscriptFusionArtifacts([retained, ...replacements], finalWords);
}
