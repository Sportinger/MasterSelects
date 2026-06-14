import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types/layers';
import {
  COMPOSITOR_UNIFORM_FLOAT_COUNT,
  writeLayerUniformData,
} from '../../src/engine/pipeline/compositor/uniforms';

function createLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: null,
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    ...overrides,
  };
}

describe('compositor uniforms', () => {
  it('encodes wipe transition metadata into the reusable padding slots', () => {
    const buffer = new ArrayBuffer(COMPOSITOR_UNIFORM_FLOAT_COUNT * 4);
    const floats = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);

    writeLayerUniformData(
      createLayer({
        transitionRender: {
          kind: 'wipe',
          direction: 'right',
          progress: 0.25,
        },
      }),
      1,
      1,
      false,
      floats,
      u32,
    );

    expect(u32[22]).toBe(1);
    expect(floats[23]).toBeCloseTo(-0.25);

    writeLayerUniformData(createLayer(), 1, 1, false, floats, u32);

    expect(u32[22]).toBe(0);
    expect(floats[23]).toBe(0);
  });
});
