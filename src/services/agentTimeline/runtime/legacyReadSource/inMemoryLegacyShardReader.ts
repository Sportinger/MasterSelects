import type { ArtifactShardDescriptor } from '../../../../types/agentTimeline/artifactShard';
import type { AgentTimelineEvent } from '../../../../types/agentTimeline/manifest';
import type {
  AgentTimelineShardReader,
  AgentTimelineShardReadRequest,
} from '../../../../types/agentTimeline/query';
import { eventMatchesHalfOpenRange } from '../../manifest/eventSemantics';

function eventStart(event: AgentTimelineEvent): number {
  return event.time.temporalKind === 'point' ? event.time.time : event.time.start;
}

function compareEvents(left: AgentTimelineEvent, right: AgentTimelineEvent): number {
  return eventStart(left) - eventStart(right)
    || left.type.localeCompare(right.type)
    || left.id.localeCompare(right.id);
}

function cloneEvent(event: AgentTimelineEvent): AgentTimelineEvent {
  return JSON.parse(JSON.stringify(event)) as AgentTimelineEvent;
}

export interface InMemoryLegacyShardPayload {
  descriptor: ArtifactShardDescriptor;
  events: readonly AgentTimelineEvent[];
}

/**
 * Range-aware event-only reader. Legacy records, decoded frames and artifact
 * payloads are deliberately not retained by this boundary.
 */
export class InMemoryLegacyShardReader implements AgentTimelineShardReader {
  private readonly eventsByShard: ReadonlyMap<string, readonly AgentTimelineEvent[]>;

  constructor(payloads: readonly InMemoryLegacyShardPayload[]) {
    this.eventsByShard = new Map(payloads.map((payload) => [
      payload.descriptor.shardId,
      payload.events.map(cloneEvent).toSorted(compareEvents),
    ]));
  }

  async readEvents(request: AgentTimelineShardReadRequest): Promise<readonly AgentTimelineEvent[]> {
    const events = this.eventsByShard.get(request.shard.shardId) ?? [];
    const eventTypes = new Set(request.eventTypes);
    const ranges = request.sourceRanges.filter((range) => (
      Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.start < range.end
    ));
    return events
      .filter((event) => event.time.timeDomain === 'source')
      .filter((event) => eventTypes.has(event.type))
      .filter((event) => ranges.some((range) => eventMatchesHalfOpenRange(event, range)))
      .map(cloneEvent);
  }
}
