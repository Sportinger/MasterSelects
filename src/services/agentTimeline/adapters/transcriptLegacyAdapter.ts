import type { TranscriptWord } from '../../../types/clipMetadata';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
  type AnalyzerProvenance,
} from '../../../types/agentTimeline/manifest';
import type { LegacyArtifactShardView } from '../../../types/agentTimeline/legacyAdapters';
import {
  clampConfidence,
  createLegacyView,
  intervalOverlaps,
  stableLegacyId,
  type LegacyAdapterRequest,
} from './legacyAdapterCore';

function transcriptProvenance(word: TranscriptWord, artifactRef: string | undefined): AnalyzerProvenance {
  return {
    kind: 'analyzer',
    analyzerId: `legacy-transcript-${word.sourceProvider ?? 'unknown-provider'}`,
    analyzerVersion: 'unversioned',
    artifactRef,
  };
}

function speechEvent(word: TranscriptWord, artifactRef: string | undefined): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: stableLegacyId('speech', [word.id, word.start, word.end]),
    type: 'speech',
    time: {
      temporalKind: 'interval',
      timeDomain: 'source',
      start: word.start,
      end: word.end,
    },
    confidence: clampConfidence(word.confidence),
    provenance: [transcriptProvenance(word, artifactRef)],
    data: {
      speakerId: word.speaker ?? 'unknown',
      text: word.text,
      wordCount: 1,
    },
  };
}

export function adaptLegacyTranscript(
  words: readonly TranscriptWord[] | null | undefined,
  request: LegacyAdapterRequest,
): LegacyArtifactShardView {
  const validWords = (words ?? [])
    .filter((word) => Number.isFinite(word.start)
      && Number.isFinite(word.end)
      && word.start >= 0
      && word.end > word.start);
  const events = validWords
    .filter((word) => intervalOverlaps(word, request.queryRange))
    .map((word) => speechEvent(word, request.artifactRef));
  const provenance = validWords.map((word) => transcriptProvenance(word, request.artifactRef));
  const uniqueProvenance = [...new Map(provenance.map((item) => [item.analyzerId, item])).values()]
    .toSorted((left, right) => left.analyzerId < right.analyzerId ? -1 : 1);
  const sourcePresent = words !== null && words !== undefined;
  const coverage = sourcePresent ? request.artifactCoverage ?? [] : [];

  return createLegacyView({
    channel: 'speech',
    request,
    sourcePresent,
    coverage,
    provenance: uniqueProvenance,
    events,
    limitations: sourcePresent && request.artifactCoverage === undefined
      ? ['coverage-not-recorded']
      : [],
  });
}
