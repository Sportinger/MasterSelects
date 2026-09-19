import { describe, expect, it } from 'vitest';

import type { Layer } from '../../src/engine/core/types';
import { getVideoFrameEffectSourceRotation } from '../../src/engine/render/externalEffectSourceOrientation';

describe('getVideoFrameEffectSourceRotation', () => {
  it('returns the display rotation for decoded VideoFrames', () => {
    const layer = {
      source: { type: 'video', videoFrame: {} as VideoFrame, videoRotation: 90 },
    } as Pick<Layer, 'source'>;

    expect(getVideoFrameEffectSourceRotation(layer)).toBe(90);
  });

  it('leaves HTML video effect sources in their existing orientation', () => {
    const layer = {
      source: { type: 'video', videoElement: {} as HTMLVideoElement },
    } as Pick<Layer, 'source'>;

    expect(getVideoFrameEffectSourceRotation(layer)).toBe(0);
  });
});
