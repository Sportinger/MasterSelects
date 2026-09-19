import { projectCableDepth, cableWindAtTime } from '../../src/services/faceCables/cableDepth';
import { describe, expect, it } from 'vitest';
import { CABLE_NODES, createCable, stepCable } from '../../src/services/faceCables/cablePhysics';
import { CABLE_FRAME_STRIDE, cableFrameLayout, defaultFaceCable, decodeCableBake, encodeCableBake, type CableBake } from '../../src/services/faceCables/cableData';
import { CABLE_UNIFORM_STRIDE, packFaceCableUniforms } from '../../src/effects/tracking/faceCableUniforms';

describe('cable dynamics', () => {
  it('does not buckle or inject motion when animated length leaves segments slack', () => {
    const a = { x: 0, y: 0 }, b = { x: 0.2, y: 0 };
    const rope = createCable(a, b, 0.3, 55);
    rope.points = rope.points.map((_, i) => ({ x: 0.2 * i / 55, y: 0 }));
    rope.previous = structuredClone(rope.points);
    const initial = structuredClone(rope.points);
    for (const length of [2.4, 1.8, 1, 0.4, 0.22]) {
      rope.length = length;
      for (let i = 0; i < 30; i++) stepCable(rope, a, b, 1 / 120, 0, 8.4);
      expect(rope.points).toEqual(initial);
    }
  });
  it('keeps long ropes projectable through strong wind and animated shortening', () => {
    const a = { x: 0.1, y: 0.3 }, b = { x: 0.3, y: 0.3 };
    const rope = createCable(a, b, 2.4, 55);
    for (let i = 0; i < 720; i++) {
      rope.length = 2.4 - 2.18 * Math.max(0, Math.min(1, (i - 240) / 240));
      stepCable(rope, a, b, 1 / 120, 3, 8.4, { windZ: cableWindAtTime(30, 1, i / 120), stiffness: 0.1, viscosity: 0.45 });
      expect(rope.points.every(p => projectCableDepth(p, 0.5625) !== null)).toBe(true);
      expect(rope.points[0]).toEqual(a);
      expect(rope.points.at(-1)).toEqual(b);
    }
    const length = rope.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - rope.points[i].x, p.y - rope.points[i].y, (p.z ?? 0) - (rope.points[i].z ?? 0)), 0);
    // Finite solver iterations allow some stretch under the maximum gust load.
    expect(length).toBeLessThan(0.27);
  });
  it('sags under gravity while retaining pinned ends and approximately fixed length', () => {
    const a = { x: 0, y: 0 }, b = { x: 0.2, y: 0 };
    const rope = createCable(a, b, 0.32);
    for (let i = 0; i < 600; i++) stepCable(rope, a, b, 1 / 120, 0.6, 3);
    expect(rope.points[0]).toEqual(a); expect(rope.points.at(-1)).toEqual(b);
    expect(Math.max(...rope.points.map(p => p.y))).toBeGreaterThan(0.08);
    const length = rope.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - rope.points[i].x, p.y - rope.points[i].y), 0);
    expect(length).toBeGreaterThanOrEqual(0.319);
    expect(length).toBeLessThan(0.34);
  });
  it('produces deterministic inertia rather than instantly following a translated anchor pair', () => {
    const a = { x: 0, y: 0 }, b = { x: 0.2, y: 0.1 };
    const run = () => {
      const rope = createCable(a, b, 0.4);
      for (let i = 0; i < 120; i++) stepCable(rope, a, b, 1 / 120, 0.6, 2);
      const before = rope.points[12].x;
      stepCable(rope, { ...a, x: a.x + 0.03 }, { ...b, x: b.x + 0.03 }, 1 / 120, 0.6, 2);
      expect(Math.abs(rope.points[12].x - before - 0.03)).toBeGreaterThan(0.001);
      expect(rope.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      return rope.points;
    };
    expect(run()).toEqual(run());
  });
});

function baked(): CableBake {
  const data = new Float32Array(3 * 2 * CABLE_FRAME_STRIDE);
  for (let frame = 0; frame < 3; frame++) for (let cable = 0; cable < 2; cable++) {
    const offset = (frame * 2 + cable) * CABLE_FRAME_STRIDE;
    data[offset] = frame === 1 ? 0 : 1; data[offset + 1] = 0.005;
    for (let node = 0; node < CABLE_NODES; node++) {
      data[offset + 2 + node * 2] = 0.3 + node / 100 + frame / 10;
      data[offset + 3 + node * 2] = 0.4 + cable / 10;
    }
  }
  return { version: 1, fps: 30, frames: 3, duration: 0.1, data,
    cables: [0, 1].map(i => ({ id: String(i), from: 'rightMouth', to: 'rightEye', slack: 1.6, gravity: 0.6, damping: 2, width: 6, color: '#ff873d' })) };
}
describe('portable cable bake and GPU frame sampling', () => {
  it('round-trips both cables and supports scrubbing in any order without simulation state', () => {
    const bake = baked(), serialized = encodeCableBake(bake);
    expect(decodeCableBake(serialized)?.data).toEqual(bake.data);
    const sample = (time: number) => packFaceCableUniforms({ bakedData: serialized, cableTime: time }, 1000, 1000);
    const later = sample(2 / 30); sample(0);
    expect(sample(2 / 30)).toEqual(later);
    expect(later[2]).toBe(2);
    // Smooth drawing keeps both tracked attachments exactly pinned.
    expect(later[4 + 12 + 72 * 4]).toBeCloseTo(740, 3);
    expect(later[4 + 12]).toBeCloseTo(500, 3);
    expect(later[4 + CABLE_UNIFORM_STRIDE + 13]).toBeCloseTo(500, 3);
  });
  it('hides missing detections and out-of-range frames instead of holding old geometry', () => {
    const serialized = encodeCableBake(baked());
    const missing = packFaceCableUniforms({ bakedData: serialized, cableTime: 1 / 30 }, 1000, 1000);
    expect(missing[4 + 6]).toBe(0);
    expect(packFaceCableUniforms({ bakedData: serialized, cableTime: 0.1 }, 1000, 1000)[2]).toBe(0);
    expect(decodeCableBake('{broken')).toBeNull();
    const corrupt = JSON.parse(serialized); corrupt.frames = 1_000_000;
    expect(decodeCableBake(JSON.stringify(corrupt))).toBeNull();
  });
});

describe('configurable cable dynamics', () => {
  const a = { x: 0, y: 0 }, b = { x: 0.2, y: 0.1 };
  it('releases either endpoint independently and ignores movement of the released anchor', () => {
    for (const lockFrom of [false, true]) {
      const rope = createCable(a, b, 0.4, 48);
      for (let i = 0; i < 120; i++) stepCable(rope, a, b, 1 / 120, 0.6, 2, { lockFrom, lockTo: !lockFrom });
      expect(rope.points).toHaveLength(49);
      expect(rope.points[lockFrom ? 0 : 48]).toEqual(lockFrom ? a : b);
      const free = rope.points[lockFrom ? 48 : 0];
      expect(free.y).toBeGreaterThan((lockFrom ? b : a).y + 0.02);
      const copy = structuredClone(rope);
      stepCable(rope, a, b, 1 / 120, 0.6, 2, { lockFrom, lockTo: !lockFrom });
      stepCable(copy, lockFrom ? a : { x: 9, y: 9 }, lockFrom ? { x: 9, y: 9 } : b, 1 / 120, 0.6, 2, { lockFrom, lockTo: !lockFrom });
      expect(copy.points).toEqual(rope.points);
    }
  });
  it('lets an entirely unlocked cable fall and viscosity slows its travel', () => {
    const run = (viscosity: number) => {
      const rope = createCable(a, b, 0.4, 96);
      for (let i = 0; i < 120; i++) stepCable(rope, a, b, 1 / 120, 0.6, 0.2, { lockFrom: false, lockTo: false, viscosity });
      expect(rope.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      return rope.points.reduce((sum, p) => sum + p.y / rope.points.length, 0);
    };
    expect(run(0)).toBeGreaterThan(run(1) + 0.1);
  });
  it('applies a real bending resistance instead of just changing drawing smoothness', () => {
    const run = (stiffness: number) => {
      const rope = createCable(a, b, 0.4, 12);
      for (let i = 0; i < 300; i++) stepCable(rope, a, b, 1 / 120, 0, 2, { stiffness, lockFrom: false, lockTo: false });
      return Math.hypot(rope.points.at(-1)!.x - rope.points[0].x, rope.points.at(-1)!.y - rope.points[0].y);
    };
    expect(run(1)).toBeGreaterThan(run(0) + 0.01);
  });
});

describe('variable segment project format', () => {
  it('round-trips mixed resolutions, free ends and flat style while preserving endpoints', () => {
    const cables = [4, 96].map(segments => ({ ...defaultFaceCable(), segments, lockTo: false, renderStyle: 'flat' as const, viscosity: 0.7 }));
    const layout = cableFrameLayout(2, cables), data = new Float32Array(layout.stride);
    cables.forEach((c, index) => {
      const offset = layout.offsets[index]; data[offset] = 1; data[offset + 1] = 0.003;
      for (let i = 0; i <= c.segments; i++) { data[offset + 2 + i * 2] = i / c.segments; data[offset + 3 + i * 2] = 0.5; }
    });
    const serialized = encodeCableBake({ version: 2, fps: 30, frames: 1, duration: 1 / 30, cables, data });
    const restored = decodeCableBake(serialized)!;
    expect(restored.cables).toEqual(cables); expect(restored.data).toEqual(data);
    const packed = packFaceCableUniforms({ bakedData: serialized, cableTime: 0 }, 1000, 1000);
    for (let index = 0; index < 2; index++) {
      const target = 4 + index * CABLE_UNIFORM_STRIDE, count = packed[target + 5];
      expect(packed[target + 12]).toBe(0);
      expect(packed[target + 12 + (count - 1) * 4]).toBe(1000);
    }
  });
});

describe('camera-directed force field', () => {
  const a = { x: 0.1, y: 0.3 }, b = { x: 0.3, y: 0.3 };
  it('bows a constrained rope out of the image plane in the force direction', () => {
    for (const windZ of [-30, -1, 0, 1, 30]) {
      const rope = createCable(a, b, 0.4);
      for (let i = 0; i < 300; i++) stepCable(rope, a, b, 1 / 120, 0.2, 2, { windZ });
      expect(rope.points[0]).toEqual(a); expect(rope.points.at(-1)).toEqual(b);
      const depth = rope.points[12].z ?? 0;
      if (windZ) expect(depth * windZ).toBeGreaterThan(0.05); else expect(depth).toBe(0);
      const length = rope.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - rope.points[i].x, p.y - rope.points[i].y, (p.z ?? 0) - (rope.points[i].z ?? 0)), 0);
      expect(length).toBeLessThan(0.43);
    }
  });
  it('damps depth motion through viscosity and preserves deterministic gusts', () => {
    const run = (viscosity: number) => {
      const rope = createCable(a, b, 0.4);
      for (let i = 0; i < 120; i++) stepCable(rope, a, b, 1 / 120, 0, 0.2, {
        lockFrom: false, lockTo: false, viscosity, windZ: cableWindAtTime(1, 0.5, i / 120),
      });
      return rope.points[12].z!;
    };
    expect(run(0)).toBeGreaterThan(run(1) * 3);
    expect(run(0.5)).toBe(run(0.5));
    expect(cableWindAtTime(0, 1, 10)).toBe(0);
  });
  it('projects depth around image center without hiding ropes passing the camera', () => {
    expect(projectCableDepth({ x: 0.2, y: 0.3 }, 0.5)).toEqual({ x: 0.4, y: 0.3, scale: 1 });
    expect(projectCableDepth({ x: 0.2, y: 0.3, z: 1 }, 0.5)?.scale).toBe(2);
    expect(projectCableDepth({ x: 0.2, y: 0.3, z: -2 }, 0.5)?.scale).toBe(0.5);
    for (const z of [1.8, 2, 10, 1000]) {
      const point = projectCableDepth({ x: 0.2, y: 0.3, z }, 0.5)!;
      expect(point.scale).toBeGreaterThan(2);
      expect(point.scale).toBeLessThanOrEqual(4);
      expect(Number.isFinite(point.x + point.y)).toBe(true);
    }
    expect(projectCableDepth({ x: NaN, y: 0.3 }, 0.5)).toBeNull();
  });
  it('stores perspective thickness with each point and restores it for GPU rendering', () => {
    const cables = [{ ...defaultFaceCable(), segments: 4, windZ: 1 }];
    const data = new Float32Array(cableFrameLayout(3, cables).stride); data[0] = 1; data[1] = 0.01;
    for (let i = 0; i <= 4; i++) { data[2 + i * 3] = i / 4; data[3 + i * 3] = 0.5; data[4 + i * 3] = 1 + i / 4; }
    const serialized = encodeCableBake({ version: 3, fps: 30, frames: 1, duration: 1 / 30, cables, data });
    expect(decodeCableBake(serialized)?.data).toEqual(data);
    const uniform = packFaceCableUniforms({ bakedData: serialized, cableTime: 0 }, 1000, 1000);
    expect(uniform[4 + 14]).toBeCloseTo(10);
    expect(uniform[4 + 14 + 12 * 4]).toBeCloseTo(20);
  });
});
