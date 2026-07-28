import { AGENT_TIMELINE_EVENT_SCHEMA_VERSION } from '../../../types/agentTimeline/manifest';
import type { SourceIdentity } from '../../../types/agentTimeline/sourceIdentity';
import {
  SPEAKER_PERSON_FUSION_POLICY_VERSION,
  type FacePresenceInput,
  type ManualSpeakerPersonAnnotation,
  type MouthMotionCandidateInput,
  type SpeakerFusionPolicy,
  type SpeakerPersonAnnotationLayer,
  type SpeakerPersonFusionEvent,
  type SpeakerPersonFusionEventData,
  type SpeakerPersonFusionResult,
  type SpeakerTurnInput,
} from '../../../types/agentTimeline/speakerFusion';

export const DEFAULT_SPEAKER_FUSION_POLICY: SpeakerFusionPolicy = Object.freeze({
  policyVersion: SPEAKER_PERSON_FUSION_POLICY_VERSION,
  mouthMotionMinimumScore: 0.68,
  mouthMotionMinimumMargin: 0.15,
});

export interface FuseSpeakerPeopleInput {
  sourceIdentity: SourceIdentity;
  turns: SpeakerTurnInput[];
  facePresence: FacePresenceInput[];
  mouthMotionCandidates?: MouthMotionCandidateInput[];
  annotationLayers?: SpeakerPersonAnnotationLayer[];
  policy?: Partial<Omit<SpeakerFusionPolicy, 'policyVersion'>>;
}

interface VisiblePerson {
  sourcePersonId: string;
  confidence: number;
  verified: boolean;
  sourceTrackIds: string[];
}

function validRange(value: { start: number; end: number }): boolean {
  return Number.isFinite(value.start) && Number.isFinite(value.end) && value.start < value.end;
}

function confidence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function validAnnotation(annotation: ManualSpeakerPersonAnnotation): boolean {
  return validRange(annotation)
    && annotation.id.length > 0
    && annotation.speakerId.length > 0
    && (annotation.status !== 'onscreen' || Boolean(annotation.sourcePersonId));
}

function sourceIdentitiesMatch(left: SourceIdentity, right: SourceIdentity): boolean {
  return left.version === right.version
    && left.strategy === right.strategy
    && left.hashAlgorithm === right.hashAlgorithm
    && left.hash === right.hash
    && left.metadata.size === right.metadata.size
    && left.metadata.mediaType === right.metadata.mediaType;
}

function overlaps(start: number, end: number, range: { start: number; end: number }): boolean {
  return range.start < end && range.end > start;
}

function compareAnnotations(left: ManualSpeakerPersonAnnotation, right: ManualSpeakerPersonAnnotation): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function visiblePeopleAtSegment(
  facePresence: FacePresenceInput[],
  start: number,
  end: number,
): VisiblePerson[] {
  const byPerson = new Map<string, FacePresenceInput[]>();
  for (const presence of facePresence) {
    if (!validRange(presence) || !overlaps(start, end, presence)) continue;
    const entries = byPerson.get(presence.sourcePersonId) ?? [];
    entries.push(presence);
    byPerson.set(presence.sourcePersonId, entries);
  }
  return [...byPerson.entries()].map(([sourcePersonId, entries]) => ({
    sourcePersonId,
    confidence: Math.max(...entries.map((entry) => confidence(entry.confidence))),
    verified: entries.some((entry) => entry.verified),
    sourceTrackIds: [...new Set(entries.map((entry) => entry.sourceTrackId))].sort(),
  })).toSorted((left, right) => left.sourcePersonId.localeCompare(right.sourcePersonId));
}

function classifyAutomatic(
  turn: SpeakerTurnInput,
  people: VisiblePerson[],
  candidates: MouthMotionCandidateInput[],
  policy: SpeakerFusionPolicy,
): { data: SpeakerPersonFusionEventData; confidence: number; candidate?: MouthMotionCandidateInput } {
  const turnConfidence = confidence(turn.confidence);
  const common = {
    speakerId: turn.speakerId,
    sourceTrackIds: people.flatMap((person) => person.sourceTrackIds).toSorted(),
    visiblePersonIds: people.map((person) => person.sourcePersonId),
    candidatePersonIds: people.map((person) => person.sourcePersonId),
  };
  if (people.length === 0) {
    return {
      data: { ...common, status: 'offscreen', method: 'none', reason: 'no-visible-person' },
      confidence: Math.min(turnConfidence, 0.95),
    };
  }
  if (people.length === 1) {
    const person = people[0];
    if (person.verified) {
      return {
        data: {
          ...common,
          personId: person.sourcePersonId,
          status: 'onscreen',
          method: 'single-face',
          reason: 'single-verified-person',
        },
        confidence: Math.min(turnConfidence, person.confidence),
      };
    }
    return {
      data: { ...common, status: 'unknown', method: 'none', reason: 'single-unverified-person' },
      confidence: Math.min(turnConfidence, person.confidence, 0.5),
    };
  }

  const visibleIds = new Set(people.map((person) => person.sourcePersonId));
  const bestByPerson = new Map<string, MouthMotionCandidateInput>();
  for (const candidate of candidates) {
    if (candidate.turnId !== turn.id || !visibleIds.has(candidate.sourcePersonId)) continue;
    if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) continue;
    const previous = bestByPerson.get(candidate.sourcePersonId);
    if (!previous || candidate.score > previous.score
      || (candidate.score === previous.score && candidate.analyzerId.localeCompare(previous.analyzerId) < 0)) {
      bestByPerson.set(candidate.sourcePersonId, candidate);
    }
  }
  const ranked = [...bestByPerson.values()]
    .toSorted((left, right) => right.score - left.score || left.sourcePersonId.localeCompare(right.sourcePersonId));
  if (ranked.length < people.length) {
    return {
      data: { ...common, status: 'unknown', method: 'none', reason: 'multiple-visible-no-scores' },
      confidence: 0,
    };
  }
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (best.score < policy.mouthMotionMinimumScore) {
    return {
      data: { ...common, status: 'unknown', method: 'none', reason: 'mouth-score-below-threshold' },
      confidence: best.score,
    };
  }
  if (!runnerUp || best.score - runnerUp.score < policy.mouthMotionMinimumMargin) {
    return {
      data: { ...common, status: 'unknown', method: 'none', reason: 'mouth-score-margin-ambiguous' },
      confidence: runnerUp ? Math.max(0, best.score - runnerUp.score) : 0,
    };
  }
  const winner = people.find((person) => person.sourcePersonId === best.sourcePersonId);
  return {
    data: {
      ...common,
      personId: best.sourcePersonId,
      status: 'onscreen',
      method: 'mouth-motion',
      reason: 'mouth-motion-clear-winner',
    },
    confidence: Math.min(turnConfidence, best.score, winner?.confidence ?? 1),
    candidate: best,
  };
}

function applyManual(
  turn: SpeakerTurnInput,
  people: VisiblePerson[],
  annotation: ManualSpeakerPersonAnnotation,
): { data: SpeakerPersonFusionEventData; confidence: number } {
  const sourceTrackIds = people
    .filter((person) => person.sourcePersonId === annotation.sourcePersonId)
    .flatMap((person) => person.sourceTrackIds)
    .toSorted();
  return {
    data: {
      speakerId: turn.speakerId,
      personId: annotation.status === 'onscreen' ? annotation.sourcePersonId : undefined,
      status: annotation.status,
      method: 'manual',
      reason: 'manual-correction',
      candidatePersonIds: people.map((person) => person.sourcePersonId),
      visiblePersonIds: people.map((person) => person.sourcePersonId),
      sourceTrackIds,
    },
    confidence: 1,
  };
}

function segmentBoundaries(
  turn: SpeakerTurnInput,
  facePresence: FacePresenceInput[],
  annotations: ManualSpeakerPersonAnnotation[],
): number[] {
  const boundaries = new Set([turn.start, turn.end]);
  for (const range of [...facePresence, ...annotations]) {
    if (!validRange(range) || !overlaps(turn.start, turn.end, range)) continue;
    if (range.start > turn.start && range.start < turn.end) boundaries.add(range.start);
    if (range.end > turn.start && range.end < turn.end) boundaries.add(range.end);
  }
  return [...boundaries].sort((left, right) => left - right);
}

function eventId(turnId: string, start: number, end: number): string {
  return `active-speaker:${encodeURIComponent(turnId)}:${start.toString()}:${end.toString()}`;
}

export function fuseSpeakerPeople(input: FuseSpeakerPeopleInput): SpeakerPersonFusionResult {
  const policy: SpeakerFusionPolicy = { ...DEFAULT_SPEAKER_FUSION_POLICY, ...input.policy };
  const orphanedAnnotations: SpeakerPersonFusionResult['orphanedAnnotations'] = [];
  const annotations = (input.annotationLayers ?? []).flatMap((layer) => {
    if (sourceIdentitiesMatch(input.sourceIdentity, layer.sourceIdentity)) return layer.annotations;
    orphanedAnnotations.push(...layer.annotations.map((annotation) => ({
      annotation,
      reason: 'source-identity-mismatch' as const,
    })));
    return [];
  }).filter(validAnnotation).toSorted(compareAnnotations);

  const events: SpeakerPersonFusionEvent[] = [];
  for (const turn of input.turns.filter(validRange).toSorted((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id))) {
    const turnAnnotations = annotations.filter((annotation) => annotation.speakerId === turn.speakerId && overlaps(turn.start, turn.end, annotation));
    const boundaries = segmentBoundaries(turn, input.facePresence, turnAnnotations);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      const people = visiblePeopleAtSegment(input.facePresence, start, end);
      const applicableManual = turnAnnotations.filter((annotation) => overlaps(start, end, annotation)).at(-1);
      const automatic = classifyAutomatic(turn, people, input.mouthMotionCandidates ?? [], policy);
      const classification = applicableManual ? applyManual(turn, people, applicableManual) : automatic;
      const provenance: SpeakerPersonFusionEvent['provenance'] = applicableManual
        ? [{ kind: 'manual', annotationId: applicableManual.id, createdAt: applicableManual.createdAt }]
        : [{ kind: 'analyzer', analyzerId: 'speaker-person-fusion', analyzerVersion: policy.policyVersion }];
      if (!applicableManual && automatic.candidate) {
        provenance.push({
          kind: 'analyzer',
          analyzerId: automatic.candidate.analyzerId,
          analyzerVersion: automatic.candidate.analyzerVersion,
        });
      }
      events.push({
        schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
        id: eventId(turn.id, start, end),
        type: 'active-speaker',
        time: { temporalKind: 'interval', timeDomain: 'source', start, end },
        confidence: classification.confidence,
        provenance,
        data: classification.data,
      });
    }
  }
  return { policy, events, orphanedAnnotations };
}
