import type { OccurrenceMappingIndex } from '../../../../types/agentTimeline/occurrenceMapping';
import type { SourceIdentity } from '../../../../types/agentTimeline/sourceIdentity';
import type { ResolvedAgentTimelineReadSource } from '../../../../types/agentTimeline/api';
import { createProjectAgentTimelineArtifactStore, createProjectAgentTimelineStorage } from '../../storage/projectAgentTimelineStorage';
import { PersistentAgentTimelineShardReader } from './persistentShardReader';

export interface PersistedOrLegacyReadSourceInput {
  mediaFileId: string;
  sourceIdentity: SourceIdentity;
  fallback: ResolvedAgentTimelineReadSource;
  occurrenceMapping?: OccurrenceMappingIndex;
  mappingSourceId?: string;
}

/**
 * Persistence is an optional read-through cache. Missing, stale, or corrupt
 * data deliberately falls back to the caller's live legacy materialization;
 * resolving a source never schedules or performs a write.
 */
export async function resolvePersistedOrLegacyAgentTimelineReadSource(
  input: PersistedOrLegacyReadSourceInput,
): Promise<ResolvedAgentTimelineReadSource> {
  try {
    const storage = createProjectAgentTimelineStorage();
    const loaded = await storage.read({
      mediaFileId: input.mediaFileId,
      sourceIdentity: input.sourceIdentity,
    });
    if (loaded.status !== 'ready') return input.fallback;
    return {
      manifest: loaded.analysis.manifest,
      shardIndex: loaded.analysis.shardIndex,
      shardReader: new PersistentAgentTimelineShardReader(createProjectAgentTimelineArtifactStore()),
      occurrenceMapping: input.occurrenceMapping,
      mappingSourceId: input.mappingSourceId ?? input.mediaFileId,
    };
  } catch {
    return input.fallback;
  }
}
