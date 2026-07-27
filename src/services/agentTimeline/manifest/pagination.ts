import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
  type AgentTimelineTruncation,
} from '../../../types/agentTimeline/manifest';
import { compareAgentTimelineEvents, eventStart } from './eventSemantics';

export const AGENT_TIMELINE_MAX_PAGE_EVENTS = 500;
export const AGENT_TIMELINE_MAX_PAGE_BYTES = 256 * 1024;

interface CursorPayload {
  version: 1;
  queryKey: string;
  after: [number, 0 | 1, string, string];
}

export interface AgentTimelinePaginationRequest {
  queryKey: string;
  limit?: number;
  cursor?: string;
  maxBytes?: number;
}

export interface AgentTimelineEventPage {
  schemaVersion: typeof AGENT_TIMELINE_EVENT_SCHEMA_VERSION;
  events: AgentTimelineEvent[];
  nextCursor?: string;
  truncation: AgentTimelineTruncation;
}

function eventSortKey(event: AgentTimelineEvent): CursorPayload['after'] {
  return [eventStart(event), event.time.temporalKind === 'point' ? 0 : 1, event.type, event.id];
}

function compareKey(left: CursorPayload['after'], right: CursorPayload['after']): number {
  return left[0] - right[0]
    || left[1] - right[1]
    || left[2].localeCompare(right[2])
    || left[3].localeCompare(right[3]);
}

export function encodeAgentTimelineCursor(queryKey: string, event: AgentTimelineEvent): string {
  const payload: CursorPayload = { version: 1, queryKey, after: eventSortKey(event) };
  return `v1:${encodeURIComponent(JSON.stringify(payload))}`;
}

export function decodeAgentTimelineCursor(cursor: string, queryKey: string): CursorPayload {
  if (!cursor.startsWith('v1:')) throw new TypeError('Unsupported Agent Timeline cursor version');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(cursor.slice(3)));
  } catch {
    throw new TypeError('Malformed Agent Timeline cursor');
  }
  if (!parsed || typeof parsed !== 'object') throw new TypeError('Malformed Agent Timeline cursor');
  const candidate = parsed as Partial<CursorPayload>;
  if (candidate.version !== 1 || candidate.queryKey !== queryKey || !Array.isArray(candidate.after) || candidate.after.length !== 4) {
    throw new TypeError('Agent Timeline cursor does not match this query');
  }
  const [start, temporalKind, type, id] = candidate.after;
  if (!Number.isFinite(start) || (temporalKind !== 0 && temporalKind !== 1) || typeof type !== 'string' || typeof id !== 'string') {
    throw new TypeError('Malformed Agent Timeline cursor sort key');
  }
  return candidate as CursorPayload;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function paginateAgentTimelineEvents(
  inputEvents: AgentTimelineEvent[],
  request: AgentTimelinePaginationRequest,
): AgentTimelineEventPage {
  if (!request.queryKey) throw new TypeError('queryKey is required');
  const limit = Math.min(AGENT_TIMELINE_MAX_PAGE_EVENTS, Math.max(1, Math.trunc(request.limit ?? 200)));
  const maxBytes = Math.min(AGENT_TIMELINE_MAX_PAGE_BYTES, Math.max(1, Math.trunc(request.maxBytes ?? AGENT_TIMELINE_MAX_PAGE_BYTES)));
  const after = request.cursor ? decodeAgentTimelineCursor(request.cursor, request.queryKey).after : undefined;
  const candidates = inputEvents
    .toSorted(compareAgentTimelineEvents)
    .filter((event) => !after || compareKey(eventSortKey(event), after) > 0);
  const events: AgentTimelineEvent[] = [];
  let estimatedBytes = 2;
  let reason: AgentTimelineTruncation['reason'];
  for (const event of candidates) {
    if (events.length >= limit) {
      reason = 'event-limit';
      break;
    }
    const eventBytes = jsonBytes(event) + (events.length > 0 ? 1 : 0);
    if (estimatedBytes + eventBytes > maxBytes) {
      if (events.length === 0) throw new RangeError(`Agent Timeline event ${event.id} exceeds the page byte budget`);
      reason = 'byte-limit';
      break;
    }
    events.push(event);
    estimatedBytes += eventBytes;
  }
  const truncated = events.length < candidates.length;
  const lastEvent = events.at(-1);
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    events,
    nextCursor: truncated && lastEvent ? encodeAgentTimelineCursor(request.queryKey, lastEvent) : undefined,
    truncation: {
      truncated,
      reason: truncated ? reason ?? 'event-limit' : undefined,
      returnedEvents: events.length,
      estimatedBytes,
    },
  };
}
