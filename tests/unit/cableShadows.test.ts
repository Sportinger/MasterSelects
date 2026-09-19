import { describe, expect, it } from 'vitest';
import { createCableShadowReceiver, writeCableShadows } from '../../src/services/faceCables/cableShadows';
import { cableFrameLayout, defaultFaceCable, encodeCableBake, decodeCableBake, CABLE_SHADOW_NODES } from '../../src/services/faceCables/cableData';
import { packFaceCableUniforms, CABLE_UNIFORM_SIZE } from '../../src/effects/tracking/faceCableUniforms';

const plane = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
const triangles = [[0, 1, 2], [0, 2, 3]];
describe('tracked face shadow projection', () => {
  it('projects opposite the light and reverses with the light direction', () => {
    for (const angle of [-45, 45]) {
      const receive = createCableShadowReceiver(plane, { lightHorizontal: angle, lightVertical: 0 }, triangles);
      const hit = receive({ x: 0.5, y: 0.5, z: 0.2 })!;
      expect(hit.point.x).toBeCloseTo(angle < 0 ? 0.7 : 0.3);
      expect(hit.point.y).toBeCloseTo(0.5);
      expect(hit.gap).toBeCloseTo(0.2);
      expect(receive({ x: 0.5, y: 0.5, z: -0.1 })).toBeNull();
      expect(receive({ x: 3, y: 3, z: 0.2 })).toBeNull();
    }
  });
  it('lands on raised geometry and rejects missing or degenerate receivers', () => {
    const receive = createCableShadowReceiver(plane.map(p => ({ ...p, z: 0.15 })), { lightHorizontal: 0, lightVertical: 0 }, triangles);
    expect(receive({ x: 0.5, y: 0.5, z: 0.2 })?.gap).toBeCloseTo(0.05);
    expect(createCableShadowReceiver([], {}, [])({ x: 0, y: 0, z: 1 })).toBeNull();
  });
  it('round-trips portable shadow geometry and stays within the WebGPU 64KiB uniform limit', () => {
    const cable = { ...defaultFaceCable(), segments: 4 }, layout = cableFrameLayout(4, [cable]);
    const data = new Float32Array(layout.stride); data[0] = 1; data[1] = 0.003;
    for (let i = 0; i < 5; i++) data.set([0.3 + i * 0.1, 0.5, 1], 2 + i * 3);
    const receiver = createCableShadowReceiver(plane, { lightHorizontal: 0, lightVertical: 0 }, triangles);
    writeCableShadows(data, 17, [{ x: 0.3, y: 0.5, z: 0.1 }, { x: 0.7, y: 0.5, z: 0.1 }], receiver, 1, { toSource: p => p });
    expect(data[20]).toBeCloseTo(0.1);
    const bakedData = encodeCableBake({ version: 4, fps: 30, frames: 1, duration: 1, cables: [cable], data });
    expect(decodeCableBake(bakedData)?.data).toEqual(data);
    const packed = packFaceCableUniforms({ bakedData, cableTime: 0, faceShadows: true }, 1000, 1000);
    expect(packed.every(Number.isFinite)).toBe(true);
    expect(packed[3]).toBeCloseTo(0.65);
    expect(CABLE_UNIFORM_SIZE).toBeLessThanOrEqual(65536);
    writeCableShadows(data, 17, [{ x: 2, y: 2 }, { x: 3, y: 3 }], receiver, 1, { toSource: p => p });
    for (let i = 0; i < CABLE_SHADOW_NODES; i++) expect(data[20 + i * 4]).toBe(-1);
  });
});
