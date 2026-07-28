import { describe, expect, it } from 'vitest';
import {
  SOURCE_IDENTITY_SCHEMA_VERSION,
  type SourceIdentity,
} from '../../src/types/agentTimeline/sourceIdentity';
import {
  SPEAKER_PERSON_ANNOTATION_SCHEMA_VERSION,
  type FacePresenceInput,
  type MouthMotionCandidateInput,
  type SpeakerPersonAnnotationLayer,
  type SpeakerTurnInput,
} from '../../src/types/agentTimeline/speakerFusion';
import { fuseSpeakerPeople } from '../../src/services/agentTimeline/fusion/speakerPersonFusion';

const SOURCE: SourceIdentity = {
  type: 'source-identity',
  version: SOURCE_IDENTITY_SCHEMA_VERSION,
  strategy: 'sampled-chunks',
  hashAlgorithm: 'sha-256',
  hash: 'ab'.repeat(32),
  metadata: { size: 1_000, mediaType: 'video/mp4' },
};

const TURN: SpeakerTurnInput = {
  id: 'turn-1', speakerId: 'speaker-1', start: 0, end: 10, confidence: 0.94,
};

function face(
  sourcePersonId: string,
  start = 0,
  end = 10,
  verified = true,
  sourceTrackId = `track-${sourcePersonId}`,
): FacePresenceInput {
  return {
    id: `${sourceTrackId}:${start}:${end}`,
    sourcePersonId,
    sourceTrackId,
    start,
    end,
    confidence: 0.9,
    verified,
  };
}

function mouth(sourcePersonId: string, score: number): MouthMotionCandidateInput {
  return {
    turnId: TURN.id,
    sourcePersonId,
    score,
    analyzerId: 'existing-mouth-motion',
    analyzerVersion: '1.0.0',
  };
}

function annotations(sourceIdentity: SourceIdentity = SOURCE): SpeakerPersonAnnotationLayer {
  return {
    schemaVersion: SPEAKER_PERSON_ANNOTATION_SCHEMA_VERSION,
    sourceIdentity,
    annotations: [{
      id: 'manual-speaker-person',
      createdAt: '2026-07-26T20:00:00.000Z',
      speakerId: TURN.speakerId,
      start: 2,
      end: 6,
      status: 'onscreen',
      sourcePersonId: 'source-person-manual',
    }],
  };
}

describe('Agent Timeline cheap speaker/person fusion', () => {
  it('marks a turn with no visible person as offscreen', () => {
    const result = fuseSpeakerPeople({ sourceIdentity: SOURCE, turns: [TURN], facePresence: [] });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data).toMatchObject({
      speakerId: 'speaker-1', status: 'offscreen', method: 'none', reason: 'no-visible-person',
    });
  });

  it('assigns exactly one verified source-local person with single-face provenance', () => {
    const result = fuseSpeakerPeople({ sourceIdentity: SOURCE, turns: [TURN], facePresence: [face('source-person-a')] });
    expect(result.events[0]).toMatchObject({
      confidence: 0.9,
      data: {
        personId: 'source-person-a',
        status: 'onscreen',
        method: 'single-face',
        reason: 'single-verified-person',
        sourceTrackIds: ['track-source-person-a'],
      },
    });
    expect(result.events[0].data).not.toHaveProperty('projectPersonId');
  });

  it('keeps one unverified face and multiple faces without scores unknown', () => {
    const unverified = fuseSpeakerPeople({
      sourceIdentity: SOURCE, turns: [TURN], facePresence: [face('source-person-a', 0, 10, false)],
    });
    expect(unverified.events[0].data.reason).toBe('single-unverified-person');
    expect(unverified.events[0].data.status).toBe('unknown');

    const multiple = fuseSpeakerPeople({
      sourceIdentity: SOURCE,
      turns: [TURN],
      facePresence: [face('source-person-a'), face('source-person-b')],
    });
    expect(multiple.events[0].data).toMatchObject({ status: 'unknown', reason: 'multiple-visible-no-scores' });
  });

  it('splits half-open turns exactly when face visibility changes', () => {
    const result = fuseSpeakerPeople({
      sourceIdentity: SOURCE,
      turns: [TURN],
      facePresence: [face('source-person-a', 0, 5), face('source-person-b', 5, 10)],
    });
    expect(result.events.map((event) => ({ time: event.time, personId: event.data.personId }))).toEqual([
      {
        time: { temporalKind: 'interval', timeDomain: 'source', start: 0, end: 5 },
        personId: 'source-person-a',
      },
      {
        time: { temporalKind: 'interval', timeDomain: 'source', start: 5, end: 10 },
        personId: 'source-person-b',
      },
    ]);
  });

  it('requires a calibrated score and clear margin for mouth-motion assignment', () => {
    const presence = [face('source-person-a'), face('source-person-b')];
    const ambiguous = fuseSpeakerPeople({
      sourceIdentity: SOURCE,
      turns: [TURN],
      facePresence: presence,
      mouthMotionCandidates: [mouth('source-person-a', 0.84), mouth('source-person-b', 0.76)],
    });
    expect(ambiguous.events[0].data).toMatchObject({
      status: 'unknown', reason: 'mouth-score-margin-ambiguous',
    });

    const clear = fuseSpeakerPeople({
      sourceIdentity: SOURCE,
      turns: [TURN],
      facePresence: presence,
      mouthMotionCandidates: [mouth('source-person-a', 0.91), mouth('source-person-b', 0.42)],
    });
    expect(clear.events[0].data).toMatchObject({
      personId: 'source-person-a',
      status: 'onscreen',
      method: 'mouth-motion',
      reason: 'mouth-motion-clear-winner',
    });
    expect(clear.events[0].provenance).toHaveLength(2);
  });

  it('splits for and applies matching manual corrections after automatic classification', () => {
    const result = fuseSpeakerPeople({
      sourceIdentity: SOURCE,
      turns: [TURN],
      facePresence: [face('source-person-a')],
      annotationLayers: [annotations()],
    });
    expect(result.events.map((event) => [event.time.temporalKind === 'interval' ? event.time.start : -1, event.data.personId])).toEqual([
      [0, 'source-person-a'],
      [2, 'source-person-manual'],
      [6, 'source-person-a'],
    ]);
    expect(result.events[1]).toMatchObject({
      confidence: 1,
      provenance: [{ kind: 'manual', annotationId: 'manual-speaker-person' }],
      data: { method: 'manual', reason: 'manual-correction' },
    });
  });

  it('orphans source-mismatched manual mappings and ignores them', () => {
    const differentSource = { ...SOURCE, hash: 'cd'.repeat(32) };
    const layer = annotations(differentSource);
    const result = fuseSpeakerPeople({
      sourceIdentity: SOURCE,
      turns: [TURN],
      facePresence: [face('source-person-a')],
      annotationLayers: [layer],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data.personId).toBe('source-person-a');
    expect(result.orphanedAnnotations).toEqual([{
      annotation: layer.annotations[0], reason: 'source-identity-mismatch',
    }]);
  });

  it('is deterministic, non-mutating and deduplicates multiple tracks for one person', () => {
    const facePresence = [
      face('source-person-b'),
      face('source-person-a', 0, 10, true, 'track-a-2'),
      face('source-person-a', 0, 10, true, 'track-a-1'),
    ];
    const snapshot = structuredClone(facePresence);
    const candidates = [mouth('source-person-b', 0.2), mouth('source-person-a', 0.9)];
    const forward = fuseSpeakerPeople({ sourceIdentity: SOURCE, turns: [TURN], facePresence, mouthMotionCandidates: candidates });
    const reversed = fuseSpeakerPeople({
      sourceIdentity: SOURCE,
      turns: [TURN],
      facePresence: facePresence.toReversed(),
      mouthMotionCandidates: candidates.toReversed(),
    });
    expect(reversed).toEqual(forward);
    expect(facePresence).toEqual(snapshot);
    expect(forward.events[0].data.sourceTrackIds).toEqual(['track-a-1', 'track-a-2', 'track-source-person-b']);
  });
});
