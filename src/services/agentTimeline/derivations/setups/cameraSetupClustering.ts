import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineProvenance,
  type AgentTimelineRange,
} from '../../../../types/agentTimeline/manifest';
import {
  SETUP_CLUSTERING_VERSION,
  type CameraSetupDescriptor,
  type SetupAssignmentEvent,
  type SetupClusteringOptions,
  type SetupClusteringResult,
  type SetupClusteringThresholds,
  type SetupShotInput,
  type SourceCameraSetupCluster,
} from '../../../../types/agentTimeline/setupDerivations';
import type { SourceIdentity } from '../../../../types/agentTimeline/sourceIdentity';
import {
  compareSetupDescriptors,
  descriptorAvailableWeight,
  descriptorSignals,
} from './setupDescriptorSimilarity';

export const DEFAULT_SETUP_CLUSTERING_THRESHOLDS: SetupClusteringThresholds = Object.freeze({
  minimumSimilarity: 0.82,
  adjacentShotMinimumSimilarity: 0.9,
  shortShotMinimumSimilarity: 0.92,
  shortShotDuration: 0.75,
  minimumComparableWeight: 0.3,
  maximumHashBits: 256,
  maximumHistogramBins: 256,
  maximumFaceCenters: 16,
  weights: {
    perceptualHash: 0.35,
    colorHistogram: 0.25,
    lumaHistogram: 0.1,
    edgeHistogram: 0.1,
    faceLayout: 0.2,
  },
});

interface PreparedShot extends SetupShotInput {
  descriptor: CameraSetupDescriptor;
  sourceOrder: number;
}

interface MutableCluster {
  members: PreparedShot[];
  minimumSimilarity: number;
}

interface ClusterComparison {
  average: number;
  minimum: number;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function setupId(sourceIdentity: SourceIdentity, memberShotIds: string[]): string {
  return `source-setup-${stableHash(`${sourceIdentity.hash}:${memberShotIds.toSorted().join('|')}`)}`;
}

function mergeRanges(input: AgentTimelineRange[]): AgentTimelineRange[] {
  const result: AgentTimelineRange[] = [];
  for (const range of input.toSorted((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

function minimumPairSimilarity(
  candidate: PreparedShot,
  member: PreparedShot,
  thresholds: SetupClusteringThresholds,
): number {
  const adjacent = Math.abs(candidate.sourceOrder - member.sourceOrder) === 1;
  const short = candidate.end - candidate.start < thresholds.shortShotDuration
    || member.end - member.start < thresholds.shortShotDuration;
  return Math.max(
    thresholds.minimumSimilarity,
    adjacent ? thresholds.adjacentShotMinimumSimilarity : 0,
    short ? thresholds.shortShotMinimumSimilarity : 0,
  );
}

function compareWithCluster(
  shot: PreparedShot,
  cluster: MutableCluster,
  thresholds: SetupClusteringThresholds,
): ClusterComparison | undefined {
  const similarities: number[] = [];
  for (const member of cluster.members) {
    const comparison = compareSetupDescriptors(shot.descriptor, member.descriptor, thresholds);
    if (!comparison || comparison.similarity < minimumPairSimilarity(shot, member, thresholds)) return undefined;
    similarities.push(comparison.similarity);
  }
  return {
    average: similarities.reduce((sum, value) => sum + value, 0) / similarities.length,
    minimum: Math.min(...similarities),
  };
}

function copyProvenance(input: AgentTimelineProvenance[] | undefined): AgentTimelineProvenance[] {
  return [
    ...(input ?? []).map((entry) => ({ ...entry })),
    { kind: 'analyzer', analyzerId: 'camera-setup-clustering', analyzerVersion: SETUP_CLUSTERING_VERSION },
  ];
}

function eventForUnknown(
  shot: SetupShotInput,
  reason: 'missing-descriptor' | 'insufficient-comparable-signals',
  thresholds: SetupClusteringThresholds,
  provenance: AgentTimelineProvenance[],
): SetupAssignmentEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: `setup-assignment:${encodeURIComponent(shot.shotId)}:${shot.start}:${shot.end}`,
    type: 'shot',
    time: { temporalKind: 'interval', timeDomain: 'source', start: shot.start, end: shot.end },
    confidence: 0,
    provenance: provenance.map((entry) => ({ ...entry })),
    keyframeSourceTime: Number.isFinite(shot.keyframeSourceTime)
      && shot.keyframeSourceTime! >= shot.start && shot.keyframeSourceTime! < shot.end
      ? shot.keyframeSourceTime : undefined,
    data: {
      shotId: shot.shotId,
      setupStatus: 'unknown',
      setupReason: reason,
      clusterSize: 0,
      descriptorSignals: descriptorSignals(shot.descriptor, thresholds),
    },
  };
}

export function clusterCameraSetups(
  sourceIdentity: SourceIdentity,
  inputShots: SetupShotInput[],
  options: SetupClusteringOptions = {},
): SetupClusteringResult {
  const thresholds: SetupClusteringThresholds = {
    ...DEFAULT_SETUP_CLUSTERING_THRESHOLDS,
    ...options.thresholds,
    weights: { ...DEFAULT_SETUP_CLUSTERING_THRESHOLDS.weights, ...options.thresholds?.weights },
  };
  const sortedShots = inputShots
    .filter((shot) => Number.isFinite(shot.start) && Number.isFinite(shot.end) && shot.start < shot.end)
    .toSorted((left, right) => left.start - right.start || left.end - right.end || left.shotId.localeCompare(right.shotId));
  if (new Set(sortedShots.map((shot) => shot.shotId)).size !== sortedShots.length) {
    throw new TypeError('Setup clustering requires unique shot IDs');
  }
  const provenance = copyProvenance(options.provenance);
  const unknownEvents: SetupAssignmentEvent[] = [];
  const eligible: PreparedShot[] = [];
  sortedShots.forEach((shot, sourceOrder) => {
    if (!shot.descriptor || descriptorSignals(shot.descriptor, thresholds).length === 0) {
      unknownEvents.push(eventForUnknown(shot, 'missing-descriptor', thresholds, provenance));
    } else if (descriptorAvailableWeight(shot.descriptor, thresholds) < thresholds.minimumComparableWeight) {
      unknownEvents.push(eventForUnknown(shot, 'insufficient-comparable-signals', thresholds, provenance));
    } else {
      eligible.push({ ...shot, descriptor: shot.descriptor, sourceOrder });
    }
  });

  const mutableClusters: MutableCluster[] = [];
  for (const shot of eligible) {
    const matches = mutableClusters.flatMap((cluster, index) => {
      const comparison = compareWithCluster(shot, cluster, thresholds);
      return comparison === undefined ? [] : [{ cluster, index, comparison }];
    }).toSorted((left, right) => right.comparison.average - left.comparison.average || left.index - right.index);
    const best = matches[0];
    if (!best) mutableClusters.push({ members: [shot], minimumSimilarity: 1 });
    else {
      best.cluster.members.push(shot);
      best.cluster.minimumSimilarity = Math.min(best.cluster.minimumSimilarity, best.comparison.minimum);
    }
  }

  const clusters: SourceCameraSetupCluster[] = mutableClusters.map((cluster) => {
    const memberShotIds = cluster.members.map((member) => member.shotId).sort();
    return {
      setupId: setupId(sourceIdentity, memberShotIds),
      memberShotIds,
      start: Math.min(...cluster.members.map((member) => member.start)),
      end: Math.max(...cluster.members.map((member) => member.end)),
      confidence: cluster.members.length > 1 ? cluster.minimumSimilarity : 0.5,
      recurring: cluster.members.length > 1,
    };
  }).toSorted((left, right) => left.start - right.start || left.setupId.localeCompare(right.setupId));

  const events = mutableClusters.flatMap((cluster, index) => {
    const summary = clusters.find((candidate) => (
      candidate.memberShotIds.length === cluster.members.length
      && candidate.memberShotIds.every((shotId) => cluster.members.some((member) => member.shotId === shotId))
    ));
    if (!summary) throw new Error(`Missing setup cluster summary ${index}`);
    return cluster.members.map((shot): SetupAssignmentEvent => ({
      schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
      id: `setup-assignment:${encodeURIComponent(shot.shotId)}:${shot.start}:${shot.end}`,
      type: 'shot',
      time: { temporalKind: 'interval', timeDomain: 'source', start: shot.start, end: shot.end },
      confidence: summary.confidence,
      provenance: provenance.map((entry) => ({ ...entry })),
      keyframeSourceTime: Number.isFinite(shot.keyframeSourceTime)
        && shot.keyframeSourceTime! >= shot.start && shot.keyframeSourceTime! < shot.end
        ? shot.keyframeSourceTime : undefined,
      data: {
        shotId: shot.shotId,
        setupId: summary.setupId,
        setupStatus: summary.recurring ? 'recurring' : 'unique',
        setupReason: summary.recurring ? 'clustered-across-shots' : 'no-compatible-match',
        clusterSize: summary.memberShotIds.length,
        similarity: summary.recurring ? summary.confidence : undefined,
        descriptorSignals: descriptorSignals(shot.descriptor, thresholds),
      },
    }));
  }).concat(unknownEvents).toSorted((left, right) => {
    const leftStart = left.time.temporalKind === 'interval' ? left.time.start : 0;
    const rightStart = right.time.temporalKind === 'interval' ? right.time.start : 0;
    return leftStart - rightStart || left.data.shotId.localeCompare(right.data.shotId);
  });
  const missingShotIds = unknownEvents.map((event) => event.data.shotId).sort();
  const coveredShotIds = eligible.map((shot) => shot.shotId).sort();
  return {
    version: SETUP_CLUSTERING_VERSION,
    sourceIdentity,
    events,
    clusters,
    coverage: {
      coveredShotIds,
      missingShotIds,
      coveredRanges: mergeRanges(eligible.map((shot) => ({ start: shot.start, end: shot.end }))),
      missingRanges: mergeRanges(unknownEvents.map((event) => ({
        start: event.time.temporalKind === 'interval' ? event.time.start : 0,
        end: event.time.temporalKind === 'interval' ? event.time.end : 0,
      }))),
    },
  };
}
