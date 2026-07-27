import type {
  ArtifactShardDescriptor,
  ArtifactShardIntervalIndex,
  SourceTimeRange,
} from './artifactShard';
import type {
  AgentTimelineChannel,
  AgentTimelineCoverageSummary,
  AgentTimelineEvent,
  AgentTimelineManifest,
  AgentTimelineQueryScope,
  AgentTimelineQueryTimeDomain,
  AgentTimelineTruncation,
} from './manifest';
import type {
  OccurrenceMappingDirection,
  OccurrenceMappingIndex,
} from './occurrenceMapping';

export type AgentTimelineGranularity = 'summary' | 'shot' | 'event' | 'sample';

export interface AgentTimelineRangeQuery {
  scope: AgentTimelineQueryScope;
  start: number;
  end: number;
  timeDomain: AgentTimelineQueryTimeDomain;
  granularity: AgentTimelineGranularity;
  channels: readonly AgentTimelineChannel[];
  /** Defaults to false; readers must not attach frame payloads when false. */
  includeFrames?: boolean;
  /** Clamped to 1..500. */
  limit?: number;
  cursor?: string;
}

export interface AgentTimelineShardReadRequest {
  shard: ArtifactShardDescriptor;
  /** Selected canonical source ranges only; never an implicit full-shard read. */
  sourceRanges: readonly SourceTimeRange[];
  eventTypes: readonly AgentTimelineEvent['type'][];
  granularity: AgentTimelineGranularity;
  includeFrames: boolean;
}

export interface AgentTimelineShardReader {
  readEvents(request: AgentTimelineShardReadRequest): Promise<readonly AgentTimelineEvent[]>;
}

export interface AgentTimelineRangeQueryInput {
  query: AgentTimelineRangeQuery;
  manifest: AgentTimelineManifest;
  shardIndex: ArtifactShardIntervalIndex;
  shardReader: AgentTimelineShardReader;
  occurrenceMapping?: OccurrenceMappingIndex;
  /** Mapping source ID; defaults to manifest.mediaFileId. */
  mappingSourceId?: string;
  /** Whole response ceiling, clamped to the service maximum. */
  maxResponseBytes?: number;
}

export type ProjectedOccurrenceTime =
  | {
      temporalKind: 'point';
      time: number;
    }
  | {
      temporalKind: 'interval';
      start: number;
      end: number;
      isHold?: boolean;
    };

export interface ProjectedAgentTimelineOccurrence {
  canonicalEventId: string;
  occurrenceId: string;
  mappingSegmentId: string;
  sourceId: string;
  clipId: string;
  compositionPath: readonly string[];
  direction: OccurrenceMappingDirection;
  localSpeedStart: number;
  localSpeedEnd: number;
  /** Always expressed in the root composition-time coordinates of the index. */
  compositionTime: ProjectedOccurrenceTime;
}

export interface AgentTimelineRangeQueryResponse {
  schemaVersion: 'agent-timeline-range-query/v1';
  query: {
    scope: AgentTimelineQueryScope;
    start: number;
    end: number;
    timeDomain: AgentTimelineQueryTimeDomain;
    granularity: AgentTimelineGranularity;
    channels: readonly AgentTimelineChannel[];
    includeFrames: boolean;
  };
  /** Canonical source/rendered artifacts, present once regardless of occurrences. */
  events: readonly AgentTimelineEvent[];
  occurrences: readonly ProjectedAgentTimelineOccurrence[];
  /** Coverage ranges are canonical source-time ranges. */
  coverageTimeDomain: 'source';
  coverage: readonly AgentTimelineCoverageSummary[];
  missingChannels: readonly AgentTimelineChannel[];
  nextCursor?: string;
  truncation: AgentTimelineTruncation;
}

export interface PlannedShardRead {
  shard: ArtifactShardDescriptor;
  sourceRanges: readonly SourceTimeRange[];
  eventTypes: readonly AgentTimelineEvent['type'][];
  channel: AgentTimelineChannel;
}
