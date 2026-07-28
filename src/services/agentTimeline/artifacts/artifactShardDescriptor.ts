import {
  ARTIFACT_SHARD_SCHEMA_VERSION,
  type ArtifactShardDescriptor,
  type ArtifactShardDescriptorInput,
  type SourceTimeRange,
} from '../../../types/agentTimeline/artifactShard';

function requireNonEmpty(value: string, field: string): void {
  if (value.length === 0) throw new TypeError(`${field} must not be empty.`);
}

export function assertSourceTimeRange(range: SourceTimeRange): void {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    throw new RangeError('Source ranges must contain finite numbers.');
  }
  if (range.start < 0 || range.end <= range.start) {
    throw new RangeError('Source ranges must be non-negative, non-empty half-open ranges.');
  }
}

function assertCanonicalCreatedAt(createdAt: string): void {
  const time = Date.parse(createdAt);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== createdAt) {
    throw new TypeError('createdAt must be a canonical ISO-8601 timestamp.');
  }
}

function assertDescriptorInput(input: ArtifactShardDescriptorInput): void {
  requireNonEmpty(input.sourceIdentityHash, 'sourceIdentityHash');
  requireNonEmpty(input.analyzerId, 'analyzerId');
  requireNonEmpty(input.analyzerVersion, 'analyzerVersion');
  requireNonEmpty(input.artifactSchemaVersion, 'artifactSchemaVersion');
  requireNonEmpty(input.artifactRef, 'artifactRef');
  if (input.modelId !== undefined) requireNonEmpty(input.modelId, 'modelId');
  if (input.modelVersion !== undefined) requireNonEmpty(input.modelVersion, 'modelVersion');
  if ((input.modelId === undefined) !== (input.modelVersion === undefined)) {
    throw new TypeError('modelId and modelVersion must either both be present or both be absent.');
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new RangeError('sizeBytes must be a non-negative safe integer.');
  }
  if (input.timeDomain !== 'source') requireNonEmpty(input.stateHash, 'stateHash');
  assertSourceTimeRange(input.sourceRange);
  assertCanonicalCreatedAt(input.createdAt);
}

function canonicalShardKey(input: ArtifactShardDescriptorInput): string {
  return JSON.stringify([
    ARTIFACT_SHARD_SCHEMA_VERSION,
    input.sourceIdentityHash,
    input.channel,
    input.analyzerId,
    input.analyzerVersion,
    input.artifactSchemaVersion,
    input.modelId ?? null,
    input.modelVersion ?? null,
    input.profile,
    input.timeDomain,
    input.stateHash ?? null,
    input.sourceRange.start,
    input.sourceRange.end,
    input.artifactRef,
  ]);
}

/** FNV-1a 64 is sufficient for a deterministic local ID; content integrity uses source/artifact hashes. */
function stableKeyHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function createArtifactShardId(input: ArtifactShardDescriptorInput): string {
  assertDescriptorInput(input);
  return `artifact-shard-${stableKeyHash(canonicalShardKey(input))}`;
}

export function createArtifactShardDescriptor(
  input: ArtifactShardDescriptorInput,
): ArtifactShardDescriptor {
  return {
    ...input,
    sourceRange: { ...input.sourceRange },
    type: 'agent-timeline-artifact-shard',
    schemaVersion: ARTIFACT_SHARD_SCHEMA_VERSION,
    shardId: createArtifactShardId(input),
  };
}

export function hasValidArtifactShardId(shard: ArtifactShardDescriptor): boolean {
  return shard.schemaVersion === ARTIFACT_SHARD_SCHEMA_VERSION
    && shard.type === 'agent-timeline-artifact-shard'
    && shard.shardId === createArtifactShardId(shard);
}

