import type {
  AgentTimelineEvent,
  AgentTimelineRange,
} from '../../../../types/agentTimeline/manifest';
import {
  SCENE_FUSION_ANALYZER_VERSION,
  type RuleBasedSceneBlockEvent,
  type SceneCandidateEvidence,
  type SceneCandidateGroup,
  type SceneCandidateMemberReview,
  type SceneFusionInput,
  type SceneFusionPolicy,
} from '../../../../types/agentTimeline/sceneFusion';
import {
  eventRange,
  normalizedTokens,
  overlaps,
  setSimilarity,
  stableSourceLocalId,
  tokenBigrams,
} from './sceneFusionCore';

interface SceneFeatures {
  scene: RuleBasedSceneBlockEvent;
  range: AgentTimelineRange;
  setupSequence: string[];
  tokens: string[];
  normalizedTranscript: string;
  speakerSequence: string[];
  memberReview: SceneCandidateMemberReview;
}

interface QualifiedPair {
  evidence: SceneCandidateEvidence;
  confidence: number;
}

function eventsOverlapping(
  input: SceneFusionInput,
  range: AgentTimelineRange,
  predicate: (event: AgentTimelineEvent) => boolean,
): AgentTimelineEvent[] {
  return input.events
    .filter(predicate)
    .filter((event) => {
      const candidate = eventRange(event);
      return candidate !== null && overlaps(candidate, range);
    })
    .toSorted((left, right) => {
      const leftRange = eventRange(left)!;
      const rightRange = eventRange(right)!;
      return leftRange.start - rightRange.start || left.id.localeCompare(right.id);
    });
}

function collapseConsecutive(values: readonly string[]): string[] {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

function featuresFor(
  input: SceneFusionInput,
  scene: RuleBasedSceneBlockEvent,
): SceneFeatures {
  const range = { start: scene.time.start, end: scene.time.end };
  const speech = eventsOverlapping(input, range, (event) => event.type === 'speech');
  const tokens = speech.flatMap((event) => (
    event.type === 'speech' ? normalizedTokens(event.data.text ?? '') : []
  ));
  const speakerEvents = eventsOverlapping(
    input,
    range,
    (event) => event.type === 'speech' || event.type === 'active-speaker',
  );
  const speakerSequence = collapseConsecutive(speakerEvents.flatMap((event) => (
    event.type === 'speech' || event.type === 'active-speaker'
      ? [event.data.speakerId]
      : []
  )));
  const quality = eventsOverlapping(input, range, (event) => event.type === 'quality-issue');
  const critical = quality.filter((event) => (
    event.type === 'quality-issue' && event.data.severity === 'critical'
  ));
  return {
    scene,
    range,
    setupSequence: [...scene.data.setupSequence],
    tokens,
    normalizedTranscript: tokens.join(' '),
    speakerSequence,
    memberReview: {
      sceneEventId: scene.id,
      qualityIssueCount: quality.length,
      criticalQualityIssueCount: critical.length,
      qualityEventIds: quality.map((event) => event.id),
    },
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function durationSimilarity(left: AgentTimelineRange, right: AgentTimelineRange): number {
  const leftDuration = left.end - left.start;
  const rightDuration = right.end - right.start;
  return Math.min(leftDuration, rightDuration) / Math.max(leftDuration, rightDuration);
}

function sourceDistance(left: AgentTimelineRange, right: AgentTimelineRange): number {
  if (overlaps(left, right)) return 0;
  return left.end <= right.start ? right.start - left.end : left.start - right.end;
}

function qualifyPair(
  left: SceneFeatures,
  right: SceneFeatures,
  policy: SceneFusionPolicy,
): QualifiedPair | null {
  if (left.setupSequence.length === 0
    || left.setupSequence.includes('unknown')
    || !arraysEqual(left.setupSequence, right.setupSequence)) return null;
  if (left.tokens.length < policy.minimumTopicTokens
    || right.tokens.length < policy.minimumTopicTokens) return null;
  if (left.speakerSequence.length === 0
    || !arraysEqual(left.speakerSequence, right.speakerSequence)) return null;

  const transcriptSimilarity = setSimilarity(
    tokenBigrams(left.tokens),
    tokenBigrams(right.tokens),
  );
  if (transcriptSimilarity < policy.takeMinimumTranscriptSimilarity) return null;
  const duration = durationSimilarity(left.range, right.range);
  if (duration < policy.takeMinimumDurationSimilarity) return null;
  const distance = sourceDistance(left.range, right.range);
  if (distance > policy.takeMaximumSourceDistance) return null;
  const proximityConfidence = Math.max(
    0.75,
    1 - (distance / policy.takeMaximumSourceDistance) * 0.25,
  );
  return {
    confidence: Math.min(transcriptSimilarity, duration, proximityConfidence),
    evidence: {
      sameSetupSequence: true,
      setupSequence: left.setupSequence,
      transcriptSimilarity,
      exactNormalizedTranscript: left.normalizedTranscript === right.normalizedTranscript,
      durationSimilarity: duration,
      sameSpeakerSequence: true,
      speakerSequence: left.speakerSequence,
      sourceDistance: distance,
    },
  };
}

function pairKey(left: SceneFeatures, right: SceneFeatures): string {
  return [left.scene.id, right.scene.id].toSorted().join('\u0000');
}

function candidateGroup(
  input: SceneFusionInput,
  members: readonly SceneFeatures[],
  pairs: readonly QualifiedPair[],
): SceneCandidateGroup {
  const memberIds = members.map((member) => member.scene.id).toSorted();
  const redundancyCandidate = pairs.every((pair) => (
    pair.evidence.exactNormalizedTranscript
    && pair.evidence.durationSimilarity >= 0.95
  ));
  const kind = redundancyCandidate ? 'redundancy-candidate' : 'take-candidate';
  return {
    id: stableSourceLocalId(input.sourceId, kind, memberIds),
    kind,
    disposition: 'review-required',
    sourceId: input.sourceId,
    memberSceneEventIds: memberIds,
    confidence: Math.min(...pairs.map((pair) => pair.confidence)),
    evidence: pairs.map((pair) => pair.evidence)
      .toSorted((left, right) => right.transcriptSimilarity - left.transcriptSimilarity
        || left.sourceDistance - right.sourceDistance),
    memberReview: members.map((member) => member.memberReview)
      .toSorted((left, right) => left.sceneEventId.localeCompare(right.sceneEventId)),
    provenance: [{
      kind: 'analyzer',
      analyzerId: 'conservative-scene-candidate-fusion',
      analyzerVersion: SCENE_FUSION_ANALYZER_VERSION,
    }],
  };
}

export function buildConservativeSceneCandidates(
  input: SceneFusionInput,
  scenes: readonly RuleBasedSceneBlockEvent[],
  policy: SceneFusionPolicy,
): SceneCandidateGroup[] {
  const features = scenes.map((scene) => featuresFor(input, scene))
    .toSorted((left, right) => left.range.start - right.range.start || left.scene.id.localeCompare(right.scene.id));
  const qualified = new Map<string, QualifiedPair>();
  for (let leftIndex = 0; leftIndex < features.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < features.length; rightIndex += 1) {
      const pair = qualifyPair(features[leftIndex], features[rightIndex], policy);
      if (pair) qualified.set(pairKey(features[leftIndex], features[rightIndex]), pair);
    }
  }

  const unassigned = new Set(features.map((feature) => feature.scene.id));
  const groups: SceneCandidateGroup[] = [];
  for (const seed of features) {
    if (!unassigned.has(seed.scene.id)) continue;
    const members = [seed];
    for (const candidate of features) {
      if (candidate.scene.id === seed.scene.id || !unassigned.has(candidate.scene.id)) continue;
      if (members.every((member) => qualified.has(pairKey(member, candidate)))) {
        members.push(candidate);
      }
    }
    if (members.length < 2) continue;
    const pairs: QualifiedPair[] = [];
    for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
        pairs.push(qualified.get(pairKey(members[leftIndex], members[rightIndex]))!);
      }
    }
    groups.push(candidateGroup(input, members, pairs));
    for (const member of members) unassigned.delete(member.scene.id);
  }
  return groups.toSorted((left, right) => left.memberSceneEventIds[0].localeCompare(right.memberSceneEventIds[0]));
}

