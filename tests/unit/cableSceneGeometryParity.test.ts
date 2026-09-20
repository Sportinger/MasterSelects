import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { cableSceneLayout, type CableSceneBake } from '../../src/services/faceCables/cableSceneData';
import { buildCableSceneGeometry } from '../../src/engine/native3d/passes/faceCablePass/geometry';

function fixture(): CableSceneBake {
  const cables = [2, 24, 55, 4].map((segments, i) => ({ ...defaultFaceCable(), id: String(i), segments }));
  const layout = cableSceneLayout(cables);
  const data = new Float32Array(layout.stride * 3);
  for (let frame = 0; frame < 3; frame++) {
    const base = frame * layout.stride;
    data[base] = frame === 1 ? 0 : 1;
    for (let i = 0; i < 468; i++) data.set([Math.sin(i) * .3, Math.cos(i) * .2, .1, .5, .5], base + 21 + i * 5);
    cables.forEach((cable, ci) => {
      const offset = base + layout.offsets[ci];
      data.set([frame === 2 && ci === 0 ? 0 : 1, .005 * (ci + 1), .2, .5, .9, ci % 2], offset);
      for (let i = 0; i <= cable.segments; i++) {
        const t = i / cable.segments;
        // Curved tubes, vertical tangent, and a stationary degenerate tube.
        const point = ci === 2 ? [0, 0, t] : ci === 3 ? [0, 0, 0] : [t, Math.sin(t * 5 + frame) * .2, Math.cos(t * 3) * .3];
        data.set(point, offset + 6 + i * 3);
      }
    });
  }
  return { version: 1, cables, fps: 30, frames: 3, duration: .1, data,
    triangles: [0, 1, 2, 3, 4, 5], outline: [0, 1, 2] };
}

function hash(array: Float32Array | Uint32Array) {
  // Positive and negative zero have identical rendering semantics.
  const values = array.map(value => value || 0);
  return createHash('sha256').update(new Uint8Array(values.buffer)).digest('hex');
}

describe('cable geometry rendering parity', () => {
  // Captured from the pre-optimization implementation, including all vertex attributes.
  const golden = [
    ['ce2956c859e4c012a85fdc8aae883df72901fa106a7361bb11fe0b68818c4ff3', '687050928a71f3313b6923bdf209ab4181a53c33f57987ec077a309d279da98f', 21],
    ['0680077a1b2d6479e8768dc139463715a86150dddd5738dd06933135fc162d6a', 'a8a1f8d0653e05aaec9e77477da8d346e9781b28add0ab56c3b7818a3699c20d', 6],
    ['e4870360069edd0d05ee223d8520e7ef249a572430a3c0d7f9fbc02bd52cf571', '0353def1c8dd667cf8ec9cd00b1ca0778600101788775dd1f154ffcb55b35c79', 21],
  ] as const;
  it.each([0, 2, 1])('preserves baked vertex attributes, winding and shadow range at frame %s', frame => {
    const bake = fixture();
    const actual = buildCableSceneGeometry(bake, frame / 30)!;
    expect(hash(actual.vertices)).toBe(golden[frame][0]);
    expect(hash(actual.indices)).toBe(golden[frame][1]);
    expect(actual.casterStart).toBe(golden[frame][2]);
    expect(actual.outline.length).toBe(frame === 1 ? 0 : bake.outline.length * 4);
  });
});
