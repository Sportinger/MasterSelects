import { describe, expect, it } from 'vitest';
import { deriveQualityAudioEvents } from '../../src/services/agentTimeline/derivations/qualityAudio/deriveQualityAudioEvents';
import type {
  QualityAudioDerivationInput,
  QualityMeasurementSample,
} from '../../src/types/agentTimeline/qualityAudioDerivations';

const PROVENANCE = {
  analyzerId: 'persisted-metrics',
  analyzerVersion: '2.1.0',
  artifactRefs: ['artifact-b', 'artifact-a'],
} as const;

function baseInput(overrides: Partial<QualityAudioDerivationInput> = {}): QualityAudioDerivationInput {
  return {
    sourceId: 'source-a',
    timeDomain: 'source',
    range: { start: 0, end: 6 },
    ...overrides,
  };
}

function qualitySamples(): QualityMeasurementSample[] {
  return [
    { time: 0, brightness: .01, focus: .1, frameHash: 'a', confidence: .9 },
    { time: 1, brightness: .02, focus: .2, frameHash: 'a', confidence: .85 },
    { time: 2, brightness: .1, focus: .5, frameHash: 'a', confidence: .8 },
    { time: 3, brightness: .5, focus: .5, frameHash: 'b' },
    { time: 4, brightness: .97, focus: .5, frameHash: 'c' },
    { time: 5, brightness: .5, focus: .5, frameHash: 'd' },
  ];
}

describe('cheap Agent Timeline quality/audio derivations', () => {
  it('derives black, exposure, focus and freeze spans from existing samples', () => {
    const input = baseInput({
      quality: {
        samples: qualitySamples(),
        coverage: [{ start: 0, end: 6 }],
        provenance: PROVENANCE,
      },
      thresholds: {
        qualitySampleDuration: 1,
        qualityMinIssueDuration: .5,
        freezeMinDuration: 2,
      },
    });
    const before = JSON.stringify(input);
    const result = deriveQualityAudioEvents(input);
    const issues = result.events.filter(event => event.type === 'quality-issue');

    expect(issues.map(event => ({
      issue: event.data.issue,
      start: event.time.temporalKind === 'interval' ? event.time.start : -1,
      end: event.time.temporalKind === 'interval' ? event.time.end : -1,
      unit: event.data.unit,
    }))).toEqual([
      { issue: 'black', start: 0, end: 2, unit: 'normalized-brightness' },
      { issue: 'focus', start: 0, end: 2, unit: 'normalized-focus' },
      { issue: 'freeze', start: 0, end: 3, unit: 'normalized-frame-difference' },
      { issue: 'exposure', start: 2, end: 3, unit: 'normalized-brightness-under' },
      { issue: 'exposure', start: 4, end: 5, unit: 'normalized-brightness-over' },
    ]);
    expect(issues[0].provenance.map(item => item.kind === 'analyzer' ? item.artifactRef : undefined))
      .toEqual(['artifact-a', 'artifact-b']);
    expect(result.coverage.black.status).toBe('complete');
    expect(result.coverage.freeze.status).toBe('complete');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('is deterministic for shuffled immutable sample inputs', () => {
    const samples = qualitySamples();
    const normal = deriveQualityAudioEvents(baseInput({
      quality: { samples, provenance: PROVENANCE },
      thresholds: { qualitySampleDuration: 1, freezeMinDuration: 2 },
    }));
    const shuffled = deriveQualityAudioEvents(baseInput({
      quality: { samples: samples.toReversed(), provenance: PROVENANCE },
      thresholds: { qualitySampleDuration: 1, freezeMinDuration: 2 },
    }));

    expect(shuffled.events).toEqual(normal.events);
    expect(shuffled.coverage).toEqual(normal.coverage);
  });

  it('derives loudness/peak measurements and supplied silence/transient events only', () => {
    const result = deriveQualityAudioEvents(baseInput({
      audio: {
        measurements: [
          { start: 0, end: 1, loudnessDb: -20, peakDb: -3, confidence: .95 },
          { start: 1, end: 2, loudnessDb: -55, peakDb: -.05, confidence: .9 },
          { start: 2, end: 3, loudnessDb: -56, peakDb: 0, confidence: .9 },
        ],
        silenceRanges: [{ start: 3, end: 6, rmsDb: -80, confidence: .92 }],
        transientRanges: [{ start: .5, end: .6, peakDb: -1, rmsDb: -30, crestDb: 29 }],
        coverage: [{ start: 0, end: 6 }],
        provenance: PROVENANCE,
      },
      thresholds: {
        clippingPeakDb: -.1,
        quietLoudnessDb: -50,
        quietMinDuration: 1,
        unexpectedSilenceMinDuration: 2,
      },
    }));
    const audio = result.events.filter(event => event.type === 'audio-activity');
    const quality = result.events.filter(event => event.type === 'quality-issue');

    expect(audio.map(event => event.data.activity)).toEqual([
      'unknown', 'transient', 'unknown', 'unknown', 'silence',
    ]);
    expect(quality.map(event => event.data.issue).toSorted()).toEqual(['clipping', 'quiet', 'silence']);
    expect(quality.find(event => event.data.issue === 'clipping')?.data.measurement).toBe(0);
    expect(result.coverage.loudness).toMatchObject({
      status: 'partial',
      covered: [{ start: 0, end: 3 }],
      missing: [{ start: 3, end: 6 }],
    });
    expect(result.coverage.silence.status).toBe('complete');
    expect(result.coverage.transient.status).toBe('complete');
  });

  it('distinguishes missing, unknown, and evaluated-empty coverage honestly', () => {
    const missing = deriveQualityAudioEvents(baseInput());
    expect(Object.values(missing.coverage).every(item => item.status === 'missing')).toBe(true);

    const partial = deriveQualityAudioEvents(baseInput({
      quality: {
        samples: [{ time: 0, focus: .9 }],
        provenance: PROVENANCE,
      },
      audio: {
        silenceRanges: [],
        coverage: [{ start: 0, end: 6 }],
        provenance: PROVENANCE,
      },
      thresholds: { qualitySampleDuration: 1 },
    }));
    expect(partial.coverage.focus.status).toBe('partial');
    expect(partial.coverage.black.status).toBe('unknown');
    expect(partial.coverage.freeze.status).toBe('unknown');
    expect(partial.coverage.silence.status).toBe('complete');
    expect(partial.coverage.transient.status).toBe('unknown');
    expect(partial.events).toEqual([]);
  });

  it('clips all supplied ranges with exact half-open semantics', () => {
    const result = deriveQualityAudioEvents(baseInput({
      range: { start: 2, end: 4 },
      audio: {
        measurements: [
          { start: 1, end: 2, loudnessDb: -20 },
          { start: 2, end: 3, loudnessDb: -20 },
          { start: 3.5, end: 4.5, loudnessDb: -20 },
          { start: 4, end: 5, loudnessDb: -20 },
        ],
        provenance: PROVENANCE,
      },
    }));

    expect(result.events.map(event => event.time)).toEqual([
      { temporalKind: 'interval', timeDomain: 'source', start: 2, end: 3 },
      { temporalKind: 'interval', timeDomain: 'source', start: 3.5, end: 4 },
    ]);
  });

  it('requires state hashes only for rendered-time derivations and validates thresholds', () => {
    expect(() => deriveQualityAudioEvents(baseInput({
      timeDomain: 'clip-rendered',
    }))).toThrow('require a stateHash');
    expect(() => deriveQualityAudioEvents(baseInput({
      stateHash: 'unexpected',
    }))).toThrow('must not carry');
    expect(() => deriveQualityAudioEvents(baseInput({
      thresholds: {
        blackBrightnessMax: .4,
        underexposedBrightnessMax: .2,
      },
    }))).toThrow('Brightness thresholds');

    const rendered = deriveQualityAudioEvents(baseInput({
      timeDomain: 'composition-rendered',
      stateHash: 'state-a',
      audio: {
        measurements: [{ start: 0, end: 1, loudnessDb: -20 }],
        provenance: PROVENANCE,
      },
    }));
    expect(rendered.events[0].time).toMatchObject({
      timeDomain: 'composition-rendered',
      stateHash: 'state-a',
    });
  });
});
