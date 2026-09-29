import { describe, expect, it } from 'vitest';
import { MAX_STRAND_LIGHTS, packStrandLights, STRAND_LIGHT_FLOATS } from '../../src/engine/native3d/passes/strandLights';
import type { SceneLightLayer } from '../../src/engine/scene/types';
import type { LightClipSettings } from '../../src/types/light';

const light = (settings: Partial<LightClipSettings>, translation = [0, 0, 0], opacity = 1): SceneLightLayer => ({
  kind: 'light', layerId: `light-${Math.random()}`, clipId: 'light', opacity, blendMode: 'normal',
  worldMatrix: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation[0], translation[1], translation[2], 1]),
  lightSettings: { kind: 'point', color: '#ffffff', intensity: 1, diameter: 2, castsShadows: false, shadowStrength: 0.5, ...settings },
} as unknown as SceneLightLayer);

describe('strand scene lights', () => {
  it('keeps the key light without light clips', () => {
    const data = new Float32Array(STRAND_LIGHT_FLOATS).fill(9);
    packStrandLights([], data, 0);
    expect(data[3]).toBe(-1);
    expect(data.slice(4).every(value => value === 0)).toBe(true);
  });

  it('packs point and panel lights like MeshPass and folds environment into ambient', () => {
    const data = new Float32Array(10 + STRAND_LIGHT_FLOATS);
    packStrandLights([light({ kind: 'environment', color: '#ff0000', intensity: 0.5 }),
      light({ kind: 'point', intensity: 2, diameter: 3 }, [1, 2, 3]),
      light({ kind: 'panel', color: '#0000ff', intensity: 1 }, [0, 0, 4], 0.5)], data, 10);
    expect(Array.from(data.slice(10, 14))).toEqual([0.58, 0.08, 0.08, 2].map(value => Math.fround(value)));
    expect(Array.from(data.slice(14, 26))).toEqual([1, 2, 3, 1, 1, 1, 1, 2, 0, 0, -1, 3]);
    // The panel faces along its -Z axis; layer opacity scales its intensity.
    expect(Array.from(data.slice(26, 38))).toEqual([0, 0, 4, 2, 0, 0, 1, 0.5, -0, -0, -1, 2]);
  });

  it('caps direct lights and skips dark ones', () => {
    const data = new Float32Array(STRAND_LIGHT_FLOATS);
    packStrandLights([light({ intensity: 0 }), ...Array.from({ length: 6 }, (_, index) => light({}, [index, 0, 0]))], data, 0);
    expect(data[3]).toBe(MAX_STRAND_LIGHTS);
    expect(data[4]).toBe(0);
    expect(data[4 + 3 * 12]).toBe(3);
  });
});
