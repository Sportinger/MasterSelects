import {
  AGENT_TIMELINE_API_DEFAULT_PAGE_EVENTS,
  AGENT_TIMELINE_API_MAX_PAGE_BYTES,
  AGENT_TIMELINE_API_MAX_PAGE_EVENTS,
  AGENT_TIMELINE_API_SCHEMA_VERSION,
  type AgentTimelineApiErrorCode,
  type AgentTimelineReadOnlyApi,
  type AgentTimelineReadSourceResolver,
  type AgentTimelineSelectedRangeFailure,
  type AgentTimelineSelectedRangeRequest,
  type AgentTimelineSelectedRangeResult,
  type ResolvedAgentTimelineReadSource,
} from '../../../types/agentTimeline/api';
import type { AgentTimelineChannel } from '../../../types/agentTimeline/manifest';
import type { AgentTimelineRangeQuery } from '../../../types/agentTimeline/query';
import { getAgentTimelineRange } from '../query/agentTimelineRangeQuery';

const FORBIDDEN_FRAME_FIELDS = ['includeFrames', 'screenshots', 'frames', 'framePayloads'] as const;

interface NormalizedRequest {
  query: AgentTimelineRangeQuery;
  maxBytes: number;
  limit: number;
}

function failure(
  code: AgentTimelineApiErrorCode,
  message: string,
  retryable = false,
): AgentTimelineSelectedRangeFailure {
  return {
    ok: false,
    schemaVersion: AGENT_TIMELINE_API_SCHEMA_VERSION,
    error: { code, message, retryable },
  };
}

function hasForbiddenFrameField(request: AgentTimelineSelectedRangeRequest): boolean {
  const candidate: object = request;
  return FORBIDDEN_FRAME_FIELDS.some((field) => field in candidate);
}

function normalizedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new TypeError('Page bounds must be finite numbers');
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

function normalizedChannels(
  channels: readonly AgentTimelineChannel[],
): readonly AgentTimelineChannel[] {
  if (channels.length === 0) throw new TypeError('At least one Agent Timeline channel is required');
  return [...new Set(channels)].toSorted();
}

function normalizeRequest(request: AgentTimelineSelectedRangeRequest): NormalizedRequest {
  if (hasForbiddenFrameField(request)) {
    throw new TypeError('Frame and screenshot payloads are not part of the Agent Timeline read API');
  }
  if (!request.scope || typeof request.scope !== 'object') throw new TypeError('A query scope is required');
  if (!Number.isFinite(request.start) || !Number.isFinite(request.end)
    || request.start < 0 || request.end <= request.start) {
    throw new RangeError('A finite, non-negative, non-empty half-open range is required');
  }
  if (request.timeDomain !== 'source'
    && request.timeDomain !== 'clip-local'
    && request.timeDomain !== 'composition') {
    throw new TypeError('timeDomain must be source, clip-local, or composition');
  }
  const limit = normalizedInteger(
    request.page?.limit,
    AGENT_TIMELINE_API_DEFAULT_PAGE_EVENTS,
    AGENT_TIMELINE_API_MAX_PAGE_EVENTS,
  );
  const maxBytes = normalizedInteger(
    request.page?.maxBytes,
    AGENT_TIMELINE_API_MAX_PAGE_BYTES,
    AGENT_TIMELINE_API_MAX_PAGE_BYTES,
  );
  return {
    limit,
    maxBytes,
    query: {
      scope: { ...request.scope },
      start: request.start,
      end: request.end,
      timeDomain: request.timeDomain,
      granularity: request.granularity ?? 'event',
      channels: normalizedChannels(request.channels),
      includeFrames: false,
      limit,
      cursor: request.page?.cursor,
    },
  };
}

function sourceSummary(source: ResolvedAgentTimelineReadSource) {
  return {
    mediaFileId: source.manifest.mediaFileId,
    sourceIdentityHash: source.manifest.sourceIdentity.hash,
    manifestGeneratedAt: source.manifest.generatedAt,
    profile: source.manifest.profile,
    occurrenceStateHash: source.occurrenceMapping?.stateHash,
  };
}

function classifyReadError(error: unknown): AgentTimelineSelectedRangeFailure {
  const message = error instanceof Error ? error.message : 'Agent Timeline read failed';
  if (message.toLowerCase().includes('cursor')) return failure('cursor-invalid', message);
  if (error instanceof RangeError && message.toLowerCase().includes('byte')) {
    return failure('page-too-large', message);
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return failure('invalid-request', message);
  }
  return failure('read-failed', message, true);
}

export function createAgentTimelineReadApi(
  resolver: AgentTimelineReadSourceResolver,
): AgentTimelineReadOnlyApi {
  return Object.freeze({
    async getSelectedRange(
      request: AgentTimelineSelectedRangeRequest,
    ): Promise<AgentTimelineSelectedRangeResult> {
      let normalized: NormalizedRequest;
      try {
        normalized = normalizeRequest(request);
      } catch (error) {
        return classifyReadError(error);
      }

      let source: ResolvedAgentTimelineReadSource | null | undefined;
      try {
        source = await resolver.resolve(normalized.query.scope);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Agent Timeline scope resolution failed';
        return failure('read-failed', message, true);
      }
      if (!source) {
        return failure('scope-not-found', 'No Agent Timeline source matches the requested scope');
      }

      try {
        const page = await getAgentTimelineRange({
          query: normalized.query,
          manifest: source.manifest,
          shardIndex: source.shardIndex,
          shardReader: source.shardReader,
          occurrenceMapping: source.occurrenceMapping,
          mappingSourceId: source.mappingSourceId,
          maxResponseBytes: normalized.maxBytes,
        });
        return {
          ok: true,
          schemaVersion: AGENT_TIMELINE_API_SCHEMA_VERSION,
          source: sourceSummary(source),
          bounds: {
            limit: normalized.limit,
            maxBytes: normalized.maxBytes,
          },
          page,
        };
      } catch (error) {
        return classifyReadError(error);
      }
    },
  });
}

