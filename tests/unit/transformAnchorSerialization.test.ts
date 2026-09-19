import { describe, expect, it } from 'vitest';

import {
  fromProjectTransform,
  toProjectTransform,
} from '../../src/services/project/transformSerialization';

describe('transform anchor serialization', () => {
  it('keeps legacy 0.5 anchors at the centered runtime origin', () => {
    const transform = fromProjectTransform({
      x: 0,
      y: 0,
      z: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 1,
      blendMode: 'normal',
    });
    expect(transform.anchor).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('round-trips centered local anchor coordinates', () => {
    const saved = toProjectTransform({
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      anchor: { x: 0.2, y: -0.35, z: 0.4 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    const restored = fromProjectTransform(saved).anchor!;
    expect(restored.x).toBeCloseTo(0.2);
    expect(restored.y).toBeCloseTo(-0.35);
    expect(restored.z).toBeCloseTo(0.4);
  });
});
