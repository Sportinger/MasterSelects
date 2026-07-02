import { describe, expect, it } from 'vitest';

import { resolveClipScaleFromLayerScale } from '../../src/components/preview/useLayerDrag';

describe('useLayerDrag scale helpers', () => {
  it('stores raw clip axes when the preview layer scale already includes scale.all', () => {
    expect(resolveClipScaleFromLayerScale(
      { x: 3, y: 1.5 },
      { all: 2, x: 1, y: 1 },
    )).toEqual({ x: 1.5, y: 0.75 });
  });

  it('leaves layer scale unchanged when scale.all is absent or unusable', () => {
    expect(resolveClipScaleFromLayerScale(
      { x: 1.2, y: 0.8 },
      { x: 1, y: 1 },
    )).toEqual({ x: 1.2, y: 0.8 });

    expect(resolveClipScaleFromLayerScale(
      { x: 1.2, y: 0.8 },
      { all: 0, x: 1, y: 1 },
    )).toEqual({ x: 1.2, y: 0.8 });
  });
});
