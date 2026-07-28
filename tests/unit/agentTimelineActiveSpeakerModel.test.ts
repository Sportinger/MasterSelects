import { describe, expect, it } from 'vitest';
import {
  compareActiveSpeakerModelResults,
  evaluateActiveSpeakerModelPromotionGate,
  planActiveSpeakerRoiCandidates,
} from '../../src/services/agentTimeline/fusion/activeSpeakerModel';
import { fuseSpeakerPeople } from '../../src/services/agentTimeline/fusion/speakerPersonFusion';
import {
  SOURCE_IDENTITY_SCHEMA_VERSION,
  type SourceIdentity,
} from '../../src/types/agentTimeline/sourceIdentity';
import type {
  ActiveSpeakerLocalRoiModel,
  ActiveSpeakerLocalRoiModelMetadata,
  ActiveSpeakerModelPromotionPolicy,
} from '../../src/types/agentTimeline/activeSpeakerModel';

const SOURCE: SourceIdentity = {
  type: 'source-identity',
  version: SOURCE_IDENTITY_SCHEMA_VERSION,
  strategy: 'sampled-chunks',
  hashAlgorithm: 'sha-256',
  hash: 'ab'.repeat(32),
  metadata: { size: 1_000, mediaType: 'video/mp4' },
};

const REQUIREMENTS = {
  maxAudioVideoSkewMilliseconds: 40,
  minCandidateRateHz: 12,
  maxCandidateRateHz: 30,
};

const MODEL: ActiveSpeakerLocalRoiModelMetadata = {
  id: 'local-active-speaker',
  version: '1.0.0',
  capabilities: {
    format: 'onnx', webgpu: true, wasm: true, cpuFallback: true,
    license: 'Apache-2.0', modelBytes: 4_000_000,
  },
};

const POLICY: ActiveSpeakerModelPromotionPolicy = {
  minimumAccuracyGain: .1,
  maximumRuntimeRatio: 2,
  maximumPeakMemoryBytes: 100_000_000,
  maximumArtifactBytesPerMediaMinute: 20_000,
  maximumDownloadBytes: 5_000_000,
  requiredPlatforms: ['windows', 'linux-mesa'],
  requiredScenarios: ['multi-person-dialogue'],
  requireWebGpu: true,
  requireWasm: true,
  requireCpuFallback: true,
};

function ambiguousFusionEvents() {
  return fuseSpeakerPeople({
    sourceIdentity: SOURCE,
    turns: [{ id: 'turn-1', speakerId: 'speaker-1', start: 0, end: 4, confidence: .9 }],
    facePresence: [
      { id: 'a', sourcePersonId: 'person-a', sourceTrackId: 'track-a', start: 0, end: 4, confidence: .9, verified: true },
      { id: 'b', sourcePersonId: 'person-b', sourceTrackId: 'track-b', start: 0, end: 4, confidence: .9, verified: true },
    ],
  }).events;
}

describe('Agent Timeline optional active-speaker model gate', () => {
  it('plans bounded ROI candidates only from ambiguous multi-person heuristic speech spans', () => {
    const plan = planActiveSpeakerRoiCandidates({
      heuristicEvents: ambiguousFusionEvents(), candidateRateHz: 20,
      measuredAudioVideoSkewMilliseconds: 12, requirements: REQUIREMENTS,
    });
    expect(plan.candidates).toEqual([expect.objectContaining({
      start: 0, end: 4, sourcePersonIds: ['person-a', 'person-b'], candidateRateHz: 20,
    })]);

    const noSync = planActiveSpeakerRoiCandidates({
      heuristicEvents: ambiguousFusionEvents(), candidateRateHz: 20, requirements: REQUIREMENTS,
    });
    expect(noSync.candidates).toEqual([]);
    expect(noSync.skipped[0]).toMatchObject({ reason: 'av-sync-not-measured' });

    const singleFace = fuseSpeakerPeople({
      sourceIdentity: SOURCE,
      turns: [{ id: 'turn-2', speakerId: 'speaker-1', start: 0, end: 4, confidence: .9 }],
      facePresence: [{ id: 'a', sourcePersonId: 'person-a', sourceTrackId: 'track-a', start: 0, end: 4, confidence: .9, verified: true }],
    }).events;
    expect(planActiveSpeakerRoiCandidates({
      heuristicEvents: singleFace, candidateRateHz: 20, measuredAudioVideoSkewMilliseconds: 0, requirements: REQUIREMENTS,
    }).candidates).toEqual([]);
  });

  it('uses a local, ephemeral ROI model contract without persisting raw frames', async () => {
    const candidate = planActiveSpeakerRoiCandidates({
      heuristicEvents: ambiguousFusionEvents(), candidateRateHz: 20, measuredAudioVideoSkewMilliseconds: 0, requirements: REQUIREMENTS,
    }).candidates[0];
    const model: ActiveSpeakerLocalRoiModel = {
      metadata: MODEL,
      async infer(input, rois) {
        expect(rois.persistence).toBe('ephemeral-memory');
        return [{ candidateId: input.id, status: 'onscreen', sourcePersonId: 'person-a', confidence: .8 }];
      },
    };
    await expect(model.infer(candidate, { persistence: 'ephemeral-memory', sampleCount: () => 3 }))
      .resolves.toEqual([expect.objectContaining({ sourcePersonId: 'person-a' })]);
  });

  it('compares explicitly labelled heuristic and model results, normalizing invalid model claims to unknown', () => {
    const candidate = planActiveSpeakerRoiCandidates({
      heuristicEvents: ambiguousFusionEvents(), candidateRateHz: 20, measuredAudioVideoSkewMilliseconds: 0, requirements: REQUIREMENTS,
    }).candidates[0];
    const comparison = compareActiveSpeakerModelResults([
      {
        id: 'case-a', candidate,
        expected: { status: 'onscreen', sourcePersonId: 'person-a' },
        heuristic: { candidateId: candidate.id, status: 'unknown', confidence: .3 },
        model: { candidateId: candidate.id, status: 'onscreen', sourcePersonId: 'person-a', confidence: .8 },
      },
      {
        id: 'case-b', candidate,
        expected: { status: 'unknown' },
        heuristic: { candidateId: candidate.id, status: 'unknown', confidence: .5 },
        model: { candidateId: candidate.id, status: 'onscreen', sourcePersonId: 'not-visible', confidence: .9 },
      },
    ], MODEL);
    expect(comparison).toMatchObject({ heuristic: { accuracy: .5 }, model: { accuracy: 1 }, accuracyGain: .5 });
  });

  it('refuses promotion without measured real cold/warm candidate-only evidence', () => {
    const candidate = planActiveSpeakerRoiCandidates({
      heuristicEvents: ambiguousFusionEvents(), candidateRateHz: 20, measuredAudioVideoSkewMilliseconds: 0, requirements: REQUIREMENTS,
    }).candidates[0];
    const comparison = compareActiveSpeakerModelResults([{
      id: 'case-a', candidate,
      expected: { status: 'onscreen', sourcePersonId: 'person-a' },
      heuristic: { candidateId: candidate.id, status: 'unknown', confidence: .3 },
      model: { candidateId: candidate.id, status: 'onscreen', sourcePersonId: 'person-a', confidence: .8 },
    }], MODEL);
    const missing = evaluateActiveSpeakerModelPromotionGate(MODEL, comparison, [], POLICY);
    expect(missing.passed).toBe(false);
    expect(missing.failures.map(failure => failure.code)).toContain('missing-real-runtime-evidence');

    const evidence = ['windows', 'linux-mesa'].flatMap(platform => ['cold', 'warm'].map(cacheState => ({
      id: `${platform}-${cacheState}`, modelId: MODEL.id, modelVersion: MODEL.version,
      platform, scenarioId: 'multi-person-dialogue', cacheState: cacheState as 'cold' | 'warm',
      realMedia: true, candidateOnly: true, sourceDurationSeconds: 60, candidateDurationSeconds: 4,
      wallTimeSeconds: cacheState === 'cold' ? 8 : 2, baselineWallTimeSeconds: 5,
      peakMemoryBytes: 20_000_000, artifactBytes: 1_000, downloadBytes: 4_000_000,
      downloadEvidence: 'measured-download' as const,
      redundantDecodedSeconds: 0,
    })));
    expect(evaluateActiveSpeakerModelPromotionGate(MODEL, comparison, evidence, POLICY)).toEqual({ passed: true, failures: [] });
    const redecoded = evidence.map(item => item.cacheState === 'warm'
      ? { ...item, redundantDecodedSeconds: 1 }
      : item);
    expect(evaluateActiveSpeakerModelPromotionGate(MODEL, comparison, redecoded, POLICY)
      .failures.map(failure => failure.code)).toContain('warm-cache-redecoded');
    expect(evaluateActiveSpeakerModelPromotionGate(MODEL, comparison, [{ ...evidence[0], candidateOnly: false }], {
      ...POLICY, requiredPlatforms: ['windows'],
    }).failures.map(failure => failure.code)).toContain('continuous-full-video-run');
  });
});
