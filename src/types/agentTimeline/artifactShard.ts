export const ARTIFACT_SHARD_SCHEMA_VERSION = 'agent-timeline-artifact-shard/v1' as const;
export const ARTIFACT_SHARD_INDEX_SCHEMA_VERSION = 'agent-timeline-artifact-shard-index/v1' as const;

export type AgentTimelineArtifactChannel =
  | 'cuts'
  | 'shots'
  | 'scene-blocks'
  | 'focus'
  | 'motion'
  | 'faces'
  | 'transcript'
  | 'audio'
  | 'active-speaker'
  | 'camera-motion'
  | 'quality'
  | 'ocr'
  | 'redundancy';

export type AgentTimelineAnalysisProfile = 'quick' | 'balanced' | 'deep' | 'custom';
export type ArtifactTimeDomain = 'source' | 'clip-rendered' | 'composition-rendered';

/** Seconds in source time. `start` is inclusive and `end` is exclusive. */
export interface SourceTimeRange {
  start: number;
  end: number;
}

interface ArtifactShardKey {
  sourceIdentityHash: string;
  channel: AgentTimelineArtifactChannel;
  analyzerId: string;
  analyzerVersion: string;
  artifactSchemaVersion: string;
  modelId?: string;
  modelVersion?: string;
  profile: AgentTimelineAnalysisProfile;
  sourceRange: SourceTimeRange;
  artifactRef: string;
}

interface ArtifactShardStorage {
  sizeBytes: number;
  createdAt: string;
}

export type ArtifactShardDescriptorInput = ArtifactShardKey & ArtifactShardStorage & (
  | {
      timeDomain: 'source';
      stateHash?: never;
    }
  | {
      timeDomain: 'clip-rendered' | 'composition-rendered';
      stateHash: string;
    }
);

export type ArtifactShardDescriptor = ArtifactShardDescriptorInput & {
  type: 'agent-timeline-artifact-shard';
  schemaVersion: typeof ARTIFACT_SHARD_SCHEMA_VERSION;
  shardId: string;
};

export interface ArtifactShardIntervalIndexEntry {
  shard: ArtifactShardDescriptor;
  /** Largest sourceRange.end from the first entry through this entry. */
  maxEndThroughEntry: number;
}

export interface ArtifactShardIntervalIndex {
  type: 'agent-timeline-artifact-shard-index';
  schemaVersion: typeof ARTIFACT_SHARD_INDEX_SCHEMA_VERSION;
  entries: ArtifactShardIntervalIndexEntry[];
}

interface ArtifactShardQueryBase {
  sourceIdentityHash: string;
  channel: AgentTimelineArtifactChannel;
  sourceRange: SourceTimeRange;
  analyzerId: string;
  analyzerVersion: string;
  profile: AgentTimelineAnalysisProfile;
  modelId?: string;
  modelVersion?: string;
  /** Explicitly accepted fallbacks. Exact requested values always rank first. */
  compatibleAnalyzerIds?: readonly string[];
  compatibleAnalyzerVersions?: readonly string[];
  compatibleProfiles?: readonly AgentTimelineAnalysisProfile[];
  compatibleModelVersions?: readonly string[];
}

export type ArtifactShardQuery = ArtifactShardQueryBase & (
  | {
      timeDomain: 'source';
      stateHash?: never;
    }
  | {
      timeDomain: 'clip-rendered' | 'composition-rendered';
      stateHash: string;
    }
);

export interface ArtifactShardSelection {
  shard: ArtifactShardDescriptor;
  /** Parts of the query for which this shard is the preferred provider. */
  selectedRanges: SourceTimeRange[];
}

export interface ArtifactShardQueryResult {
  queryRange: SourceTimeRange;
  selections: ArtifactShardSelection[];
  coverage: SourceTimeRange[];
  holes: SourceTimeRange[];
  coveredDuration: number;
}

export type ArtifactShardWriteMode = 'append' | 'replace-overlap';

