import type { ArtifactShardIntervalIndex } from './artifactShard';
import type {
  AgentTimelineChannel,
  AgentTimelineProfile,
  AgentTimelineQueryScope,
  AgentTimelineQueryTimeDomain,
} from './manifest';
import type { OccurrenceMappingIndex } from './occurrenceMapping';
import type {
  AgentTimelineGranularity,
  AgentTimelineRangeQueryResponse,
  AgentTimelineShardReader,
} from './query';
import type { AgentTimelineManifest } from './manifest';

export const AGENT_TIMELINE_API_SCHEMA_VERSION = 'agent-timeline-read-api/v1' as const;
export const AGENT_TIMELINE_API_MAX_PAGE_EVENTS = 500 as const;
export const AGENT_TIMELINE_API_DEFAULT_PAGE_EVENTS = 200 as const;
export const AGENT_TIMELINE_API_MAX_PAGE_BYTES = 256 * 1024;

export interface AgentTimelineApiPageRequest {
  /** Defaults to 200 and is clamped to 1..500. */
  limit?: number;
  /** Opaque cursor returned by an earlier request with exactly the same selection. */
  cursor?: string;
  /** Applies to the serialized `page` payload; clamped to at most 256 KiB. */
  maxBytes?: number;
}

/** Read-only selected-range request. Frame or screenshot payloads are intentionally absent. */
export interface AgentTimelineSelectedRangeRequest {
  scope: AgentTimelineQueryScope;
  start: number;
  end: number;
  timeDomain: AgentTimelineQueryTimeDomain;
  granularity?: AgentTimelineGranularity;
  channels: readonly AgentTimelineChannel[];
  page?: AgentTimelineApiPageRequest;
}

export interface ResolvedAgentTimelineReadSource {
  manifest: AgentTimelineManifest;
  shardIndex: ArtifactShardIntervalIndex;
  shardReader: AgentTimelineShardReader;
  occurrenceMapping?: OccurrenceMappingIndex;
  /** Defaults to manifest.mediaFileId. */
  mappingSourceId?: string;
}

export interface AgentTimelineReadSourceResolver {
  resolve(
    scope: Readonly<AgentTimelineQueryScope>,
  ): Promise<ResolvedAgentTimelineReadSource | null | undefined>;
}

export interface AgentTimelineApiSourceSummary {
  mediaFileId: string;
  sourceIdentityHash: string;
  manifestGeneratedAt: string;
  profile: AgentTimelineProfile;
  occurrenceStateHash?: string;
}

export interface AgentTimelineApiAppliedPageBounds {
  limit: number;
  maxBytes: number;
}

export interface AgentTimelineSelectedRangeSuccess {
  ok: true;
  schemaVersion: typeof AGENT_TIMELINE_API_SCHEMA_VERSION;
  source: AgentTimelineApiSourceSummary;
  bounds: AgentTimelineApiAppliedPageBounds;
  /** Existing bounded range-query page; its serialized size is constrained by `bounds.maxBytes`. */
  page: AgentTimelineRangeQueryResponse;
}

export type AgentTimelineApiErrorCode =
  | 'invalid-request'
  | 'scope-not-found'
  | 'cursor-invalid'
  | 'page-too-large'
  | 'read-failed';

export interface AgentTimelineSelectedRangeFailure {
  ok: false;
  schemaVersion: typeof AGENT_TIMELINE_API_SCHEMA_VERSION;
  error: {
    code: AgentTimelineApiErrorCode;
    message: string;
    retryable: boolean;
  };
}

export type AgentTimelineSelectedRangeResult =
  | AgentTimelineSelectedRangeSuccess
  | AgentTimelineSelectedRangeFailure;

export interface AgentTimelineReadOnlyApi {
  getSelectedRange(
    request: AgentTimelineSelectedRangeRequest,
  ): Promise<AgentTimelineSelectedRangeResult>;
}

