import { describe, expect, it } from 'vitest';

import { resolvePreviewMaskTexturePlan } from '../../src/hooks/engine/useEngineMaskTextureSync';

describe('resolvePreviewMaskTexturePlan', () => {
  it('keeps paused mask previews at full resolution', () => {
    expect(resolvePreviewMaskTexturePlan({
      width: 1920,
      height: 1080,
      isPlaying: false,
      maskDragging: false,
    })).toMatchObject({ width: 1920, height: 1080, scale: 1, cacheSuffix: 'full' });
  });

  it('caps animated playback masks without changing their aspect ratio', () => {
    expect(resolvePreviewMaskTexturePlan({
      width: 1920,
      height: 1080,
      isPlaying: true,
      maskDragging: false,
    })).toEqual({
      width: 960,
      height: 540,
      scale: 0.5,
      cacheSuffix: 'playback_960x540',
      maxFeatherQualityScale: 0.75,
    });
  });

  it('keeps the lower-resolution drag plan while playback is active', () => {
    expect(resolvePreviewMaskTexturePlan({
      width: 1920,
      height: 1080,
      isPlaying: true,
      maskDragging: true,
    })).toEqual({
      width: 384,
      height: 216,
      scale: 0.2,
      cacheSuffix: 'drag_384x216',
      maxFeatherQualityScale: 0.5,
    });
  });
});
