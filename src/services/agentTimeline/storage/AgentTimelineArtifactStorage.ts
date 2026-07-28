import { createArtifactShardDescriptor } from '../artifacts/artifactShardDescriptor';
import { createArtifactShardIntervalIndex } from '../artifacts/artifactShardIndex';
import { isEventTypeAllowedForChannel, validateAgentTimelineEvent, validateAgentTimelineManifest } from '../manifest/validation';
import type { ArtifactShardDescriptor, ArtifactShardIntervalIndex } from '../../../types/agentTimeline/artifactShard';
import type { AgentTimelineArtifactRef, AgentTimelineChannel, AgentTimelineEvent, AgentTimelineManifest } from '../../../types/agentTimeline/manifest';
import {
  AGENT_TIMELINE_EVENT_SHARD_SCHEMA_VERSION,
  AGENT_TIMELINE_MANIFEST_POINTER_SCHEMA_VERSION,
  type AgentTimelineArtifactLoadResult,
  type AgentTimelineEventShardDocument,
  type AgentTimelineManifestPointer,
  type AgentTimelineShardWrite,
  type AgentTimelineStorageReadRequest,
  type AgentTimelineStorageWrite,
  type AgentTimelineStorageWriteResult,
} from '../../../types/agentTimeline/storage';
import type { AgentTimelineArtifactStorageDependencies } from './artifactStoreBoundary';
import { assertNotAborted, DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES, isRecord, jsonBytes, readBoundedJson } from './storageJson';

const JSON_OPTIONS = (sourceRefs: readonly string[]) => ({
  mimeType: 'application/json' as const,
  encoding: 'json' as const,
  sourceRefs,
});
const EMPTY_MEDIA_TYPE_FALLBACK = 'application/octet-stream';

function sourceRefs(mediaFileId: string, sourceIdentityHash: string): readonly string[] {
  return [mediaFileId, `agent-timeline-source:${sourceIdentityHash}`];
}

function pointerKey(mediaFileId: string): string {
  return `agent-timeline/manifest/${encodeURIComponent(mediaFileId)}`;
}

function channelForShard(channel: ArtifactShardDescriptor['channel']): AgentTimelineChannel {
  const channels: Record<ArtifactShardDescriptor['channel'], AgentTimelineChannel> = {
    cuts: 'cuts', shots: 'shots', 'scene-blocks': 'scenes', focus: 'quality', motion: 'camera-motion',
    faces: 'people', transcript: 'speech', audio: 'audio', 'active-speaker': 'active-speaker',
    'camera-motion': 'camera-motion', quality: 'quality', ocr: 'text', redundancy: 'duplicates',
  };
  return channels[channel];
}

function eventTypesForShard(channel: ArtifactShardDescriptor['channel']): AgentTimelineArtifactRef['eventTypes'] {
  const types: Record<ArtifactShardDescriptor['channel'], AgentTimelineArtifactRef['eventTypes']> = {
    cuts: ['cut'], shots: ['shot'], 'scene-blocks': ['scene-block'], focus: ['quality-issue'],
    motion: ['camera-motion'], faces: ['person-visible'], transcript: ['speech'],
    audio: ['audio-activity'], 'active-speaker': ['active-speaker'],
    'camera-motion': ['camera-motion'], quality: ['quality-issue'], ocr: ['onscreen-text'],
    redundancy: ['duplicate-group'],
  };
  return types[channel];
}

function normalizeManifestSourceIdentity(manifest: AgentTimelineManifest): AgentTimelineManifest {
  if (manifest.sourceIdentity.metadata.mediaType.length > 0) return manifest;
  return {
    ...manifest,
    sourceIdentity: {
      ...manifest.sourceIdentity,
      metadata: { ...manifest.sourceIdentity.metadata, mediaType: EMPTY_MEDIA_TYPE_FALLBACK },
    },
  };
}

function canonicalTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isPointer(value: unknown): value is AgentTimelineManifestPointer {
  return isRecord(value)
    && value.type === 'agent-timeline-manifest-pointer'
    && value.schemaVersion === AGENT_TIMELINE_MANIFEST_POINTER_SCHEMA_VERSION
    && ['mediaFileId', 'sourceIdentityHash', 'manifestRef', 'shardIndexRef', 'publishedAt']
      .every((key) => typeof value[key] === 'string' && value[key].length > 0)
    && canonicalTimestamp(value.publishedAt as string);
}

function isIndex(value: unknown): value is ArtifactShardIntervalIndex {
  if (!isRecord(value) || value.type !== 'agent-timeline-artifact-shard-index' || !Array.isArray(value.entries)) return false;
  try {
    const rebuilt = createArtifactShardIntervalIndex(value.entries.map((entry) => entry.shard));
    return JSON.stringify(rebuilt) === JSON.stringify(value);
  } catch {
    return false;
  }
}

function isSourceIdentity(value: AgentTimelineManifest['sourceIdentity']): boolean {
  return value.type === 'source-identity'
    && value.version === 'agent-timeline-source-identity/v1'
    && value.hashAlgorithm === 'sha-256'
    && /^[a-f0-9]{64}$/i.test(value.hash)
    && (value.strategy === 'sampled-chunks' || value.strategy === 'full-stream')
    && Number.isSafeInteger(value.metadata.size)
    && value.metadata.size >= 0
    && value.metadata.mediaType.length > 0;
}

function artifactRefFrom(shard: ArtifactShardDescriptor, eventTypes: AgentTimelineArtifactRef['eventTypes']): AgentTimelineArtifactRef {
  return {
    artifactRef: shard.artifactRef,
    shardId: shard.shardId,
    schemaVersion: shard.artifactSchemaVersion,
    analyzerId: shard.analyzerId,
    analyzerVersion: shard.analyzerVersion,
    ...(shard.modelId ? { modelId: shard.modelId, modelVersion: shard.modelVersion } : {}),
    profile: shard.profile,
    timeDomain: shard.timeDomain,
    ...(shard.stateHash ? { stateHash: shard.stateHash } : {}),
    eventTypes: [...new Set(eventTypes)].toSorted(),
    coverage: [{ ...shard.sourceRange }],
    byteLength: shard.sizeBytes,
  };
}

function rangesCoverDuration(manifest: AgentTimelineManifest, refs: readonly AgentTimelineArtifactRef[]): boolean {
  const sorted = refs.flatMap((ref) => ref.coverage).toSorted((left, right) => left.start - right.start);
  let end = 0;
  for (const range of sorted) {
    if (range.start > end) return false;
    end = Math.max(end, range.end);
  }
  return end >= manifest.durationSeconds;
}

function mergeManifest(manifest: AgentTimelineManifest, shards: readonly ArtifactShardDescriptor[], eventTypes: readonly AgentTimelineArtifactRef['eventTypes'][]): AgentTimelineManifest {
  const channels = { ...manifest.channels };
  for (let index = 0; index < shards.length; index += 1) {
    const channel = channelForShard(shards[index].channel);
    const current = channels[channel];
    const next = artifactRefFrom(shards[index], eventTypes[index]);
    const byId = new Map(current.artifacts.map((artifact) => [artifact.shardId, artifact]));
    byId.set(next.shardId, next);
    const artifacts = [...byId.values()];
    channels[channel] = {
      status: rangesCoverDuration(manifest, artifacts) ? 'complete' : 'partial',
      artifacts,
    };
  }
  return { ...manifest, channels };
}

function assertManifestIdentity(manifest: AgentTimelineManifest): void {
  const errors = validateAgentTimelineManifest(manifest);
  if (errors.length > 0) throw new TypeError(`Invalid Agent Timeline manifest: ${errors.join('; ')}`);
  if (!isSourceIdentity(manifest.sourceIdentity)) throw new TypeError('Invalid Agent Timeline source identity.');
}

export class AgentTimelineArtifactStorage {
  private readonly dependencies: Required<Pick<AgentTimelineArtifactStorageDependencies, 'artifacts' | 'pointers' | 'now'>>
    & Pick<AgentTimelineArtifactStorageDependencies, 'maxReadBytes'>;

  constructor(dependencies: AgentTimelineArtifactStorageDependencies) {
    this.dependencies = {
      ...dependencies,
      now: dependencies.now ?? (() => new Date().toISOString()),
    };
  }

  async write(input: AgentTimelineStorageWrite, signal?: AbortSignal): Promise<AgentTimelineStorageWriteResult> {
    assertNotAborted(signal);
    const inputManifest = normalizeManifestSourceIdentity(input.manifest);
    assertManifestIdentity(inputManifest);
    const { mediaFileId, sourceIdentity } = inputManifest;
    const refs = sourceRefs(mediaFileId, sourceIdentity.hash);
    const shards: ArtifactShardDescriptor[] = [];
    const eventTypes: AgentTimelineArtifactRef['eventTypes'][] = [];

    for (const write of input.shards) {
      assertNotAborted(signal);
      const writeEventTypes = this.eventTypesForWrite(write);
      this.validateShardWrite(write, sourceIdentity.hash, inputManifest.durationSeconds, writeEventTypes);
      const document: AgentTimelineEventShardDocument = {
        type: 'agent-timeline-event-shard', schemaVersion: AGENT_TIMELINE_EVENT_SHARD_SCHEMA_VERSION,
        mediaFileId, sourceIdentityHash: sourceIdentity.hash, events: write.events,
      };
      const bytes = jsonBytes(document);
      const result = await this.dependencies.artifacts.putArtifact(bytes, JSON_OPTIONS(refs));
      assertNotAborted(signal);
      const { stateHash, ...descriptorFields } = write.descriptor;
      const descriptor = write.descriptor.timeDomain === 'source'
        ? createArtifactShardDescriptor({
          ...descriptorFields,
          timeDomain: 'source',
          artifactRef: result.manifest.artifactId,
          sizeBytes: bytes.byteLength,
        })
        : createArtifactShardDescriptor({
          ...descriptorFields,
          timeDomain: write.descriptor.timeDomain,
          stateHash: stateHash ?? (() => { throw new TypeError('Rendered shard descriptors require a stateHash.'); })(),
          artifactRef: result.manifest.artifactId,
          sizeBytes: bytes.byteLength,
        });
      shards.push(descriptor);
      eventTypes.push(writeEventTypes);
    }

    if (input.existingShardIndex && !isIndex(input.existingShardIndex)) {
      throw new TypeError('An incremental publish requires a valid shard interval index.');
    }
    const existingShards = input.existingShardIndex?.entries.map((entry) => entry.shard) ?? [];
    if (existingShards.some((shard) => shard.sourceIdentityHash !== sourceIdentity.hash)) {
      throw new TypeError('Existing shard source identities must match the manifest source identity.');
    }
    const knownShardIds = new Set([...existingShards, ...shards].map((shard) => shard.shardId));
    const missingIndexedRef = Object.values(inputManifest.channels)
      .flatMap((channel) => channel.artifacts)
      .find((artifact) => !knownShardIds.has(artifact.shardId));
    if (missingIndexedRef) {
      throw new TypeError(`Manifest artifact ${missingIndexedRef.shardId} is absent from the published shard index.`);
    }
    const manifest = mergeManifest(inputManifest, shards, eventTypes);
    assertManifestIdentity(manifest);
    const referencedShardIds = new Set(Object.values(manifest.channels)
      .flatMap((channel) => channel.artifacts)
      .map((artifact) => artifact.shardId));
    const byId = new Map(existingShards
      .filter((shard) => referencedShardIds.has(shard.shardId))
      .map((shard) => [shard.shardId, shard]));
    for (const shard of shards) byId.set(shard.shardId, shard);
    const shardIndex = createArtifactShardIntervalIndex([...byId.values()]);
    const indexResult = await this.dependencies.artifacts.putArtifact(jsonBytes(shardIndex), JSON_OPTIONS(refs));
    assertNotAborted(signal);
    const manifestResult = await this.dependencies.artifacts.putArtifact(jsonBytes(manifest), JSON_OPTIONS(refs));
    assertNotAborted(signal);
    const pointer: AgentTimelineManifestPointer = {
      type: 'agent-timeline-manifest-pointer',
      schemaVersion: AGENT_TIMELINE_MANIFEST_POINTER_SCHEMA_VERSION,
      mediaFileId,
      sourceIdentityHash: sourceIdentity.hash,
      manifestRef: manifestResult.manifest.artifactId,
      shardIndexRef: indexResult.manifest.artifactId,
      publishedAt: this.dependencies.now(),
    };
    if (!isPointer(pointer)) throw new TypeError('Storage clock did not return a canonical ISO timestamp.');
    // This is intentionally last: readers never observe an incomplete generation.
    await this.dependencies.pointers.set(pointerKey(mediaFileId), pointer);
    return { pointer, manifest, shardIndex, shards };
  }

  async read(request: AgentTimelineStorageReadRequest): Promise<AgentTimelineArtifactLoadResult> {
    try {
      assertNotAborted(request.signal);
      const sourceIdentity = request.sourceIdentity.metadata.mediaType.length > 0
        ? request.sourceIdentity
        : {
          ...request.sourceIdentity,
          metadata: { ...request.sourceIdentity.metadata, mediaType: EMPTY_MEDIA_TYPE_FALLBACK },
        };
      const pointer = await this.dependencies.pointers.get(pointerKey(request.mediaFileId));
      assertNotAborted(request.signal);
      if (!pointer) return { status: 'missing', reason: 'No Agent Timeline manifest has been published for this media.' };
      if (!isPointer(pointer)) return { status: 'corrupt', reason: 'The Agent Timeline manifest pointer is invalid.' };
      if (pointer.mediaFileId !== request.mediaFileId || pointer.sourceIdentityHash !== sourceIdentity.hash) {
        return { status: 'stale', reason: 'The published analysis belongs to different source bytes.' };
      }
      const maximumBytes = this.dependencies.maxReadBytes ?? DEFAULT_AGENT_TIMELINE_MAX_READ_BYTES;
      const manifest = await readBoundedJson<AgentTimelineManifest>(this.dependencies.artifacts, pointer.manifestRef, maximumBytes, request.signal);
      const shardIndex = await readBoundedJson<ArtifactShardIntervalIndex>(this.dependencies.artifacts, pointer.shardIndexRef, maximumBytes, request.signal);
      try {
        assertManifestIdentity(manifest);
      } catch {
        return { status: 'corrupt', reason: 'The stored Agent Timeline manifest is invalid.' };
      }
      if (manifest.mediaFileId !== request.mediaFileId || manifest.sourceIdentity.hash !== sourceIdentity.hash) {
        return { status: 'stale', reason: 'The stored manifest does not match the current source identity.' };
      }
      if (!isIndex(shardIndex)) return { status: 'corrupt', reason: 'The stored shard interval index is invalid.' };
      this.assertManifestIndexConsistency(manifest, shardIndex);
      await this.assertArtifactSourceRefs(pointer.manifestRef, sourceRefs(manifest.mediaFileId, manifest.sourceIdentity.hash), request.signal);
      await this.assertArtifactSourceRefs(pointer.shardIndexRef, sourceRefs(manifest.mediaFileId, manifest.sourceIdentity.hash), request.signal);
      // Event shards intentionally stay unopened here. Query selection is cheap and
      // PersistentAgentTimelineShardReader validates the selected immutable shard.
      return { status: 'ready', analysis: { pointer, manifest, shardIndex } };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return { status: 'corrupt', reason: error instanceof Error ? error.message : 'Unable to read Agent Timeline artifacts.' };
    }
  }

  private eventTypesForWrite(write: AgentTimelineShardWrite): AgentTimelineArtifactRef['eventTypes'] {
    const eventTypes = [...new Set(write.eventTypes ?? write.events.map((event) => event.type))];
    const fallback = eventTypes.length === 0 ? eventTypesForShard(write.descriptor.channel) : eventTypes;
    if (fallback.some((type) => !isEventTypeAllowedForChannel(channelForShard(write.descriptor.channel), type))) {
      throw new TypeError(`Shard event types do not belong to channel ${write.descriptor.channel}.`);
    }
    if (write.events.some((event) => !fallback.includes(event.type))) {
      throw new TypeError('Shard events must be declared by eventTypes.');
    }
    return fallback;
  }

  private validateShardWrite(
    write: AgentTimelineShardWrite,
    sourceIdentityHash: string,
    durationSeconds: number,
    declaredEventTypes: readonly AgentTimelineEvent['type'][],
  ): void {
    if (write.descriptor.sourceIdentityHash !== sourceIdentityHash) {
      throw new TypeError('A shard sourceIdentityHash must match the manifest source identity.');
    }
    if (write.descriptor.sourceRange.end > durationSeconds) {
      throw new RangeError('A shard source range must be contained by the manifest duration.');
    }
    for (const event of write.events) {
      const errors = validateAgentTimelineEvent(event);
      if (errors.length > 0) throw new TypeError(`Invalid Agent Timeline event: ${errors.join('; ')}`);
      const channel = channelForShard(write.descriptor.channel);
      if (!declaredEventTypes.includes(event.type) || !isEventTypeAllowedForChannel(channel, event.type)) {
        throw new TypeError(`Event type ${event.type} does not belong to shard channel ${write.descriptor.channel}.`);
      }
      if (event.time.timeDomain !== write.descriptor.timeDomain || event.time.stateHash !== write.descriptor.stateHash) {
        throw new TypeError('Shard events must use the descriptor time domain and state hash.');
      }
      if (event.time.timeDomain === 'source') {
        const outsideRange = event.time.temporalKind === 'point'
          ? event.time.time < write.descriptor.sourceRange.start || event.time.time >= write.descriptor.sourceRange.end
          : event.time.start < write.descriptor.sourceRange.start || event.time.end > write.descriptor.sourceRange.end;
        if (outsideRange) {
          throw new RangeError('Source-time events must be contained by the shard source range.');
        }
        const outsideDuration = event.time.temporalKind === 'point'
          ? event.time.time >= durationSeconds
          : event.time.end > durationSeconds;
        if (outsideDuration) throw new RangeError('Source-time events must be contained by the manifest duration.');
      }
    }
  }

  private assertManifestIndexConsistency(manifest: AgentTimelineManifest, index: ArtifactShardIntervalIndex): void {
    const refs = new Map<string, { channel: AgentTimelineChannel; ref: AgentTimelineArtifactRef }>();
    for (const [channel, channelManifest] of Object.entries(manifest.channels) as [AgentTimelineChannel, AgentTimelineManifest['channels'][AgentTimelineChannel]][]) {
      for (const ref of channelManifest.artifacts) {
        if (refs.has(ref.shardId)) throw new TypeError(`Manifest contains duplicate shard ID: ${ref.shardId}`);
        refs.set(ref.shardId, { channel, ref });
      }
    }
    if (refs.size !== index.entries.length) throw new TypeError('Manifest and shard index do not contain the same shard set.');
    for (const { shard } of index.entries) {
      if (shard.sourceIdentityHash !== manifest.sourceIdentity.hash) throw new TypeError('Shard source identity does not match manifest.');
      if (shard.sourceRange.start < 0 || shard.sourceRange.end > manifest.durationSeconds) {
        throw new RangeError(`Shard source range exceeds manifest duration: ${shard.shardId}`);
      }
      const published = refs.get(shard.shardId);
      if (!published || published.ref.artifactRef !== shard.artifactRef || published.channel !== channelForShard(shard.channel)) {
        throw new TypeError(`Shard index entry does not match manifest: ${shard.shardId}`);
      }
    }
  }

  private async assertArtifactSourceRefs(
    ref: string,
    expected: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<void> {
    assertNotAborted(signal);
    const stored = await this.dependencies.artifacts.getArtifact(ref);
    assertNotAborted(signal);
    if (!stored || !expected.every((sourceRef) => stored.manifest.sourceRefs.includes(sourceRef))) {
      throw new TypeError(`Artifact source references are invalid: ${ref}`);
    }
  }
}
