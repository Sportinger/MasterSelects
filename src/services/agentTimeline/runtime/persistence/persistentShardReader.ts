import type { ArtifactShardDescriptor } from '../../../../types/agentTimeline/artifactShard';
import type { AgentTimelineEvent } from '../../../../types/agentTimeline/manifest';
import type {
  AgentTimelineShardReader,
  AgentTimelineShardReadRequest,
} from '../../../../types/agentTimeline/query';
import type {
  AgentTimelineEventShardDocument,
} from '../../../../types/agentTimeline/storage';
import type { AgentTimelineArtifactStore } from '../../storage/artifactStoreBoundary';
import { eventMatchesHalfOpenRange } from '../../manifest/eventSemantics';
import { validateAgentTimelineEvent } from '../../manifest/validation';
import { DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES, readBoundedJson } from '../../storage/storageJson';

const CHANNEL_EVENT_TYPES: Record<ArtifactShardDescriptor['channel'], readonly AgentTimelineEvent['type'][]> = {
  cuts: ['cut'], shots: ['shot'], 'scene-blocks': ['scene-block'], focus: ['quality-issue'],
  motion: ['camera-motion'], faces: ['person-visible'], transcript: ['speech', 'speech-marker'],
  audio: ['audio-activity'], 'active-speaker': ['active-speaker'],
  'camera-motion': ['camera-motion'], quality: ['quality-issue'], ocr: ['onscreen-text'],
  redundancy: ['duplicate-group'],
};

function eventStart(event: AgentTimelineEvent): number {
  return event.time.temporalKind === 'point' ? event.time.time : event.time.start;
}

function cloneEvent(event: AgentTimelineEvent): AgentTimelineEvent {
  return JSON.parse(JSON.stringify(event)) as AgentTimelineEvent;
}

function isMatchingDocument(
  document: AgentTimelineEventShardDocument,
  shard: ArtifactShardDescriptor,
): boolean {
  return document.type === 'agent-timeline-event-shard'
    && document.schemaVersion === 'agent-timeline-event-shard/v1'
    && document.mediaFileId.length > 0
    && document.sourceIdentityHash === shard.sourceIdentityHash
    && Array.isArray(document.events)
    && document.events.every((event) => {
      if (validateAgentTimelineEvent(event).length > 0
        || event.time.timeDomain !== shard.timeDomain
        || !CHANNEL_EVENT_TYPES[shard.channel].includes(event.type)) return false;
      return event.time.temporalKind === 'point'
        ? event.time.time >= shard.sourceRange.start && event.time.time < shard.sourceRange.end
        : event.time.start >= shard.sourceRange.start && event.time.end <= shard.sourceRange.end;
    });
}

/** Reads only the selected immutable event shard; it never retains media runtime handles. */
export class PersistentAgentTimelineShardReader implements AgentTimelineShardReader {
  private readonly artifacts: AgentTimelineArtifactStore;
  private readonly maxReadBytes: number;

  constructor(
    artifacts: AgentTimelineArtifactStore,
    maxReadBytes = DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES,
  ) {
    this.artifacts = artifacts;
    this.maxReadBytes = maxReadBytes;
  }

  async readEvents(request: AgentTimelineShardReadRequest): Promise<readonly AgentTimelineEvent[]> {
    const document = await readBoundedJson<AgentTimelineEventShardDocument>(
      this.artifacts,
      request.shard.artifactRef,
      this.maxReadBytes,
    );
    if (!isMatchingDocument(document, request.shard)) {
      throw new TypeError(`Persistent Agent Timeline shard is invalid: ${request.shard.shardId}`);
    }
    const eventTypes = new Set(request.eventTypes);
    return document.events
      .filter(event => event.time.timeDomain === 'source')
      .filter(event => eventTypes.has(event.type))
      .filter(event => request.sourceRanges.some(range => eventMatchesHalfOpenRange(event, range)))
      .map(cloneEvent)
      .toSorted((left, right) => eventStart(left) - eventStart(right)
        || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
  }
}
