import { describe, expect, it } from 'vitest';
import {
  FACE_IDENTITY_ANNOTATION_SCHEMA_VERSION,
  type FaceIdentityAnnotationLayer,
  type FaceIdentityManualAnnotation,
  type ShardFaceTrack,
} from '../../src/types/agentTimeline/faceIdentity';
import {
  SOURCE_IDENTITY_SCHEMA_VERSION,
  type SourceIdentity,
} from '../../src/types/agentTimeline/sourceIdentity';
import {
  DEFAULT_FACE_IDENTITY_PRIVACY_POLICY,
  reconcileFaceIdentities,
} from '../../src/services/agentTimeline/faceIdentity/reconcileFaceIdentities';

const SOURCE: SourceIdentity = {
  type: 'source-identity',
  version: SOURCE_IDENTITY_SCHEMA_VERSION,
  strategy: 'sampled-chunks',
  hashAlgorithm: 'sha-256',
  hash: '11'.repeat(32),
  metadata: { size: 2048, mediaType: 'video/mp4' },
};

function track(shardId: string, shardTrackId: string, candidates: ShardFaceTrack['candidates'] = []): ShardFaceTrack {
  return { ref: { shardId, shardTrackId }, appearanceCount: 2, candidates };
}

function annotationLayer(
  annotations: FaceIdentityManualAnnotation[],
  sourceIdentity: SourceIdentity = SOURCE,
): FaceIdentityAnnotationLayer {
  return {
    schemaVersion: FACE_IDENTITY_ANNOTATION_SCHEMA_VERSION,
    sourceIdentity,
    annotations,
  };
}

function reconcile(tracks: ShardFaceTrack[], annotations: FaceIdentityAnnotationLayer[] = []) {
  return reconcileFaceIdentities({
    sourceIdentity: SOURCE,
    tracks,
    annotations,
    generatedAt: '2026-07-26T20:00:00.000Z',
  });
}

describe('Agent Timeline shard face identity reconciliation', () => {
  it('prevents shard-local track ID collisions from becoming one source identity', () => {
    const result = reconcile([track('shard-a', 'person-1'), track('shard-b', 'person-1')]);
    expect(result.trackRemaps).toHaveLength(2);
    expect(new Set(result.trackRemaps.map((remap) => remap.sourcePersonId)).size).toBe(2);
    expect(result.sourceIdentities).toHaveLength(2);
  });

  it('merges shard tracks only through the explicit threshold and margin policy', () => {
    const result = reconcile([
      track('shard-a', 'a', [{
        target: { shardId: 'shard-b', shardTrackId: 'b' },
        confidence: 0.93,
        method: 'numeric-prototype',
      }]),
      track('shard-b', 'b'),
    ]);
    expect(result.sourceIdentities).toHaveLength(1);
    expect(result.sourceIdentities[0].decision).toBe('threshold-match');
    expect(result.sourceIdentities[0].memberTracks).toHaveLength(2);
  });

  it('keeps low-confidence and ambiguous candidates unknown', () => {
    const low = reconcile([
      track('shard-a', 'a', [{
        target: { shardId: 'shard-b', shardTrackId: 'b' }, confidence: 0.6, method: 'numeric-prototype',
      }]),
      track('shard-b', 'b'),
    ]);
    const lowConfidence = low.trackRemaps.find((remap) => remap.track.shardTrackId === 'a');
    expect(lowConfidence).toMatchObject({ status: 'unknown', reason: 'low-confidence' });
    expect(lowConfidence).not.toHaveProperty('sourcePersonId');

    const ambiguous = reconcile([
      track('shard-a', 'a', [
        { target: { shardId: 'shard-b', shardTrackId: 'b' }, confidence: 0.91, method: 'numeric-prototype' },
        { target: { shardId: 'shard-c', shardTrackId: 'c' }, confidence: 0.87, method: 'numeric-prototype' },
      ]),
      track('shard-b', 'b'),
      track('shard-c', 'c'),
    ]);
    expect(ambiguous.trackRemaps.find((remap) => remap.track.shardTrackId === 'a')?.reason).toBe('insufficient-margin');
  });

  it('applies manual remaps after analyzer decisions and preserves them across reanalysis', () => {
    const manual = annotationLayer([{
      id: 'manual-assign-a',
      createdAt: '2026-07-26T20:01:00.000Z',
      operation: {
        type: 'assign-track',
        track: { shardId: 'shard-a', shardTrackId: 'a' },
        targetSourcePersonId: 'source-person-confirmed',
      },
    }]);
    const tracks = [
      track('shard-a', 'a', [{
        target: { shardId: 'shard-b', shardTrackId: 'b' }, confidence: 0.98, method: 'numeric-prototype',
      }]),
      track('shard-b', 'b'),
    ];
    const first = reconcile(tracks, [manual]);
    expect(first.trackRemaps.find((remap) => remap.track.shardTrackId === 'a')).toMatchObject({
      sourcePersonId: 'source-person-confirmed', status: 'manual', confidence: 1,
    });
    const reanalyzed = reconcileFaceIdentities({
      sourceIdentity: SOURCE,
      tracks: tracks.toReversed(),
      previous: first,
      annotations: [manual],
      generatedAt: '2026-07-26T20:02:00.000Z',
    });
    expect(reanalyzed.trackRemaps.find((remap) => remap.track.shardTrackId === 'a')?.sourcePersonId)
      .toBe('source-person-confirmed');
    expect(reanalyzed.appliedAnnotationIds).toEqual(['manual-assign-a']);
  });

  it('retains untouched shard remaps during a partial-shard reanalysis', () => {
    const initial = reconcile([track('shard-a', 'a'), track('shard-b', 'b')]);
    const partial = reconcileFaceIdentities({
      sourceIdentity: SOURCE,
      tracks: [track('shard-c', 'c', [{
        target: { shardId: 'shard-a', shardTrackId: 'a' }, confidence: 0.96, method: 'numeric-prototype',
      }])],
      previous: initial,
      generatedAt: '2026-07-26T20:02:00.000Z',
    });
    expect(partial.trackRemaps.map((remap) => `${remap.track.shardId}/${remap.track.shardTrackId}`)).toEqual([
      'shard-a/a', 'shard-b/b', 'shard-c/c',
    ]);
    const firstSourceId = initial.trackRemaps.find((remap) => remap.track.shardId === 'shard-a')?.sourcePersonId;
    expect(partial.trackRemaps.find((remap) => remap.track.shardId === 'shard-c')?.sourcePersonId).toBe(firstSourceId);
  });

  it('reports source-mismatched annotations as orphaned instead of applying or deleting them', () => {
    const differentSource: SourceIdentity = { ...SOURCE, hash: '22'.repeat(32) };
    const manual = annotationLayer([{
      id: 'wrong-source',
      createdAt: '2026-07-26T20:01:00.000Z',
      operation: {
        type: 'assign-track',
        track: { shardId: 'shard-a', shardTrackId: 'a' },
        targetSourcePersonId: 'must-not-apply',
      },
    }], differentSource);
    const result = reconcile([track('shard-a', 'a')], [manual]);
    expect(result.appliedAnnotationIds).toEqual([]);
    expect(result.trackRemaps[0].sourcePersonId).not.toBe('must-not-apply');
    expect(result.orphanedAnnotations).toEqual([{
      annotation: manual.annotations[0], reason: 'source-identity-mismatch',
    }]);
  });

  it('never infers a project-wide person and links one only via an explicit annotation', () => {
    const baseline = reconcile([track('shard-a', 'a')]);
    expect(baseline.projectPersonLinks).toEqual([]);
    const sourcePersonId = baseline.trackRemaps[0].sourcePersonId!;
    const linked = reconcile([track('shard-a', 'a')], [annotationLayer([{
      id: 'link-project-person',
      createdAt: '2026-07-26T20:01:00.000Z',
      operation: { type: 'link-project-person', sourcePersonId, projectPersonId: 'project-person-alex' },
    }])]);
    expect(linked.projectPersonLinks).toEqual([{
      sourcePersonId, projectPersonId: 'project-person-alex', annotationId: 'link-project-person',
    }]);
  });

  it('defaults to no prototype persistence and emits no numeric prototype data', () => {
    expect(DEFAULT_FACE_IDENTITY_PRIVACY_POLICY.prototypePersistence).toBe('disabled');
    const result = reconcile([track('shard-a', 'a')]);
    expect(result.privacyPolicy.prototypePersistence).toBe('disabled');
    expect(result.sourceIdentities[0].prototypeMetadata).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('embedding');
  });

  it('is deterministic across shard and candidate input order', () => {
    const firstTrack = track('shard-a', 'a', [
      { target: { shardId: 'shard-c', shardTrackId: 'c' }, confidence: 0.4, method: 'numeric-prototype' },
      { target: { shardId: 'shard-b', shardTrackId: 'b' }, confidence: 0.95, method: 'numeric-prototype' },
    ]);
    const input = [firstTrack, track('shard-b', 'b'), track('shard-c', 'c')];
    const forward = reconcile(input);
    const reversed = reconcile([
      track('shard-c', 'c'),
      track('shard-b', 'b'),
      { ...firstTrack, candidates: firstTrack.candidates.toReversed() },
    ]);
    expect(reversed).toEqual(forward);
  });
});
