import { describe, expect, it } from 'vitest';
import { evaluateAgentTimelineBenchmarkGate } from '../../src/services/agentTimeline/benchmark/analysisBenchmarkGate';
import {
  buildRealMediaReport,
  cacheInstructions,
  createRealMediaEvidence,
  normalizeRunnerMeasurement,
  toBenchmarkGateMeasurement,
} from '../../scripts/agent-timeline/realMediaBenchmark.mjs';

const expected = {
  cacheState: 'cold' as const, channels: ['cuts'], profile: 'balanced' as const,
  pass: 'analysis' as const, baselineKind: 'standalone-cut' as const,
};
const media = { name: 'licensed-local.mp4', sizeBytes: 1234, sha256: 'ab'.repeat(32) };

function runner(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'agent-timeline-real-media-benchmark/v1',
    kind: 'agent-timeline-local-analysis-pass', status: 'completed', localOnly: true, networkUsed: false, cloudUsed: false,
    cacheStateObserved: 'cold', cacheResetConfirmed: true, channels: ['cuts'], profile: 'balanced',
    pass: 'analysis', baselineKind: 'standalone-cut',
    platform: 'windows-chromium', deviceClass: 'desktop-rdna', elapsedMs: 2000,
    peakMemoryBytes: 200_000_000, artifactBytes: 10_000, redundantDecodedSeconds: 0,
    ...overrides,
  };
}

describe('Agent Timeline real-media benchmark collector core', () => {
  it('turns measured local cold evidence into the existing production-gate DTO', () => {
    const evidence = createRealMediaEvidence({
      media, durationSeconds: 60, scenarioId: 'short-interview', profile: 'balanced', analyzer: 'cuts', baselineKind: 'standalone-cut', cacheState: 'cold',
      baseline: runner({ pass: 'baseline', elapsedMs: 1000 }), analysis: runner(), collectedAt: '2026-07-27T12:00:00.000Z',
    });
    expect(evidence.synthetic).toBe(false);
    expect(evidence.elapsedRatio).toBe(2);
    const measurement = toBenchmarkGateMeasurement(evidence);
    expect(measurement).toMatchObject({ realMedia: true, wallTimeSeconds: 2, baselineWallTimeSeconds: 1 });
    const gate = evaluateAgentTimelineBenchmarkGate({
      profile: 'balanced', channel: 'cuts', baselineKind: 'standalone-cut', requiredPlatforms: ['windows-chromium'], requiredScenarios: ['short-interview'],
      maximumPeakMemoryBytes: 300_000_000, maximumArtifactBytesPerMediaMinute: 20_000,
    }, [measurement!]);
    expect(gate.passed).toBe(false); // Cold alone deliberately cannot satisfy the warm-cache gate.
    expect(gate.failures).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing-cache-state', cacheState: 'warm' })]));
  });

  it('rejects network/cloud use and dishonest warm-cache decode claims', () => {
    expect(() => normalizeRunnerMeasurement(runner({ networkUsed: true }), expected)).toThrow('local-only');
    expect(() => normalizeRunnerMeasurement(runner({ cacheStateObserved: 'warm', cacheResetConfirmed: false, redundantDecodedSeconds: 1 }), {
      ...expected, cacheState: 'warm',
    })).toThrow('redundantDecodedSeconds=0');
  });

  it('keeps incomplete observability visible but non-qualifying instead of inventing zeroes', () => {
    const evidence = createRealMediaEvidence({
      media, durationSeconds: 60, scenarioId: 'short-interview', profile: 'quick', analyzer: 'cuts', baselineKind: 'standalone-cut', cacheState: 'cold',
      baseline: runner({ profile: 'quick', pass: 'baseline', peakMemoryBytes: null, artifactBytes: null, elapsedMs: 1000 }),
      analysis: runner({ profile: 'quick', peakMemoryBytes: null, artifactBytes: null }),
    });
    expect(evidence.gateEligible).toBe(false);
    expect(toBenchmarkGateMeasurement(evidence)).toBeNull();
    expect(buildRealMediaReport([evidence]).summary).toMatchObject({ totalEvidence: 1, gateEligibleEvidence: 0, nonQualifyingEvidence: 1 });
  });

  it('makes the manual cold/warm reset protocol explicit', () => {
    expect(cacheInstructions('cold')).toContain('wait 5 seconds after reload');
    expect(cacheInstructions('warm')).toContain('redundantDecodedSeconds=0');
  });
});
