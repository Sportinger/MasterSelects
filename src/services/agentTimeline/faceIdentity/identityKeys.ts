import type { SourceIdentity } from '../../../types/agentTimeline/sourceIdentity';
import type { ShardFaceTrackRef } from '../../../types/agentTimeline/faceIdentity';

export function faceTrackKey(ref: ShardFaceTrackRef): string {
  return `${encodeURIComponent(ref.shardId)}::${encodeURIComponent(ref.shardTrackId)}`;
}

export function compareFaceTrackRefs(left: ShardFaceTrackRef, right: ShardFaceTrackRef): number {
  return faceTrackKey(left).localeCompare(faceTrackKey(right));
}

export function sourceIdentitiesMatch(left: SourceIdentity, right: SourceIdentity): boolean {
  return left.version === right.version
    && left.strategy === right.strategy
    && left.hashAlgorithm === right.hashAlgorithm
    && left.hash === right.hash
    && left.metadata.size === right.metadata.size
    && left.metadata.mediaType === right.metadata.mediaType;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function createSourcePersonId(sourceIdentity: SourceIdentity, firstTrack: ShardFaceTrackRef): string {
  return `source-person-${stableHash(`${sourceIdentity.hash}:${faceTrackKey(firstTrack)}`)}`;
}
