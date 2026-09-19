import { describe, expect, it } from 'vitest';
import { resolveRenderReferenceSize } from '../../src/engine/render/renderReferenceSize';

describe('render reference size', () => {
  it('keeps composition-space geometry when rendering a lower-resolution export', () => {
    expect(resolveRenderReferenceSize(
      1920,
      1080,
      true,
      { width: 3840, height: 2160 },
    )).toEqual({ width: 3840, height: 2160 });
  });

  it('falls back to the export target for renders without a composition', () => {
    expect(resolveRenderReferenceSize(1920, 1080, true)).toEqual({
      width: 1920,
      height: 1080,
    });
  });
});
