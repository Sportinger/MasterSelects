import type { AudioAnalysisArtifact } from '../../audio/audioArtifactTypes';
import type {
  AnalyzerProvenance,
  AgentTimelineProvenance,
} from '../../../types/agentTimeline/manifest';
import type {
  LegacyArtifactShardView,
  LegacyAudioArtifactRecord,
} from '../../../types/agentTimeline/legacyAdapters';
import {
  createLegacyView,
  intervalOverlaps,
  type LegacyAdapterRequest,
} from './legacyAdapterCore';

function audioProvenance(artifact: AudioAnalysisArtifact): AnalyzerProvenance {
  return {
    kind: 'analyzer',
    analyzerId: `${artifact.decoderId}:${artifact.kind}`,
    analyzerVersion: artifact.analyzerVersion,
    modelId: artifact.decoderId,
    modelVersion: artifact.decoderVersion,
    artifactRef: artifact.manifestRef.artifactId,
  };
}

function compareArtifact(left: AudioAnalysisArtifact, right: AudioAnalysisArtifact): number {
  return left.createdAt - right.createdAt
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function adaptLegacyAudioArtifacts(
  artifacts: readonly AudioAnalysisArtifact[] | null | undefined,
  request: LegacyAdapterRequest,
): LegacyArtifactShardView<LegacyAudioArtifactRecord>[] {
  const ordered = (artifacts ?? []).toSorted(compareArtifact);
  const relevant = ordered.filter((artifact) => artifact.duration > 0
    && intervalOverlaps({ start: 0, end: artifact.duration }, request.queryRange));
  const grouped = new Map<string, AudioAnalysisArtifact[]>();
  for (const artifact of relevant) {
    const key = artifact.clipAudioStateHash === undefined
      ? 'source'
      : `clip-rendered:${artifact.clipAudioStateHash}`;
    const group = grouped.get(key) ?? [];
    group.push(artifact);
    grouped.set(key, group);
  }
  if (grouped.size === 0) {
    return [createLegacyView({
      channel: 'audio',
      request,
      sourcePresent: false,
      coverage: [],
      provenance: [],
      records: [],
      limitations: ['payload-not-loaded'],
    })];
  }

  return [...grouped.entries()]
    .toSorted(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, group]) => {
      const fresh = group.filter((artifact) => !artifact.stale);
      const coverage = request.artifactCoverage
        ?? fresh.map((artifact) => ({ start: 0, end: artifact.duration }));
      const records = group.map((artifact): LegacyAudioArtifactRecord => ({
        kind: 'audio-artifact-reference',
        artifactId: artifact.id,
        artifactKind: artifact.kind,
        start: 0,
        end: artifact.duration,
        sampleRate: artifact.sampleRate,
        channelCount: artifact.channelLayout.channelCount,
        stale: artifact.stale,
        payloadArtifactIds: artifact.payloadRefs.map((reference) => reference.artifactId),
      }));
      const provenance: AgentTimelineProvenance[] = group.map(audioProvenance);
      const artifactRefs = group.map((artifact) => artifact.manifestRef.artifactId);
      const onlyStale = fresh.length === 0;
      const stateHash = group[0].clipAudioStateHash;

      return createLegacyView({
        channel: 'audio',
        request,
        sourcePresent: true,
        coverage,
        provenance,
        records,
        artifactRefs,
        timeDomain: stateHash === undefined ? 'source' : 'clip-rendered',
        stateHash,
        limitations: [
          'payload-not-loaded',
          ...(onlyStale ? ['stale-artifact' as const] : []),
        ],
        forceStatus: onlyStale ? 'stale' : undefined,
      });
    });
}
