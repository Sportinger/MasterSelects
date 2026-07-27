import { AGENT_TIMELINE_EVENT_SCHEMA_VERSION } from '../../../../types/agentTimeline/manifest';
import type {
  AgentTimelineRange,
  AgentTimelineEventBase,
  ShotEventData,
} from '../../../../types/agentTimeline/manifest';
import {
  SCENE_FUSION_ANALYZER_VERSION,
  SCENE_FUSION_POLICY_VERSION,
  type RuleBasedSceneBlockEvent,
  type SceneBoundaryEvidence,
  type SceneFusionInput,
  type SceneFusionPolicy,
  type SceneFusionUnknown,
} from '../../../../types/agentTimeline/sceneFusion';
import {
  clamp01,
  coverageHoles,
  eventRange,
  mergeRanges,
  normalizedTokens,
  overlaps,
  setSimilarity,
  stableSourceLocalId,
  tokenBigrams,
  validRange,
} from './sceneFusionCore';

export const DEFAULT_SCENE_FUSION_POLICY: SceneFusionPolicy = Object.freeze({
  policyVersion: SCENE_FUSION_POLICY_VERSION,
  cutBoundaryTolerance: 0.05,
  strongCutMinimumScore: 0.9,
  strongCutMinimumConfidence: 0.8,
  minimumBoundaryConfidence: 0.72,
  minimumSceneDuration: 2,
  minimumSameSetupShotsBeforeReset: 2,
  topicWindowSeconds: 12,
  minimumTopicTokens: 6,
  topicMaximumSimilarity: 0.18,
  minimumSilenceDuration: 1.5,
  takeMinimumTranscriptSimilarity: 0.78,
  takeMinimumDurationSimilarity: 0.85,
  takeMaximumSourceDistance: 15 * 60,
});

type ShotEvent = AgentTimelineEventBase<'shot', ShotEventData>;

interface ShotSlice {
  event: ShotEvent;
  range: AgentTimelineRange;
}

interface BoundaryDecision {
  split: boolean;
  confidence: number;
  evidence: SceneBoundaryEvidence[];
}

function assertPolicy(policy: SceneFusionPolicy): void {
  const unitValues = [
    policy.strongCutMinimumScore,
    policy.strongCutMinimumConfidence,
    policy.minimumBoundaryConfidence,
    policy.topicMaximumSimilarity,
    policy.takeMinimumTranscriptSimilarity,
    policy.takeMinimumDurationSimilarity,
  ];
  if (unitValues.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError('Scene fusion confidence and similarity thresholds must be between 0 and 1.');
  }
  const positiveValues = [
    policy.cutBoundaryTolerance,
    policy.minimumSceneDuration,
    policy.topicWindowSeconds,
    policy.minimumSilenceDuration,
    policy.takeMaximumSourceDistance,
  ];
  if (positiveValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('Scene fusion duration and distance thresholds must be finite and positive.');
  }
  if (!Number.isSafeInteger(policy.minimumSameSetupShotsBeforeReset)
    || policy.minimumSameSetupShotsBeforeReset < 1
    || !Number.isSafeInteger(policy.minimumTopicTokens)
    || policy.minimumTopicTokens < 2) {
    throw new RangeError('Scene fusion count thresholds must be positive safe integers.');
  }
}

function sourceShots(input: SceneFusionInput): ShotSlice[] {
  return input.events
    .filter((event): event is ShotEvent => event.type === 'shot')
    .flatMap((event) => {
      const range = eventRange(event);
      if (!range || !validRange(range) || !overlaps(range, input.range)) return [];
      return [{
        event,
        range: {
          start: Math.max(range.start, input.range.start),
          end: Math.min(range.end, input.range.end),
        },
      }];
    })
    .toSorted((left, right) => left.range.start - right.range.start
      || left.range.end - right.range.end
      || left.event.id.localeCompare(right.event.id));
}

function cutsAt(input: SceneFusionInput, boundary: number, policy: SceneFusionPolicy) {
  return input.events
    .filter((event) => event.type === 'cut'
      && event.time.timeDomain === 'source'
      && event.time.temporalKind === 'point'
      && Math.abs(event.time.time - boundary) <= policy.cutBoundaryTolerance)
    .toSorted((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
}

function speechTokens(
  input: SceneFusionInput,
  range: AgentTimelineRange,
): { tokens: string[]; eventIds: string[] } {
  const speech = input.events
    .filter((event) => event.type === 'speech')
    .filter((event) => {
      const candidate = eventRange(event);
      return candidate !== null && overlaps(candidate, range);
    })
    .toSorted((left, right) => {
      const leftRange = eventRange(left)!;
      const rightRange = eventRange(right)!;
      return leftRange.start - rightRange.start || left.id.localeCompare(right.id);
    });
  return {
    tokens: speech.flatMap((event) => normalizedTokens(event.data.text ?? '')),
    eventIds: speech.map((event) => event.id),
  };
}

function dominantSpeaker(input: SceneFusionInput, range: AgentTimelineRange) {
  const durations = new Map<string, { duration: number; eventIds: string[] }>();
  for (const event of input.events) {
    if (event.type !== 'speech' && event.type !== 'active-speaker') continue;
    const candidate = eventRange(event);
    if (!candidate || !overlaps(candidate, range)) continue;
    const overlapDuration = Math.max(0,
      Math.min(candidate.end, range.end) - Math.max(candidate.start, range.start));
    const speakerId = event.data.speakerId;
    const current = durations.get(speakerId) ?? { duration: 0, eventIds: [] };
    current.duration += overlapDuration;
    current.eventIds.push(event.id);
    durations.set(speakerId, current);
  }
  return [...durations.entries()]
    .toSorted((left, right) => right[1].duration - left[1].duration || left[0].localeCompare(right[0]))
    .at(0);
}

function silenceAt(input: SceneFusionInput, boundary: number, policy: SceneFusionPolicy) {
  return input.events
    .filter((event) => (
      (event.type === 'audio-activity' && event.data.activity === 'silence')
      || (event.type === 'quality-issue' && event.data.issue === 'silence')
    ))
    .filter((event) => {
      const range = eventRange(event);
      return range !== null
        && range.start < boundary
        && range.end >= boundary
        && range.end - range.start >= policy.minimumSilenceDuration;
    })
    .toSorted((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
}

function boundaryDecision(
  input: SceneFusionInput,
  policy: SceneFusionPolicy,
  currentScene: readonly ShotSlice[],
  next: ShotSlice,
): BoundaryDecision {
  const previous = currentScene.at(-1)!;
  const boundary = next.range.start;
  if (boundary > previous.range.end + policy.cutBoundaryTolerance) {
    return {
      split: true,
      confidence: 1,
      evidence: [{
        reason: 'shot-gap',
        confidence: 1,
        sourceEventIds: [previous.event.id, next.event.id],
      }],
    };
  }
  if (boundary - currentScene[0].range.start < policy.minimumSceneDuration) {
    return { split: false, confidence: 0, evidence: [] };
  }

  const evidence: SceneBoundaryEvidence[] = [];
  const matchingCuts = cutsAt(input, boundary, policy);
  const transition = matchingCuts.find((event) => (
    event.type === 'cut'
    && event.data.transition !== 'hard'
    && event.data.transition !== 'unknown'
  ));
  if (transition?.type === 'cut') {
    evidence.push({
      reason: 'transition-cut',
      confidence: clamp01(Math.max(transition.confidence, transition.data.score)),
      sourceEventIds: [transition.id],
      cutScore: transition.data.score,
      transition: transition.data.transition,
    });
  } else {
    const strongCut = matchingCuts.find((event) => event.type === 'cut'
      && event.data.score >= policy.strongCutMinimumScore
      && event.confidence >= policy.strongCutMinimumConfidence);
    if (strongCut?.type === 'cut') {
      evidence.push({
        reason: 'strong-cut',
        confidence: clamp01(Math.min(strongCut.confidence, strongCut.data.score)),
        sourceEventIds: [strongCut.id],
        cutScore: strongCut.data.score,
        transition: strongCut.data.transition,
      });
    }
  }

  const currentSetups = currentScene.map((shot) => shot.event.data.setupId);
  const knownCurrentSetups = currentSetups.filter((setup): setup is string => Boolean(setup));
  const previousSetup = knownCurrentSetups[0];
  const nextSetup = next.event.data.setupId;
  if (currentScene.length >= policy.minimumSameSetupShotsBeforeReset
    && previousSetup
    && nextSetup
    && knownCurrentSetups.length === currentSetups.length
    && knownCurrentSetups.every((setup) => setup === previousSetup)
    && nextSetup !== previousSetup) {
    evidence.push({
      reason: 'setup-reset',
      confidence: 0.78,
      sourceEventIds: [...currentScene.map((shot) => shot.event.id), next.event.id],
      previousSetupId: previousSetup,
      nextSetupId: nextSetup,
    });
  }

  const beforeRange = {
    start: Math.max(input.range.start, boundary - policy.topicWindowSeconds),
    end: boundary,
  };
  const afterRange = {
    start: boundary,
    end: Math.min(input.range.end, boundary + policy.topicWindowSeconds),
  };
  if (validRange(beforeRange) && validRange(afterRange)) {
    const before = speechTokens(input, beforeRange);
    const after = speechTokens(input, afterRange);
    if (before.tokens.length >= policy.minimumTopicTokens
      && after.tokens.length >= policy.minimumTopicTokens) {
      const similarity = setSimilarity(tokenBigrams(before.tokens), tokenBigrams(after.tokens));
      if (similarity <= policy.topicMaximumSimilarity) {
        evidence.push({
          reason: 'topic-shift',
          confidence: clamp01(1 - similarity),
          sourceEventIds: [...before.eventIds, ...after.eventIds].toSorted(),
          transcriptSimilarity: similarity,
        });
      }
    }
  }

  const silence = silenceAt(input, boundary, policy).at(0);
  const silenceRange = silence ? eventRange(silence) : null;
  if (silence && silenceRange) {
    evidence.push({
      reason: 'long-silence',
      confidence: clamp01(Math.max(0.8, silence.confidence)),
      sourceEventIds: [silence.id],
      silenceDuration: silenceRange.end - silenceRange.start,
    });
  }

  const beforeSpeaker = dominantSpeaker(input, beforeRange);
  const afterSpeaker = dominantSpeaker(input, afterRange);
  if (beforeSpeaker && afterSpeaker && beforeSpeaker[0] !== afterSpeaker[0]) {
    evidence.push({
      reason: 'speaker-change',
      confidence: 0.55,
      sourceEventIds: [...beforeSpeaker[1].eventIds, ...afterSpeaker[1].eventIds].toSorted(),
      previousSpeakerId: beforeSpeaker[0],
      nextSpeakerId: afterSpeaker[0],
    });
  }

  const primaryConfidence = Math.max(
    0,
    ...evidence
      .filter((item) => item.reason !== 'speaker-change')
      .map((item) => item.confidence),
  );
  const confidence = clamp01(primaryConfidence + Math.max(0, evidence.length - 1) * 0.03);
  return {
    split: primaryConfidence >= policy.minimumBoundaryConfidence,
    confidence,
    evidence: evidence.toSorted((left, right) => right.confidence - left.confidence
      || left.reason.localeCompare(right.reason)),
  };
}

function sceneEvent(
  input: SceneFusionInput,
  shots: readonly ShotSlice[],
  boundary: BoundaryDecision,
): RuleBasedSceneBlockEvent {
  const start = shots[0].range.start;
  const end = shots.at(-1)!.range.end;
  const shotIds = shots.map((shot) => shot.event.data.shotId);
  const setupSequence = shots.map((shot) => shot.event.data.setupId ?? 'unknown');
  const sourceEventIds = [
    ...shots.map((shot) => shot.event.id),
    ...boundary.evidence.flatMap((item) => item.sourceEventIds),
  ].filter((id, index, all) => all.indexOf(id) === index).toSorted();
  const id = stableSourceLocalId(input.sourceId, 'scene-block', [start, end, ...shotIds]);
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'scene-block',
    time: { temporalKind: 'interval', timeDomain: 'source', start, end },
    confidence: boundary.confidence,
    provenance: [{
      kind: 'analyzer',
      analyzerId: 'rule-based-scene-fusion',
      analyzerVersion: SCENE_FUSION_ANALYZER_VERSION,
    }],
    data: {
      sceneId: id,
      boundarySource: 'rule-based',
      shotIds,
      setupIds: [...new Set(setupSequence.filter((setup) => setup !== 'unknown'))],
      setupSequence,
      sourceEventIds,
      boundaryReasons: boundary.evidence,
      boundaryConfidence: boundary.confidence,
    },
  };
}

export interface BuildSceneBlocksResult {
  policy: SceneFusionPolicy;
  sceneEvents: RuleBasedSceneBlockEvent[];
  covered: AgentTimelineRange[];
  missing: AgentTimelineRange[];
  unknowns: SceneFusionUnknown[];
}

export function buildRuleBasedSceneBlocks(input: SceneFusionInput): BuildSceneBlocksResult {
  if (!input.sourceId) throw new TypeError('sourceId is required');
  if (!validRange(input.range)) throw new RangeError('Scene fusion requires a valid half-open source range');
  const policy: SceneFusionPolicy = { ...DEFAULT_SCENE_FUSION_POLICY, ...input.policy };
  assertPolicy(policy);
  const shots = sourceShots(input);
  const covered = mergeRanges(shots.map((shot) => shot.range));
  const missing = coverageHoles(input.range, covered);
  const unknowns: SceneFusionUnknown[] = [];
  if (shots.length === 0) {
    unknowns.push({ code: 'shots-missing', range: { ...input.range }, detail: 'No source-time shot events are available.' });
    return { policy, sceneEvents: [], covered, missing, unknowns };
  }
  if (missing.length > 0) {
    unknowns.push({ code: 'shot-coverage-partial', range: { ...input.range }, detail: 'Shot events do not cover the full requested range.' });
  }
  if (shots.some((shot) => !shot.event.data.setupId)) {
    unknowns.push({ code: 'setup-evidence-incomplete', range: { ...input.range }, detail: 'One or more shots have no setup ID.' });
  }
  if (!input.events.some((event) => event.type === 'speech')) {
    unknowns.push({ code: 'transcript-evidence-unavailable', range: { ...input.range }, detail: 'No speech events are available for lexical topic evidence.' });
  }
  if (!input.events.some((event) => event.type === 'speech' || event.type === 'active-speaker')) {
    unknowns.push({ code: 'speaker-evidence-unavailable', range: { ...input.range }, detail: 'No speaker events are available.' });
  }
  if (!input.events.some((event) => (
    (event.type === 'audio-activity' && event.data.activity === 'silence')
    || (event.type === 'quality-issue' && event.data.issue === 'silence')
  ))) {
    unknowns.push({ code: 'silence-evidence-unavailable', range: { ...input.range }, detail: 'No persisted silence events are available.' });
  }

  const sceneEvents: RuleBasedSceneBlockEvent[] = [];
  let current: ShotSlice[] = [shots[0]];
  let boundary: BoundaryDecision = {
    split: true,
    confidence: 1,
    evidence: [{ reason: 'range-start', confidence: 1, sourceEventIds: [] }],
  };
  for (const next of shots.slice(1)) {
    const decision = boundaryDecision(input, policy, current, next);
    if (decision.split) {
      sceneEvents.push(sceneEvent(input, current, boundary));
      current = [next];
      boundary = decision;
    } else {
      current.push(next);
    }
  }
  sceneEvents.push(sceneEvent(input, current, boundary));
  return { policy, sceneEvents, covered, missing, unknowns };
}
