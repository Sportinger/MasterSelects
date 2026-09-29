import { describe, expect, it } from 'vitest';

import { resolveSceneNavigationLookRotation, resolveSceneOrbitDragRotation } from '../../src/components/preview/usePreviewSceneNavigationPointerEffects';

describe('preview camera FPS look', () => {
  it('turns right when the mouse moves right', () => {
    const result = resolveSceneNavigationLookRotation({ x: 4, y: 12 }, 10, 0);

    expect(result.pitch).toBe(4);
    expect(result.yaw).toBeLessThan(12);
  });

  it('turns left when the mouse moves left', () => {
    const result = resolveSceneNavigationLookRotation({ x: 4, y: 12 }, -10, 0);

    expect(result.pitch).toBe(4);
    expect(result.yaw).toBeGreaterThan(12);
  });
});

describe('preview camera orbit', () => {
  it('tilts opposite to the FPS look for a vertical drag and keeps its yaw direction', () => {
    const look = resolveSceneNavigationLookRotation({ x: 4, y: 12 }, 10, 10);
    const orbit = resolveSceneOrbitDragRotation(4, 12, 10, 10);
    expect(Math.sign(orbit.pitch - 4)).toBe(-Math.sign(look.pitch - 4));
    expect(orbit.pitch).toBe(1.5);
    expect(Math.sign(orbit.yaw - 12)).toBe(Math.sign(look.yaw - 12));
  });
});
