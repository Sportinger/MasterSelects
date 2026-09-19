import { describe, expect, it } from 'vitest';

import {
  resolvePreviewEffectOrbitDollyDistance,
  resolvePreviewEffectOrbitDragAngles,
} from '../../src/components/preview/previewEffectOrbitMath';

describe('preview effect orbit math', () => {
  it('makes the rendered voxel view follow horizontal and vertical drags', () => {
    expect(resolvePreviewEffectOrbitDragAngles(40, 15, 20, 12)).toEqual({
      yaw: 45,
      tilt: 18,
    });
  });

  it('uses the rendered voxel view dolly direction', () => {
    expect(resolvePreviewEffectOrbitDollyDistance(4, -100)).toBeLessThan(4);
    expect(resolvePreviewEffectOrbitDollyDistance(4, 100)).toBeGreaterThan(4);
  });
});
