import { describe, expect, it } from 'vitest';
import { resolveInitialVisualTransform } from '../../src/stores/timeline/clip/initialVisualTransform';

describe('resolveInitialVisualTransform', () => {
  it('stretches source width and height independently', () => {
    const transform = resolveInitialVisualTransform(
      { visualScaleMode: 'stretch' },
      { width: 956, height: 718 },
      { width: 1920, height: 1080 },
    );

    expect(transform.scale).toEqual({
      x: 1920 / 956,
      y: 1080 / 718,
    });
  });
});
