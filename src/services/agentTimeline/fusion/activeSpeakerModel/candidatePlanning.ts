import {
  ACTIVE_SPEAKER_MODEL_SCHEMA_VERSION,
  type ActiveSpeakerCandidatePlan,
  type ActiveSpeakerCandidatePlanningInput,
  type ActiveSpeakerCandidateSkipReason,
  type ActiveSpeakerRoiCandidate,
} from '../../../../types/agentTimeline/activeSpeakerModel';

const AMBIGUOUS_REASONS = new Set([
  'multiple-visible-no-scores',
  'mouth-score-below-threshold',
  'mouth-score-margin-ambiguous',
]);

function validRequirements(input: ActiveSpeakerCandidatePlanningInput): boolean {
  const requirements = input.requirements;
  return Number.isFinite(requirements.maxAudioVideoSkewMilliseconds)
    && requirements.maxAudioVideoSkewMilliseconds >= 0
    && Number.isFinite(requirements.minCandidateRateHz)
    && Number.isFinite(requirements.maxCandidateRateHz)
    && requirements.minCandidateRateHz > 0
    && requirements.maxCandidateRateHz >= requirements.minCandidateRateHz;
}

function skippedReason(input: ActiveSpeakerCandidatePlanningInput): ActiveSpeakerCandidateSkipReason | undefined {
  if (input.measuredAudioVideoSkewMilliseconds === undefined) return 'av-sync-not-measured';
  if (!Number.isFinite(input.measuredAudioVideoSkewMilliseconds)
    || Math.abs(input.measuredAudioVideoSkewMilliseconds) > input.requirements.maxAudioVideoSkewMilliseconds) {
    return 'av-sync-out-of-budget';
  }
  if (!Number.isFinite(input.candidateRateHz)
    || input.candidateRateHz < input.requirements.minCandidateRateHz
    || input.candidateRateHz > input.requirements.maxCandidateRateHz) return 'candidate-rate-out-of-budget';
  return undefined;
}

/** Plans model work only for unknown, multi-person results from the existing heuristic fusion. */
export function planActiveSpeakerRoiCandidates(
  input: ActiveSpeakerCandidatePlanningInput,
): ActiveSpeakerCandidatePlan {
  if (!validRequirements(input)) throw new RangeError('Active-speaker A/V requirements are invalid');
  const gateReason = skippedReason(input);
  const candidates: ActiveSpeakerRoiCandidate[] = [];
  const skipped: ActiveSpeakerCandidatePlan['skipped'][number][] = [];
  for (const event of input.heuristicEvents.toSorted((left, right) => left.id.localeCompare(right.id))) {
    const time = event.time;
    const ambiguous = time.temporalKind === 'interval'
      && time.timeDomain === 'source'
      && event.data.status === 'unknown'
      && event.data.visiblePersonIds.length >= 2
      && AMBIGUOUS_REASONS.has(event.data.reason);
    if (!ambiguous) {
      skipped.push({ fusionEventId: event.id, reason: 'not-ambiguous-multi-person-speech' });
      continue;
    }
    if (gateReason) {
      skipped.push({ fusionEventId: event.id, reason: gateReason });
      continue;
    }
    candidates.push({
      id: `active-speaker-roi:${encodeURIComponent(event.id)}`,
      fusionEventId: event.id,
      turnId: event.id.split(':')[1] ?? event.id,
      speakerId: event.data.speakerId,
      start: time.start,
      end: time.end,
      sourcePersonIds: [...new Set(event.data.visiblePersonIds)].toSorted(),
      sourceTrackIds: [...new Set(event.data.sourceTrackIds)].toSorted(),
      candidateRateHz: input.candidateRateHz,
      measuredAudioVideoSkewMilliseconds: input.measuredAudioVideoSkewMilliseconds as number,
    });
  }
  return { schemaVersion: ACTIVE_SPEAKER_MODEL_SCHEMA_VERSION, candidates, skipped };
}
