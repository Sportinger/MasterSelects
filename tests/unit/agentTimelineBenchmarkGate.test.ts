import { describe, expect, it } from 'vitest';
import { evaluateAgentTimelineBenchmarkGate } from '../../src/services/agentTimeline/benchmark/analysisBenchmarkGate';
import type {
  AgentTimelineBenchmarkGatePolicy,
  AgentTimelineBenchmarkMeasurement,
} from '../../src/types/agentTimeline/benchmarkGate';

const policy: AgentTimelineBenchmarkGatePolicy = {
  profile: 'balanced',
  channel: 'text',
  baselineKind: 'standalone-cut',
  requiredPlatforms: ['windows', 'linux-mesa'],
  requiredScenarios: ['ocr-titles'],
  maximumPeakMemoryBytes: 500_000_000,
  maximumArtifactBytesPerMediaMinute: 100_000,
};

function measurement(
  id: string,
  platform: string,
  cacheState: 'cold' | 'warm',
  overrides: Partial<AgentTimelineBenchmarkMeasurement> = {},
): AgentTimelineBenchmarkMeasurement {
  return {
    id,
    realMedia: true,
    profile: 'balanced',
    channels: ['text'],
    platform,
    deviceClass: 'fixture',
    scenarioId: 'ocr-titles',
    cacheState,
    baselineKind: 'standalone-cut',
    baselinePlatform: platform,
    baselineDeviceClass: 'fixture',
    sourceDurationSeconds: 60,
    wallTimeSeconds: 8,
    baselineWallTimeSeconds: 5,
    peakMemoryBytes: 200_000_000,
    artifactBytes: 50_000,
    redundantDecodedSeconds: 0,
    ...overrides,
  };
}

describe('Agent Timeline benchmark gate', () => {
  it('passes only complete real cold/warm platform evidence within budget', () => {
    const result = evaluateAgentTimelineBenchmarkGate(policy, [
      measurement('win-cold', 'windows', 'cold'),
      measurement('win-warm', 'windows', 'warm', { wallTimeSeconds: 1 }),
      measurement('mesa-cold', 'linux-mesa', 'cold'),
      measurement('mesa-warm', 'linux-mesa', 'warm', { wallTimeSeconds: 1 }),
    ]);
    expect(result.passed).toBe(true);
    expect(result.allowedRuntimeRatio).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it('never accepts synthetic evidence as a production unlock', () => {
    const result = evaluateAgentTimelineBenchmarkGate({
      ...policy,
      requiredPlatforms: ['windows'],
    }, [
      measurement('synthetic-cold', 'windows', 'cold', { realMedia: false }),
      measurement('synthetic-warm', 'windows', 'warm', { realMedia: false }),
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain('missing-real-measurement');
  });

  it('reports missing cache/platform combinations explicitly', () => {
    const result = evaluateAgentTimelineBenchmarkGate(policy, [
      measurement('win-cold', 'windows', 'cold'),
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-cache-state', platform: 'windows', cacheState: 'warm' }),
      expect.objectContaining({ code: 'missing-real-measurement', platform: 'linux-mesa' }),
    ]));
  });

  it('enforces runtime, memory, artifact, and warm-cache decode budgets', () => {
    const result = evaluateAgentTimelineBenchmarkGate({
      ...policy,
      requiredPlatforms: ['windows'],
    }, [
      measurement('cold', 'windows', 'cold', {
        wallTimeSeconds: 11,
        peakMemoryBytes: 600_000_000,
        artifactBytes: 120_000,
      }),
      measurement('warm', 'windows', 'warm', {
        redundantDecodedSeconds: 2,
      }),
    ]);
    expect(result.failures.map((failure) => failure.code)).toEqual(expect.arrayContaining([
      'runtime-budget-exceeded',
      'memory-budget-exceeded',
      'artifact-budget-exceeded',
      'warm-cache-redecoded',
    ]));
  });

  it('rejects mismatched baseline environments and unmet Mesa software evidence', () => {
    const result = evaluateAgentTimelineBenchmarkGate({
      ...policy,
      requiredPlatforms: ['linux-mesa'],
      requiredRuntimeEvidence: { platformClass: 'linux-mesa', canvasPath: 'software', mesa: true },
    }, [
      measurement('cold', 'linux-mesa', 'cold', {
        baselinePlatform: 'windows',
        runtimeEvidence: { platformClass: 'linux-mesa', renderBackend: 'cpu', canvasPath: 'software', mesa: true },
        baselineRuntimeEvidence: { platformClass: 'linux-mesa', renderBackend: 'cpu', canvasPath: 'gpu', mesa: true },
      }),
      measurement('warm', 'linux-mesa', 'warm', {
        runtimeEvidence: { platformClass: 'linux-mesa', renderBackend: 'cpu', canvasPath: 'software', mesa: true },
        baselineRuntimeEvidence: { platformClass: 'linux-mesa', renderBackend: 'cpu', canvasPath: 'software', mesa: true },
      }),
    ]);
    expect(result.failures.map((failure) => failure.code)).toEqual(expect.arrayContaining([
      'baseline-mismatch',
    ]));
  });

  it('rejects malformed measurements instead of silently ignoring them', () => {
    const result = evaluateAgentTimelineBenchmarkGate({
      ...policy,
      requiredPlatforms: ['windows'],
    }, [
      measurement('broken', 'windows', 'cold', { wallTimeSeconds: Number.NaN }),
      measurement('warm', 'windows', 'warm'),
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-measurement', measurementId: 'broken' }),
      expect.objectContaining({ code: 'missing-cache-state', cacheState: 'cold' }),
    ]));
  });
});
