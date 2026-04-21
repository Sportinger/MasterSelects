import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/engine/scene/runtime/SharedSplatRuntimeCache', () => ({
  prewarmGaussianSplatRuntime: vi.fn(),
}));

import { createGaussianSplatClipPlaceholder } from '../../src/stores/timeline/clip/addGaussianSplatClip';

describe('createGaussianSplatClipPlaceholder', () => {
  it('defaults numbered PLY sequences to flip-x-180 orientation', () => {
    const clip = createGaussianSplatClipPlaceholder({
      trackId: 'track-v1',
      file: new File(['0'], 'scan000000.ply', { type: 'application/octet-stream' }),
      startTime: 0,
      estimatedDuration: 1,
      gaussianSplatSequence: {
        fps: 30,
        frameCount: 2,
        playbackMode: 'clamp',
        sequenceName: 'scan',
        frames: [
          { name: 'scan000000.ply' },
          { name: 'scan000001.ply' },
        ],
      },
    });

    expect(clip.source?.gaussianSplatSettings?.render.orientationPreset).toBe('flip-x-180');
  });

  it('keeps .splat clips on the default orientation preset', () => {
    const clip = createGaussianSplatClipPlaceholder({
      trackId: 'track-v1',
      file: new File(['0'], 'scan000000.splat', { type: 'application/octet-stream' }),
      startTime: 0,
      estimatedDuration: 1,
    });

    expect(clip.source?.gaussianSplatSettings?.render.orientationPreset).toBe('default');
  });
});
