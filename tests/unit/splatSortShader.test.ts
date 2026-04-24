import { describe, expect, it } from 'vitest';

import shaderSource from '../../src/engine/gaussian/shaders/radixSort.wgsl?raw';

describe('radixSort.wgsl', () => {
  it('sorts splats by positive camera distance instead of raw negative view-space z', () => {
    expect(shaderSource).toContain('let depth = -viewPos.z;');
  });

  it('pads non-power-of-two sort tails with sentinel keys', () => {
    expect(shaderSource).toContain('visibleCount: u32,');
    expect(shaderSource).toContain('sortCount: u32,');
    expect(shaderSource).toContain('if (idx >= params.visibleCount) {');
    expect(shaderSource).toContain('keys[idx] = 0xFFFFFFFFu;');
  });
});
