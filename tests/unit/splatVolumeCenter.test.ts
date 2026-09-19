import { describe, expect, it } from 'vitest';

import type { PreparedSplatRuntime } from '../../src/engine/scene/runtime/SharedSplatRuntimeCache';
import { computeSplatVolumeCenter } from '../../src/engine/scene/runtime/splatVolumeCenter';

describe('splat volume center', () => {
  it('weights visible density without letting huge background splats dominate', () => {
    const runtime = {
      splatCount: 2,
      centerOpacityTextureData: new Float32Array([0, 0, 0, 1, 10, 0, 0, 0.5]),
      colorTextureData: new Float32Array([1, 1, 1, 1, 0, 0, 0, 1]),
      axisXTextureData: new Float32Array([1, 0, 0, 0, 100, 0, 0, 0]),
      axisYTextureData: new Float32Array([0, 1, 0, 0, 0, 1, 0, 0]),
      axisZTextureData: new Float32Array([0, 0, 1, 0, 0, 0, 1, 0]),
    } as PreparedSplatRuntime;

    const center = computeSplatVolumeCenter(runtime);
    expect(center.x).toBeCloseTo((10 * 0.25 * 0.02) / (1.02 + 0.25 * 0.02));
    expect(center.y).toBe(0);
    expect(center.z).toBe(0);
  });
});
