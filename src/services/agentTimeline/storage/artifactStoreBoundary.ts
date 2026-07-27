import type {
  AgentTimelineArtifactPutOptions,
  AgentTimelineManifestPointerStore,
  AgentTimelineStoredArtifactManifest,
} from '../../../types/agentTimeline/storage';

/** Runtime artifact-store bridge; binary handles remain outside durable DTO tiers. */
export interface AgentTimelineArtifactStore {
  putArtifact(
    input: ArrayBuffer,
    options: AgentTimelineArtifactPutOptions,
  ): Promise<{ manifest: AgentTimelineStoredArtifactManifest }>;
  getArtifact(ref: string): Promise<{
    manifest: AgentTimelineStoredArtifactManifest;
    blob: Blob;
  } | null>;
}

export interface AgentTimelineArtifactStorageDependencies {
  artifacts: AgentTimelineArtifactStore;
  pointers: AgentTimelineManifestPointerStore;
  now?: () => string;
  maxReadBytes?: number;
}
