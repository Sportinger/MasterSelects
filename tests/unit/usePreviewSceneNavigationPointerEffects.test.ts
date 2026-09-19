import { describe, expect, it } from 'vitest';

import { resolveSceneNavigationLookRotation } from '../../src/components/preview/usePreviewSceneNavigationPointerEffects';

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
