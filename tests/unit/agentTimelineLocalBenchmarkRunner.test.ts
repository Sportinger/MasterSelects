import { describe, expect, it } from 'vitest';
import {
  LOCAL_BENCHMARK_SCHEMA_VERSION,
  type LocalBenchmarkBinding,
} from '../../src/services/agentTimeline/benchmark/localBenchmarkRunner/contracts';
import {
  parseLocalBenchmarkRequest,
  runLocalBenchmarkPass,
} from '../../src/services/agentTimeline/benchmark/localBenchmarkRunner/localBenchmarkRunner';

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: LOCAL_BENCHMARK_SCHEMA_VERSION,
    kind: 'agent-timeline-benchmark-request',
    localOnly: true,
    mediaPath: 'C:\\selected\\clip.mp4',
    mediaFingerprint: { name: 'clip.mp4', sizeBytes: 100, sha256: 'a'.repeat(64) },
    durationSeconds: 10,
    scenarioId: 'interview',
    profile: 'balanced',
    analyzer: 'focus-motion',
    baselineKind: 'standalone-cut',
    cacheState: 'warm',
    pass: 'analysis',
    ...overrides,
  };
}

function binding(overrides: Partial<LocalBenchmarkBinding> = {}): LocalBenchmarkBinding {
  return {
    mediaFileId: 'media-1',
    clipId: 'clip-1',
    observeCache: async () => ({ state: 'warm', coldResetConfirmed: false, detail: 'visible artifact' }),
    runBaseline: async (current) => ({
      status: 'completed', pass: current.pass, baselineKind: current.baselineKind,
      observability: { peakMemoryBytes: null, artifactBytes: null, redundantDecodedSeconds: null },
    }),
    runAnalysis: async (current) => ({
      status: 'completed', pass: current.pass, baselineKind: current.baselineKind,
      observability: { peakMemoryBytes: null, artifactBytes: null, redundantDecodedSeconds: null },
    }),
    cancel: () => true,
    ...overrides,
  };
}

describe('local Agent Timeline dev-bridge benchmark runner', () => {
  it('accepts only the collector local baseline/analysis contract', () => {
    expect(parseLocalBenchmarkRequest(request())).toMatchObject({ analyzer: 'focus-motion', pass: 'analysis' });
    expect(() => parseLocalBenchmarkRequest(request({ localOnly: false }))).toThrow('non-local');
    expect(() => parseLocalBenchmarkRequest(request({ analyzer: 'transcript' }))).toThrow('Unsupported benchmark analyzer');
    expect(() => parseLocalBenchmarkRequest(request({ mediaFingerprint: { name: 'x', sizeBytes: 1, sha256: 'nope' } }))).toThrow('SHA-256');
  });

  it('fails closed for a warm pass when redundant decode is not measured', async () => {
    let tick = 10;
    const result = await runLocalBenchmarkPass({
      request: request(), now: () => (tick += 4), platform: () => 'windows', deviceClass: () => 'test-device',
      resolveBinding: async () => binding(),
    });
    expect(result).toMatchObject({
      status: 'blocked', localOnly: true, networkUsed: false, cloudUsed: false,
      channels: ['quality', 'camera-motion'], peakMemoryBytes: null, artifactBytes: null,
      redundantDecodedSeconds: null, platform: 'windows',
    });
    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it('blocks cold evidence when a complete local reset is not observable', async () => {
    const result = await runLocalBenchmarkPass({
      request: request({ cacheState: 'cold' }),
      resolveBinding: async () => binding({
        observeCache: async () => ({ state: 'cold', coldResetConfirmed: false, detail: 'model cache is opaque' }),
      }),
    });
    expect(result).toMatchObject({ status: 'blocked', cacheStateObserved: 'cold', cacheResetConfirmed: false });
  });

  it('does not run when the selected local media/cache binding is unavailable', async () => {
    const result = await runLocalBenchmarkPass({ request: request(), resolveBinding: async () => null });
    expect(result).toMatchObject({ status: 'unavailable', cacheStateObserved: 'unknown' });
  });

  it('forwards cancellation to the injected local analyzer and reports it honestly', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const result = await runLocalBenchmarkPass({
      request: request(), signal: controller.signal,
      resolveBinding: async () => binding({
        cancel: () => { cancelled = true; return true; },
        runAnalysis: async (current, signal) => {
          controller.abort();
          if (signal.aborted) return { status: 'cancelled', pass: current.pass, baselineKind: current.baselineKind };
          return { status: 'completed', pass: current.pass, baselineKind: current.baselineKind };
        },
      }),
    });
    expect(cancelled).toBe(true);
    expect(result.status).toBe('cancelled');
  });
});
