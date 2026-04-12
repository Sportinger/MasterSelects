import { describe, expect, it } from 'vitest';

import { resolveSplatSortPolicy } from '../../src/engine/three/splatSortPolicy';

describe('resolveSplatSortPolicy', () => {
  it('keeps frame-modulo cadence for smaller or paused scenes', () => {
    const policy = resolveSplatSortPolicy(60000, 1, true, false);

    expect(policy.useFrameModulo).toBe(true);
    expect(policy.allowDynamicResort).toBe(true);
    expect(policy.intervalFrames).toBe(4);
    expect(policy.minElapsedMs).toBe(0);
    expect(policy.positionEpsilonSq).toBe(0.0004);
    expect(policy.directionDotThreshold).toBe(0.9985);
  });

  it('switches medium-large realtime playback scenes to time-based gating', () => {
    const policy = resolveSplatSortPolicy(350000, 1, true, true);

    expect(policy.useFrameModulo).toBe(false);
    expect(policy.allowDynamicResort).toBe(true);
    expect(policy.intervalFrames).toBe(16);
    expect(policy.minElapsedMs).toBeGreaterThanOrEqual(350);
    expect(policy.positionEpsilonSq).toBe(0.0036);
    expect(policy.directionDotThreshold).toBe(0.9955);
  });

  it('keeps very large realtime playback scenes dynamically sortable', () => {
    const policy = resolveSplatSortPolicy(818825, 1, true, true);

    expect(policy.useFrameModulo).toBe(false);
    expect(policy.allowDynamicResort).toBe(true);
    expect(policy.intervalFrames).toBe(24);
    expect(policy.minElapsedMs).toBeGreaterThanOrEqual(700);
    expect(policy.positionEpsilonSq).toBe(0.01);
    expect(policy.directionDotThreshold).toBe(0.9925);
  });

  it('honors disabled sorting', () => {
    const policy = resolveSplatSortPolicy(900000, 0, true, true);

    expect(policy.intervalFrames).toBe(0);
    expect(policy.minElapsedMs).toBe(0);
    expect(policy.allowDynamicResort).toBe(false);
  });
});
