import { describe, expect, it } from 'vitest';
import { strandShadowView } from '../../src/engine/native3d/passes/strandShadowLight';
import type { SceneLightLayer } from '../../src/engine/scene/types';
import type { LightClipSettings } from '../../src/types/light';

const light = (settings: Partial<LightClipSettings>, translation: [number, number, number]): SceneLightLayer => ({
  kind: 'light', layerId: 'light', clipId: 'light', opacity: 1, blendMode: 'normal',
  worldMatrix: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...translation, 1]),
  lightSettings: { kind: 'point', color: '#ffffff', intensity: 1, diameter: 2, castsShadows: true, shadowStrength: 0.6, ...settings },
} as unknown as SceneLightLayer);
const apply = (matrix: Float32Array, p: number[]) =>
  [0, 1, 2, 3].map(row => matrix[row] * p[0] + matrix[4 + row] * p[1] + matrix[8 + row] * p[2] + matrix[12 + row]);

describe('strand shadow light', () => {
  it('shadows from the key light with an orthographic view that frames the layer', () => {
    const view = strandShadowView([], [0, 0, 1], [1, 2, 3], 2)!;
    expect(view).toMatchObject({ lightIndex: -1, perspective: false, strength: 0.8, eye: [1, 2, 9] });
    const eyeSpace = apply(view.view, [1, 2, 3]);
    expect(-eyeSpace[2]).toBeCloseTo(6, 6);
    expect(view.near).toBeLessThan(6 - 2);
    expect(view.far).toBeGreaterThan(6 + 2);
  });

  it('uses the brightest packed light at the layer and respects its shadow switch', () => {
    const lights = [light({ kind: 'environment' }, [0, 0, 0]), light({ intensity: 0.2 }, [0, 0, 5]), light({ intensity: 3 }, [4, 0, 0])];
    const view = strandShadowView(lights, [0, 0, 1], [0, 0, 0], 1)!;
    // Environment lights are not packed, so the second direct light has index 1.
    expect(view).toMatchObject({ lightIndex: 1, perspective: true, strength: 0.6, eye: [4, 0, 0] });
    expect(view.near).toBeCloseTo(3, 6);
    expect(view.far).toBeCloseTo(5, 6);
    const clip = apply(view.projection, apply(view.view, [0, 0, 0]));
    expect(Math.abs(clip[0] / clip[3])).toBeLessThan(1e-6);
    expect(strandShadowView([light({ castsShadows: false }, [0, 0, 5])], [0, 0, 1], [0, 0, 0], 1)).toBeNull();
    expect(strandShadowView([light({ kind: 'environment' }, [0, 0, 0])], [0, 0, 1], [0, 0, 0], 1)).toBeNull();
  });
});
