import { describe, expect, it } from 'vitest';
import { resolveCachedScrubFrameSize, resolveCompositeSourceSize } from '../../src/engine/render/compositeSourceSize';
import type { Layer } from '../../src/types/layers';

function data(source: Partial<NonNullable<Layer['source']>> | null, sourceWidth: number, sourceHeight: number) {
  return { layer: { source } as Layer, sourceWidth, sourceHeight };
}

const reference = { width: 352, height: 224 };

describe('resolveCompositeSourceSize', () => {
  it('rejects a 0x0 collected size so the compositor never computes a NaN aspect (NESTED_SMALL_COMP_PREVIEW)', () => {
    expect(resolveCompositeSourceSize(data({ type: 'video' }, 0, 0), reference, false)).toBeNull();
    expect(resolveCompositeSourceSize(data({ type: 'video' }, Number.NaN, 224), reference, false)).toBeNull();
  });

  it('prefers valid intrinsic metadata and ignores invalid intrinsic values', () => {
    expect(resolveCompositeSourceSize(data({ type: 'video', intrinsicWidth: 1920, intrinsicHeight: 1080 }, 960, 540), reference, false))
      .toEqual({ width: 1920, height: 1080 });
    expect(resolveCompositeSourceSize(data({ type: 'video', intrinsicWidth: 0, intrinsicHeight: Number.NaN }, 352, 224), reference, false))
      .toEqual({ width: 352, height: 224 });
  });

  it('uses the rendered size of canvas-backed sources and the reference size for adjustment layers', () => {
    const canvasElement = document.createElement('canvas');
    expect(resolveCompositeSourceSize(data({ type: 'video', canvasElement, intrinsicWidth: 1920, intrinsicHeight: 1080 }, 1080, 1920), reference, false))
      .toEqual({ width: 1080, height: 1920 });
    expect(resolveCompositeSourceSize(data({ type: 'motion-adjustment' }, 0, 0), reference, true)).toEqual(reference);
  });
});

describe('resolveCachedScrubFrameSize', () => {
  const layer = (source: Partial<NonNullable<Layer['source']>> | null) => ({ source } as Layer);
  it('prefers the element size, then the layer intrinsic size, then the cached texture size', () => {
    expect(resolveCachedScrubFrameSize({ videoWidth: 1920, videoHeight: 1080 }, layer({ type: 'video', intrinsicWidth: 1280, intrinsicHeight: 720 }), { width: 960, height: 540 }))
      .toEqual({ width: 1920, height: 1080 });
    expect(resolveCachedScrubFrameSize({ videoWidth: 0, videoHeight: 0 }, layer({ type: 'video', intrinsicWidth: 1280, intrinsicHeight: 720 }), { width: 960, height: 540 }))
      .toEqual({ width: 1280, height: 720 });
    expect(resolveCachedScrubFrameSize({ videoWidth: 0, videoHeight: 0 }, layer({ type: 'video' }), { width: 960, height: 540 }))
      .toEqual({ width: 960, height: 540 });
  });
  it('returns null only when no positive size exists at all', () => {
    expect(resolveCachedScrubFrameSize({ videoWidth: 0, videoHeight: 0 }, layer({ type: 'video', intrinsicWidth: 0 }), { width: 0, height: 540 })).toBeNull();
    expect(resolveCachedScrubFrameSize({ videoWidth: 0, videoHeight: 0 }, null, null)).toBeNull();
  });
});
