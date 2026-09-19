import { describe, expect, it } from 'vitest';

import { resolveSceneNavigationKeyboardDelta } from '../../src/components/preview/usePreviewSceneNavigation';

const basis = {
  right: { x: 1, y: 0, z: 0 },
  cameraUp: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  distance: 5,
};

function magnitude(vector: { x: number; y: number; z: number }): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

describe('preview camera keyboard navigation', () => {
  it('moves laterally at the same speed as forward', () => {
    const strafe = resolveSceneNavigationKeyboardDelta(
      basis,
      { right: 1, up: 0, forward: 0 },
      1 / 60,
      1,
    );
    const forward = resolveSceneNavigationKeyboardDelta(
      basis,
      { right: 0, up: 0, forward: 1 },
      1 / 60,
      1,
    );

    expect(magnitude(strafe)).toBeCloseTo(magnitude(forward), 8);
  });

  it('normalizes diagonal movement to avoid a speed jump', () => {
    const straight = resolveSceneNavigationKeyboardDelta(
      basis,
      { right: 1, up: 0, forward: 0 },
      1 / 60,
      1,
    );
    const diagonal = resolveSceneNavigationKeyboardDelta(
      basis,
      { right: 1, up: 0, forward: 1 },
      1 / 60,
      1,
    );

    expect(magnitude(diagonal)).toBeCloseTo(magnitude(straight), 8);
  });
});
