import { describe, expect, it } from 'vitest';
import {
  compareAudioClassificationCandidates,
  deriveAudioClassifications,
  evaluateAudioClassificationPromotionGate,
  persistedAudioHeuristicClassifier,
} from '../../src/services/agentTimeline/derivations/audioClassification';
import type {
  AudioClassificationClassifier,
  AudioClassificationInput,
  AudioClassificationPromotionPolicy,
} from '../../src/types/agentTimeline/audioClassification';

const INPUT: AudioClassificationInput = {
  sourceId: 'source-a',
  timeDomain: 'source',
  range: { start: 0, end: 7 },
  features: [
    { start: 0, end: 1, loudnessDb: -18, spectralFlatness: .35 },
    { start: 1, end: 2, loudnessDb: -18, spectralFlatness: .35 },
    { start: 2, end: 3, loudnessDb: -20, spectralFlatness: .3, lowFrequencyRatio: .6, onsetRateHz: 3 },
    { start: 3, end: 4, loudnessDb: -20, spectralFlatness: .82, highFrequencyRatio: .7 },
    { start: 4, end: 5, loudnessDb: -20, spectralFlatness: .58, onsetRateHz: 6 },
    { start: 5, end: 6, loudnessDb: -24 },
    { start: 6, end: 7, loudnessDb: -40, spectralFlatness: .45, onsetRateHz: .1 },
  ],
  transcript: [{ start: 0, end: 2, confidence: .9 }],
  provenance: {
    analyzerId: 'persisted-audio-features',
    analyzerVersion: '1.1.0',
    artifactRefs: ['onsets-b', 'frequency-a', 'loudness-c'],
  },
};

const POLICY: AudioClassificationPromotionPolicy = {
  minimumAccuracyGain: .1,
  minimumMacroF1Gain: .1,
  maximumRuntimeRatio: 2,
  maximumPeakMemoryBytes: 100_000_000,
  maximumArtifactBytesPerMediaMinute: 20_000,
  maximumDownloadBytes: 2_000_000,
  requiredPlatforms: ['windows', 'linux-mesa'],
  requiredScenarios: ['interview-music-noise'],
};

const exactCandidate: AudioClassificationClassifier = {
  metadata: {
    id: 'candidate-model',
    version: '7.0.0',
    classMappingVersion: '1.0.0',
    kind: 'model',
    modelId: 'candidate-model',
    modelVersion: '7.0.0',
  },
  classify(input) {
    return [
      { start: input.range.start, end: input.range.start + 2, label: 'speech', confidence: .9 },
      { start: input.range.start + 2, end: input.range.end, label: 'music', confidence: .9 },
    ];
  },
};

const unknownCandidate: AudioClassificationClassifier = {
  metadata: { id: 'unknown', version: '1.0.0', classMappingVersion: '1.0.0', kind: 'heuristic' },
  classify(input) {
    return [{ ...input.range, label: 'unknown', confidence: .2 }];
  },
};

describe('Agent Timeline optional audio classification', () => {
  it('classifies persisted summaries deterministically and merges only adjacent same-label spans', () => {
    const before = JSON.stringify(INPUT);
    const result = deriveAudioClassifications(INPUT);

    expect(result.spans).toEqual([
      expect.objectContaining({ start: 0, end: 2, label: 'speech' }),
      expect.objectContaining({ start: 2, end: 3, label: 'music' }),
      expect.objectContaining({ start: 3, end: 4, label: 'noise' }),
      expect.objectContaining({ start: 4, end: 5, label: 'applause' }),
      expect.objectContaining({ start: 5, end: 6, label: 'unknown' }),
      expect.objectContaining({ start: 6, end: 7, label: 'ambience' }),
    ]);
    expect(result.events.find(event => event.data.activity === 'unknown')).toBeDefined();
    expect(result.events[0]?.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ analyzerId: 'persisted-audio-features', artifactRef: 'frequency-a' }),
      expect.objectContaining({ analyzerId: 'persisted-audio-heuristic' }),
    ]));
    expect(JSON.stringify(INPUT)).toBe(before);
  });

  it('clips injected classifier spans to the requested half-open range and never fills gaps', () => {
    const result = deriveAudioClassifications({ ...INPUT, range: { start: 2, end: 4 } }, {
      classifier: {
        metadata: { id: 'injected', version: '1', classMappingVersion: '1', kind: 'model' },
        classify: () => [
          { start: 1, end: 2, label: 'music', confidence: .9 },
          { start: 2, end: 3, label: 'music', confidence: .9 },
          { start: 3.1, end: 5, label: 'music', confidence: .8 },
        ],
      },
    });
    expect(result.spans).toEqual([
      { start: 2, end: 3, label: 'music', confidence: .9 },
      { start: 3.1, end: 4, label: 'music', confidence: .8 },
    ]);
  });

  it('compares dependency-injected candidates against labelled local references without loading a model', () => {
    const comparison = compareAudioClassificationCandidates(unknownCandidate, exactCandidate, [{
      id: 'labelled-case',
      input: { ...INPUT, range: { start: 0, end: 4 } },
      expected: [
        { start: 0, end: 2, label: 'speech', confidence: 1 },
        { start: 2, end: 4, label: 'music', confidence: 1 },
      ],
    }]);
    expect(comparison.accuracyGain).toBe(1);
    expect(comparison.macroF1Gain).toBeGreaterThan(.9);
    expect(comparison.candidate.classifier.id).toBe('candidate-model');
  });

  it('requires measured real-media runtime, memory, artifact, and download evidence before promotion', () => {
    const comparison = compareAudioClassificationCandidates(unknownCandidate, exactCandidate, [{
      id: 'labelled-case',
      input: { ...INPUT, range: { start: 0, end: 4 } },
      expected: [
        { start: 0, end: 2, label: 'speech', confidence: 1 },
        { start: 2, end: 4, label: 'music', confidence: 1 },
      ],
    }]);
    const missing = evaluateAudioClassificationPromotionGate(comparison, [], POLICY);
    expect(missing.passed).toBe(false);
    expect(missing.failures.map(failure => failure.code)).toContain('missing-real-runtime-evidence');

    const evidence = ['windows', 'linux-mesa'].flatMap(platform => (
      ['cold', 'warm'] as const
    ).map(cacheState => ({
      id: `${platform}-${cacheState}-real`,
      classifierId: 'candidate-model',
      classifierVersion: '7.0.0',
      platform,
      scenarioId: 'interview-music-noise',
      realMedia: true,
      cacheState,
      sourceDurationSeconds: 60,
      wallTimeSeconds: 8,
      baselineWallTimeSeconds: 5,
      peakMemoryBytes: 20_000_000,
      artifactBytes: 10_000,
      downloadBytes: 1_000_000,
      downloadEvidence: 'measured-download' as const,
      redundantDecodedSeconds: 0,
    })));
    expect(evaluateAudioClassificationPromotionGate(comparison, evidence, POLICY)).toEqual({
      passed: true,
      failures: [],
    });
    const redecoded = evidence.map(item => item.cacheState === 'warm'
      ? { ...item, redundantDecodedSeconds: 1 }
      : item);
    expect(evaluateAudioClassificationPromotionGate(comparison, redecoded, POLICY).failures
      .map(failure => failure.code)).toContain('warm-cache-redecoded');
  });

  it('enforces source/rendered time-domain identity requirements', () => {
    expect(() => deriveAudioClassifications({ ...INPUT, stateHash: 'not-source' })).toThrow('must not carry');
    expect(() => deriveAudioClassifications({ ...INPUT, timeDomain: 'clip-rendered' })).toThrow('require a stateHash');
    expect(deriveAudioClassifications(INPUT, { classifier: persistedAudioHeuristicClassifier }).events).toHaveLength(6);
  });
});
