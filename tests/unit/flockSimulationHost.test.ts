import { describe, expect, it, vi } from 'vitest';
import { FlockSimulationRuntime } from '../../src/engine/flock/runtime/FlockSimulationRuntime';
import type { FlockSimulationHost } from '../../src/engine/flock/runtime/flockSimulationHost';
import type { Keyframe } from '../../src/types/keyframes';

function host(): FlockSimulationHost {
  return {
    requestRender: vi.fn(), renderAssets: () => { throw new Error('No GPU needed'); },
    audioSampler: clipId => () => clipId === 'a' ? 0.25 : 0.75,
    audioRevision: () => 0, audioFingerprint: () => 'test-audio', modelState: () => null,
    status: { getStatus: () => null, publishStatus: vi.fn(), clearStatus: vi.fn() },
  };
}

describe('environment-independent flock runtime', () => {
  it('keeps per-clip audio mapping separate even when clips share a keyframe array', () => {
    const runtime = new FlockSimulationRuntime(host());
    const keys: Keyframe[] = [];
    const a = runtime.contextFor('a', keys), b = runtime.contextFor('b', keys);
    expect(a.audio?.('track', 0, 0)).toBe(0.25);
    expect(b.audio?.('track', 0, 0)).toBe(0.75);
    expect(runtime.contextFor('a', keys)).toBe(a);
    runtime.dispose();
  });

  it('cancels active precompute on runtime teardown', () => {
    const runtime = new FlockSimulationRuntime(host());
    const job = { clipId: 'a', start: 0, end: 5, progress: 0.2, cancelled: false, finished: false };
    runtime.jobs.set('a', job);
    runtime.dispose();
    expect(job.cancelled).toBe(true);
    expect(runtime.device).toBeNull();
    expect(runtime.entries.size).toBe(0);
  });
});
