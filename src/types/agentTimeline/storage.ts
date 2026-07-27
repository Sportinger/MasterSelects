import type { ArtifactShardDescriptor, ArtifactShardDescriptorInput, ArtifactShardIntervalIndex } from './artifactShard';
import type { AgentTimelineEvent, AgentTimelineManifest } from './manifest';
import type { SourceIdentity } from './sourceIdentity';

export const AGENT_TIMELINE_STORAGE_SCHEMA_VERSION = 'agent-timeline-storage/v1' as const;
export const AGENT_TIMELINE_EVENT_SHARD_SCHEMA_VERSION = 'agent-timeline-event-shard/v1' as const;
export const AGENT_TIMELINE_MANIFEST_POINTER_SCHEMA_VERSION = 'agent-timeline-manifest-pointer/v1' as const;

/** JSON stored in an immutable, content-addressed artifact. */
export interface AgentTimelineEventShardDocument {
  type: 'agent-timeline-event-shard';
  schemaVersion: typeof AGENT_TIMELINE_EVENT_SHARD_SCHEMA_VERSION;
  sourceIdentityHash: string;
  mediaFileId: string;
  events: readonly AgentTimelineEvent[];
}

/** Published last; this is the single mutable entry point for a source. */
export interface AgentTimelineManifestPointer {
  type: 'agent-timeline-manifest-pointer';
  schemaVersion: typeof AGENT_TIMELINE_MANIFEST_POINTER_SCHEMA_VERSION;
  mediaFileId: string;
  sourceIdentityHash: string;
  manifestRef: string;
  shardIndexRef: string;
  publishedAt: string;
}

export interface AgentTimelineShardWrite {
  /** The persistent ref and byte length are assigned by the storage boundary. */
  descriptor: Omit<ArtifactShardDescriptorInput, 'artifactRef' | 'sizeBytes'>;
  /**
   * Declares a channel's payload type when a bounded coverage shard has no
   * events. Empty shards are deliberate coverage markers, not unknown data.
   */
  eventTypes?: readonly AgentTimelineEvent['type'][];
  events: readonly AgentTimelineEvent[];
}

export interface AgentTimelineStorageWrite {
  manifest: AgentTimelineManifest;
  shards: readonly AgentTimelineShardWrite[];
  /** A previously validated index when publishing an incremental analysis pass. */
  existingShardIndex?: ArtifactShardIntervalIndex;
}

export interface AgentTimelineArtifactPutOptions {
  mimeType: 'application/json';
  encoding: 'json';
  sourceRefs: readonly string[];
}

export interface AgentTimelineStoredArtifactManifest {
  artifactId: string;
  hash: string;
  size: number;
  sourceRefs: readonly string[];
}

/** Mutable, atomic-at-key boundary supplied by the project filesystem or IndexedDB layer. */
export interface AgentTimelineManifestPointerStore {
  get(pointerKey: string): Promise<AgentTimelineManifestPointer | null>;
  set(pointerKey: string, pointer: AgentTimelineManifestPointer): Promise<void>;
}

export interface AgentTimelineStoredAnalysis {
  pointer: AgentTimelineManifestPointer;
  manifest: AgentTimelineManifest;
  shardIndex: ArtifactShardIntervalIndex;
}

export type AgentTimelineArtifactLoadResult =
  | { status: 'ready'; analysis: AgentTimelineStoredAnalysis }
  | { status: 'missing'; reason: string }
  | { status: 'stale'; reason: string }
  | { status: 'corrupt'; reason: string };

export interface AgentTimelineStorageReadRequest {
  mediaFileId: string;
  sourceIdentity: SourceIdentity;
  signal?: AbortSignal;
}

export interface AgentTimelineStorageWriteResult {
  pointer: AgentTimelineManifestPointer;
  manifest: AgentTimelineManifest;
  shardIndex: ArtifactShardIntervalIndex;
  shards: readonly ArtifactShardDescriptor[];
}
