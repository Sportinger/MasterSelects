import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  estimatePlanarFrameBytes,
  getTurboResOutputFormatCandidates,
  probeTurboResVideoFrameFormats,
} from '../../src/services/mediaRuntime/prores/turboResVideoFrameCapabilities';
import {
  estimateTurboResResources,
  planTurboResRuntimePolicy,
  TURBORES_BLOB_CACHE_BYTES,
} from '../../src/services/mediaRuntime/prores/turboResResourceEstimate';

describe('TurboRes browser capability and resource policy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('estimates contiguous planar frame sizes', () => {
    expect(estimatePlanarFrameBytes(4, 4, 'I420')).toBe(24);
    expect(estimatePlanarFrameBytes(4, 4, 'I422')).toBe(32);
    expect(estimatePlanarFrameBytes(4, 4, 'I444')).toBe(48);
    expect(estimatePlanarFrameBytes(4, 4, 'I420A')).toBe(40);
    expect(estimatePlanarFrameBytes(4, 4, 'I422P10')).toBe(64);
  });

  it('keeps 4444 fallback candidates alpha-safe', () => {
    expect(getTurboResOutputFormatCandidates('ap4h')).not.toContain('I420');
    expect(getTurboResOutputFormatCandidates('ap4h').every(format => format.includes('A'))).toBe(true);
  });

  it('uses runtime VideoFrame construction instead of user-agent detection', () => {
    vi.stubGlobal('VideoFrame', class VideoFrame {
      constructor(_data: BufferSource, init: VideoFrameBufferInit) {
        if (init.format !== 'I420') throw new Error('unsupported');
      }
      close() {}
    });
    expect(probeTurboResVideoFrameFormats('apch')).toEqual(['I420']);
    expect(probeTurboResVideoFrameFormats('ap4h')).toEqual([]);
  });

  it('reserves UI capacity and avoids multi-worker message-passing sessions', () => {
    expect(planTurboResRuntimePolicy('interactive', true, 12)).toEqual({
      concurrency: 4,
      useSharedMemory: true,
    });
    expect(planTurboResRuntimePolicy('background', true, 12)).toEqual({
      concurrency: 2,
      useSharedMemory: true,
    });
    expect(planTurboResRuntimePolicy('interactive', false, 12)).toEqual({
      concurrency: 1,
      useSharedMemory: false,
    });

    const estimate = estimateTurboResResources({
      width: 1920,
      height: 1088,
      pixelFormat: 'I422P10',
      concurrency: 4,
      useSharedMemory: true,
    });
    expect(estimate.heapBytes).toBeGreaterThan(TURBORES_BLOB_CACHE_BYTES);
    expect(estimate.framePoolSize).toBe(2);
    expect(estimate.workerCount).toBe(4);
  });
});
