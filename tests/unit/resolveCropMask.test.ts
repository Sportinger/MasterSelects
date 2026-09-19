import { describe, expect, it } from 'vitest';

import {
  buildResolveCropMaskPatch,
  isResolveCropMask,
  readResolveCropValues,
} from '../../src/components/panels/properties/transformTab/resolveCropMask';
import type { ClipMask } from '../../src/types/masks';

function cropMask(overrides: Partial<ClipMask> = {}): ClipMask {
  const patch = buildResolveCropMaskPatch('crop-mask', {
    left: 120,
    right: 80,
    top: 40,
    bottom: 60,
    softness: 7,
  }, 1000, 500);
  return {
    id: 'crop-mask',
    name: 'Crop',
    purpose: 'crop',
    vertices: [],
    closed: true,
    opacity: 1,
    feather: 0,
    featherQuality: 50,
    inverted: false,
    mode: 'intersect',
    expanded: false,
    position: { x: 0, y: 0 },
    rotation: 0,
    enabled: true,
    visible: false,
    ...patch,
    ...overrides,
  } as ClipMask;
}

describe('Resolve crop mask adapter', () => {
  it('represents crop edges as one semantic intersect mask', () => {
    const mask = cropMask();
    expect(isResolveCropMask(mask)).toBe(true);
    expect(mask.mode).toBe('intersect');
    expect(mask.visible).toBe(false);
    expect(mask.vertices.map(vertex => [vertex.x, vertex.y])).toEqual([
      [0.12, 0.08],
      [0.92, 0.08],
      [0.92, 0.88],
      [0.12, 0.88],
    ]);
    const values = readResolveCropValues(mask, 1000, 500);
    expect(values.left).toBeCloseTo(120);
    expect(values.right).toBeCloseTo(80);
    expect(values.top).toBeCloseTo(40);
    expect(values.bottom).toBeCloseTo(60);
    expect(values.softness).toBe(7);
  });

  it('returns zero crop values before the mask is created', () => {
    expect(readResolveCropValues(undefined, 1920, 1080)).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      softness: 0,
    });
  });

  it('clamps opposing edges so the crop rectangle stays valid', () => {
    const patch = buildResolveCropMaskPatch('crop-mask', {
      left: 900,
      right: 300,
      top: 0,
      bottom: 0,
      softness: 0,
    }, 1000, 500);
    const mask = cropMask(patch);
    const values = readResolveCropValues(mask, 1000, 500);
    expect(values.left + values.right).toBeLessThanOrEqual(1000);
  });
});
