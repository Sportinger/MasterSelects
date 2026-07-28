import type {
  FaceIdentityAnnotationLayer,
  FaceIdentityPrivacyPolicy,
  FaceIdentityRemapLayer,
  FaceIdentityThresholdPolicy,
  FaceTrackRemap,
  ShardFaceTrack,
  ShardFaceTrackRef,
  SourceFaceIdentity,
} from '../../../types/agentTimeline/faceIdentity';
import { FACE_IDENTITY_REMAP_SCHEMA_VERSION } from '../../../types/agentTimeline/faceIdentity';
import type { SourceIdentity } from '../../../types/agentTimeline/sourceIdentity';
import { applyFaceIdentityAnnotations } from './annotationLayer';
import { compareFaceTrackRefs, createSourcePersonId, faceTrackKey, sourceIdentitiesMatch } from './identityKeys';

export const DEFAULT_FACE_IDENTITY_THRESHOLD_POLICY: FaceIdentityThresholdPolicy = Object.freeze({
  policyVersion: 'face-identity-threshold/v1',
  acceptConfidence: 0.82,
  minimumMargin: 0.08,
});

export const DEFAULT_FACE_IDENTITY_PRIVACY_POLICY: FaceIdentityPrivacyPolicy = Object.freeze({
  prototypePersistence: 'disabled',
  allowProjectPersonLinks: true,
});

export interface ReconcileFaceIdentityInput {
  sourceIdentity: SourceIdentity;
  tracks: ShardFaceTrack[];
  generatedAt: string;
  previous?: FaceIdentityRemapLayer;
  annotations?: FaceIdentityAnnotationLayer[];
  thresholdPolicy?: FaceIdentityThresholdPolicy;
  privacyPolicy?: FaceIdentityPrivacyPolicy;
}

class TrackSets {
  private readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    const parent = this.parent.get(key);
    if (!parent) throw new Error(`Unknown face track key: ${key}`);
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot.localeCompare(rightRoot) <= 0) this.parent.set(rightRoot, leftRoot);
    else this.parent.set(leftRoot, rightRoot);
  }
}

function chooseCandidate(track: ShardFaceTrack, policy: FaceIdentityThresholdPolicy) {
  const candidates = track.candidates
    .filter((candidate) => Number.isFinite(candidate.confidence) && candidate.confidence >= 0 && candidate.confidence <= 1)
    .toSorted((left, right) => right.confidence - left.confidence || faceTrackKey(left.target).localeCompare(faceTrackKey(right.target)));
  const best = candidates[0];
  if (!best) return { status: 'none' as const };
  if (best.confidence < policy.acceptConfidence) return { status: 'low-confidence' as const, confidence: best.confidence };
  const runnerUp = candidates[1];
  if (runnerUp && best.confidence - runnerUp.confidence < policy.minimumMargin) {
    return { status: 'insufficient-margin' as const, confidence: best.confidence };
  }
  return { status: 'accepted' as const, candidate: best };
}

function buildAnalyzerRemaps(
  sourceIdentity: SourceIdentity,
  tracks: ShardFaceTrack[],
  previous: FaceIdentityRemapLayer | undefined,
  policy: FaceIdentityThresholdPolicy,
): FaceTrackRemap[] {
  const byKey = new Map(tracks.map((track) => [faceTrackKey(track.ref), track]));
  if (byKey.size !== tracks.length) throw new TypeError('Duplicate shard-local face track reference');
  const previousCompatible = Boolean(previous && sourceIdentitiesMatch(sourceIdentity, previous.sourceIdentity));
  const previousByTrack = new Map<string, FaceTrackRemap>();
  if (previousCompatible && previous) {
    for (const remap of previous.trackRemaps) previousByTrack.set(faceTrackKey(remap.track), remap);
  }
  const sets = new TrackSets();
  for (const key of byKey.keys()) sets.add(key);
  const decisions = new Map<string, ReturnType<typeof chooseCandidate>>();
  for (const [key, track] of byKey) {
    const decision = chooseCandidate(track, policy);
    decisions.set(key, decision);
    if (decision.status === 'accepted') {
      const targetKey = faceTrackKey(decision.candidate.target);
      if (byKey.has(targetKey)) sets.union(key, targetKey);
    }
  }

  const components = new Map<string, ShardFaceTrackRef[]>();
  for (const track of tracks) {
    const root = sets.find(faceTrackKey(track.ref));
    const component = components.get(root) ?? [];
    component.push(track.ref);
    components.set(root, component);
  }
  const componentSourceId = new Map<string, string>();
  for (const [root, members] of components) {
    members.sort(compareFaceTrackRefs);
    const existingIds = members.flatMap((member) => {
      const memberKey = faceTrackKey(member);
      const ownPrevious = previousByTrack.get(memberKey)?.sourcePersonId;
      const decision = decisions.get(memberKey);
      const externalTarget = decision?.status === 'accepted'
        ? previousByTrack.get(faceTrackKey(decision.candidate.target))?.sourcePersonId
        : undefined;
      return [ownPrevious, externalTarget].filter((id): id is string => Boolean(id));
    }).sort();
    componentSourceId.set(root, existingIds[0] ?? createSourcePersonId(sourceIdentity, members[0]));
  }

  const currentRemaps = tracks.toSorted((left, right) => compareFaceTrackRefs(left.ref, right.ref)).map((track): FaceTrackRemap => {
    const key = faceTrackKey(track.ref);
    const decision = decisions.get(key);
    const isJoined = (components.get(sets.find(key))?.length ?? 0) > 1;
    const prior = previousByTrack.get(key);
    if (!isJoined && prior?.sourcePersonId) {
      return {
        track: { ...track.ref },
        sourcePersonId: prior.sourcePersonId,
        status: prior.status,
        confidence: prior.confidence,
        reason: prior.status === 'manual' ? 'manual' : 'previous-remap',
      };
    }
    if (!isJoined && decision?.status === 'low-confidence') {
      return { track: { ...track.ref }, status: 'unknown', confidence: decision.confidence, reason: 'low-confidence' };
    }
    if (!isJoined && decision?.status === 'insufficient-margin') {
      return { track: { ...track.ref }, status: 'unknown', confidence: decision.confidence, reason: 'insufficient-margin' };
    }
    return {
      track: { ...track.ref },
      sourcePersonId: componentSourceId.get(sets.find(key)),
      status: 'resolved',
      confidence: isJoined && decision?.status === 'accepted' ? decision.candidate.confidence : 1,
      reason: isJoined ? 'threshold-match' : 'new-source-track',
    };
  });
  const currentKeys = new Set(byKey.keys());
  const unchangedPrevious = [...previousByTrack.entries()]
    .filter(([key]) => !currentKeys.has(key))
    .map(([, remap]) => ({ ...remap, track: { ...remap.track } }));
  return [...currentRemaps, ...unchangedPrevious]
    .toSorted((left, right) => compareFaceTrackRefs(left.track, right.track));
}

function summarizeSourceIdentities(remaps: FaceTrackRemap[], previous?: FaceIdentityRemapLayer): SourceFaceIdentity[] {
  const previousIdsByTrack = new Map((previous?.trackRemaps ?? []).flatMap((remap) => (
    remap.sourcePersonId ? [[faceTrackKey(remap.track), remap.sourcePersonId] as const] : []
  )));
  const groups = new Map<string, FaceTrackRemap[]>();
  for (const remap of remaps) {
    if (!remap.sourcePersonId) continue;
    const group = groups.get(remap.sourcePersonId) ?? [];
    group.push(remap);
    groups.set(remap.sourcePersonId, group);
  }
  return [...groups.entries()].toSorted(([left], [right]) => left.localeCompare(right)).map(([sourcePersonId, members]) => {
    const superseded = [...new Set(members
      .map((member) => previousIdsByTrack.get(faceTrackKey(member.track)))
      .filter((id): id is string => Boolean(id) && id !== sourcePersonId))].sort();
    const manual = members.some((member) => member.status === 'manual');
    const threshold = members.some((member) => member.reason === 'threshold-match');
    const previous = members.some((member) => member.reason === 'previous-remap');
    return {
      sourcePersonId,
      memberTracks: members.map((member) => ({ ...member.track })).sort(compareFaceTrackRefs),
      confidence: Math.min(...members.map((member) => member.confidence)),
      decision: manual ? 'manual' : threshold ? 'threshold-match' : previous ? 'previous-remap' : 'new-source-track',
      supersededSourcePersonIds: superseded.length > 0 ? superseded : undefined,
    };
  });
}

export function reconcileFaceIdentities(input: ReconcileFaceIdentityInput): FaceIdentityRemapLayer {
  const thresholdPolicy = { ...DEFAULT_FACE_IDENTITY_THRESHOLD_POLICY, ...input.thresholdPolicy };
  const privacyPolicy = { ...DEFAULT_FACE_IDENTITY_PRIVACY_POLICY, ...input.privacyPolicy };
  const analyzerRemaps = buildAnalyzerRemaps(input.sourceIdentity, input.tracks, input.previous, thresholdPolicy);
  const annotations = applyFaceIdentityAnnotations(
    input.sourceIdentity,
    analyzerRemaps,
    input.annotations ?? [],
    privacyPolicy.allowProjectPersonLinks,
  );
  return {
    schemaVersion: FACE_IDENTITY_REMAP_SCHEMA_VERSION,
    sourceIdentity: input.sourceIdentity,
    generatedAt: input.generatedAt,
    thresholdPolicy,
    privacyPolicy,
    sourceIdentities: summarizeSourceIdentities(annotations.remaps, input.previous),
    trackRemaps: annotations.remaps,
    projectPersonLinks: annotations.projectLinks,
    appliedAnnotationIds: annotations.appliedAnnotationIds,
    orphanedAnnotations: annotations.orphanedAnnotations,
  };
}
