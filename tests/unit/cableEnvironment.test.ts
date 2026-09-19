import { describe, expect, it } from 'vitest';
import { sharedCableWind } from '../../src/services/faceCables/cableWind';
import { cableFacePoints, createFaceContact } from '../../src/services/faceCables/cableFaceSurface';
import { createCable, stepCable } from '../../src/services/faceCables/cablePhysics';
import { projectCableDepth } from '../../src/services/faceCables/cableDepth';
import type { Keyframe } from '../../src/types/keyframes';

describe('shared cable wind', () => {
  it('reverses all force components with an animated 180 degree turn', () => {
    const params = { sharedWind: true, globalWindStrength: 6, globalWindGusts: 0 };
    const keys = [0, 1].map((time, i) => ({ id: String(i), time, property: 'effect.fx.globalWindYaw', value: i * 180, easing: 'linear' })) as Keyframe[];
    expect(sharedCableWind(params, 'fx', keys, 0)?.windZ).toBeCloseTo(6);
    expect(sharedCableWind(params, 'fx', keys, 0.5)?.windX).toBeCloseTo(6);
    expect(sharedCableWind(params, 'fx', keys, 1)?.windZ).toBeCloseTo(-6);
    expect(sharedCableWind({ ...params, globalWindPitch: 90 }, 'fx', [], 0)?.windY).toBeCloseTo(-6);
    expect(sharedCableWind({}, 'fx', keys, 0)).toBeNull();
  });
});

describe('tracked face contact', () => {
  const points = [{ x: 0, y: 0, z: 0.1 }, { x: 1, y: 0, z: 0.1 }, { x: 0, y: 1, z: 0.1 }, { x: 1, y: 1, z: 0.1 }];
  const triangles = [[0, 1, 2], [1, 3, 2]];
  it('stops inward wind at the face while allowing outward motion and keeping endpoints pinned', () => {
    const contact = createFaceContact(points, triangles);
    const a = { x: 0.3, y: 0.4, z: 0.105 }, b = { x: 0.7, y: 0.4, z: 0.105 };
    const rope = createCable(a, b, 0.6, 24);
    for (let i = 0; i < 240; i++) stepCable(rope, a, b, 1 / 120, 0, 2, { windZ: -20, contact, radius: 0.005 });
    expect(rope.points.every(p => p.z! >= 0.10499)).toBe(true);
    expect(rope.points[0]).toEqual(a);
    expect(rope.points.at(-1)).toEqual(b);
    for (let i = 0; i < 240; i++) stepCable(rope, a, b, 1 / 120, 0, 2, { windZ: 20, contact });
    expect(rope.points[12].z).toBeGreaterThan(0.15);
  });
  it('does not create an infinite collision plane outside the face', () => {
    const p = { x: 2, y: 2, z: -1 }, previous = { ...p };
    createFaceContact(points, triangles)(p, previous, 0.005);
    expect(p.z).toBe(-1);
  });
  it('preserves landmark attachment pixels despite relative mesh depth', () => {
    const face = Array.from({ length: 478 }, (_, i) => ({ x: 0.2 + i / 1000, y: 0.3, z: i === 1 ? -0.2 : 0 }));
    const mapped = cableFacePoints(face, { toComposition: p => ({ x: 0.1 + p.x * 0.8, y: p.y }) }, 0.5625);
    for (const i of [1, 61, 468]) {
      const uv = projectCableDepth(mapped[i], 0.5625)!;
      expect(uv.x).toBeCloseTo(0.1 + face[i].x * 0.8);
      expect(uv.y).toBeCloseTo(face[i].y);
    }
    expect(mapped[1].z).toBeGreaterThan(mapped[61].z!);
  });
});
