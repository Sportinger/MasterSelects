import { describe, expect, it } from 'vitest';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { cableSceneLayout, decodeCableScene, encodeCableScene, type CableSceneBake } from '../../src/services/faceCables/cableSceneData';
import { cableDepthGrid, calibrateCableDepth, calibratedCableDepth } from '../../src/services/faceCables/cableSceneDepth';
import { buildCableDepthGeometry } from '../../src/services/faceCables/cableDepthSurface';
import { buildCableSceneGeometry } from '../../src/engine/native3d/passes/faceCablePass/geometry';

function fixture(): CableSceneBake {
  const cables = [defaultFaceCable()], depthGrid = { width: 3, height: 3 }, layout = cableSceneLayout(cables, depthGrid);
  const data = new Float32Array(layout.stride * 2);
  for (let frame = 0; frame < 2; frame++) {
    const base = frame * layout.stride;
    data[base] = 1;
    [[-1, 1, 0, 0, 0], [1, 1, 0, 1, 0], [1, -1, 0, 1, 1], [-1, -1, 0, 0, 1]].forEach((p, i) => data.set(p, base + 1 + i * 5));
    [[-0.3, 0.3, 0.2, 0.3, 0.3], [0.3, 0.3, 0.2, 0.7, 0.3], [0.3, -0.3, 0.1, 0.7, 0.7], [-0.3, -0.3, 0.1, 0.3, 0.7]].forEach((p, i) => data.set(p, base + 21 + i * 5));
    data.set([0, 0, 0, 1], base + layout.depthOffset);
    data.fill(-0.4 - frame * 0.1, base + layout.depthOffset + 4, base + layout.stride);
  }
  return { version: 2, depthGrid, data, cables, frames: 2, fps: 30, duration: 2 / 30, triangles: [0, 1, 2, 0, 2, 3], outline: [0, 1, 2, 3] };
}
describe('hybrid MediaPipe and image depth', () => {
  it('covers exactly the image outside the face and welds every face boundary vertex', () => {
    const bake = fixture(), mesh = buildCableDepthGeometry(bake, 0);
    let area = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.slice(i, i + 3).map(j => mesh.vertices[j].uv);
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      const center = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      expect(center[0] > 0.300001 && center[0] < 0.699999 && center[1] > 0.300001 && center[1] < 0.699999).toBe(false);
    }
    expect(area).toBeCloseTo(0.84, 6);
    for (let i = 0; i < 4; i++) expect(mesh.vertices[4 + i].position).toEqual(Array.from(bake.data.subarray(21 + i * 5, 24 + i * 5)));
    const edge = mesh.vertices.filter(p => Math.abs(p.uv[1] - 0.3) < 1e-6 && p.uv[0] >= 0.3 && p.uv[0] <= 0.7);
    expect(edge.length).toBeGreaterThan(4);
    edge.forEach(p => expect(p.position[2]).toBeCloseTo(0.2));
    expect(mesh.vertices.every(p => p.position.every(Number.isFinite))).toBe(true);
  });
  it('stores portable depth frames and samples the correct frame without shifting face or cable offsets', () => {
    const original = fixture(), bake = decodeCableScene(encodeCableScene(original))!;
    expect(bake.data).toEqual(original.data);
    expect(bake.depthGrid).toEqual(original.depthGrid);
    const layout = cableSceneLayout(bake.cables, bake.depthGrid);
    expect(layout.offsets).toEqual(cableSceneLayout(bake.cables).offsets);
    const first = buildCableDepthGeometry(bake, 0), next = buildCableDepthGeometry(bake, layout.stride);
    expect(first.vertices[0].position[2]).toBeCloseTo(-0.4);
    expect(next.vertices[0].position[2]).toBeCloseTo(-0.5);
    // Reference-camera inverse projection must keep the texture at the same UV.
    expect(first.vertices[0].position[0] / (1 - first.vertices[0].position[2] / 2)).toBeCloseTo(-1);
    const rendered = buildCableSceneGeometry(bake, 1 / 30)!;
    expect(rendered.vertices.every(Number.isFinite)).toBe(true);
    expect(rendered.casterStart).toBe(rendered.indices.length); // inactive cable: receivers never cast themselves
  });
  it('fills the entire source when tracking temporarily has no face', () => {
    const bake = fixture(); bake.data[0] = 0;
    const mesh = buildCableDepthGeometry(bake, 0);
    expect(mesh.vertices.some(p => p.uv[0] === 0.5 && p.uv[1] === 0.5)).toBe(true);
    expect(mesh.vertices.every(p => p.position[2] < 0)).toBe(true);
  });
  it.each([
    [-0.2, 0.3, 0.7, 0.7, 0.72], [0.3, 0.3, 1.2, 0.7, 0.72],
    [0.3, -0.2, 0.7, 0.7, 0.72], [0.3, 0.3, 0.7, 1.2, 0.72],
    [-0.2, -0.2, 0.7, 0.7, 0.51], [1.1, 0.3, 1.5, 0.7, 1],
    [-0.1, -0.1, 1.1, 1.1, 0], [0, 0.3, 0.4, 0.7, 0.84],
  ])('clips a face rectangle [%s,%s,%s,%s] without gaps or overlap', (left, top, right, bottom, expectedArea) => {
    const bake = fixture();
    [[left, top], [right, top], [right, bottom], [left, bottom]].forEach(([u, v], i) => {
      bake.data.set([2 * u - 1, 1 - 2 * v, 0.2, u, v], 21 + i * 5);
    });
    const mesh = buildCableDepthGeometry(bake, 0);
    let area = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.slice(i, i + 3).map(j => mesh.vertices[j].uv);
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      [a, b, c].flat().forEach(v => { expect(v).toBeGreaterThanOrEqual(-1e-7); expect(v).toBeLessThanOrEqual(1.0000001); });
      const u = (a[0] + b[0] + c[0]) / 3, v = (a[1] + b[1] + c[1]) / 3;
      expect(u > left + 1e-6 && u < right - 1e-6 && v > top + 1e-6 && v < bottom - 1e-6).toBe(false);
    }
    expect(area).toBeCloseTo(expectedArea, 6);
    expect(mesh.vertices.every(p => p.position.every(Number.isFinite))).toBe(true);
    if (left < 0 && right > 0 && top > 0) {
      const seam = mesh.vertices.find(p => Math.abs(p.uv[0]) < 1e-8 && Math.abs(p.uv[1] - top) < 1e-7);
      expect(seam?.position[0]).toBeCloseTo(-1); expect(seam?.position[2]).toBeCloseTo(0.2);
    }
  });
  it('rejects incompatible, oversized and nonfinite depth artifacts', () => {
    const bake = fixture(), encoded = JSON.parse(encodeCableScene(bake));
    for (const patch of [{ version: 1 }, { depthGrid: undefined }, { depthGrid: { width: 100000, height: 3 } }, { depthGrid: { width: 3.2, height: 3 } }]) {
      expect(decodeCableScene(JSON.stringify({ ...encoded, ...patch }))).toBeNull();
    }
    bake.data[cableSceneLayout(bake.cables, bake.depthGrid).depthOffset + 4] = NaN;
    expect(decodeCableScene(encodeCableScene(bake))).toBeNull();
  });
  it('calibrates near/far to face depth and safely bounds flat or extreme maps', () => {
    const depth = { width: 3, height: 3, values: new Float32Array([0, 1, 2, 0, 1, 2, 0, 1, 2]), milliseconds: 1 };
    const face = [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 }];
    const points = face.map(p => ({ ...p, z: p.x * 0.2 }));
    const fit = calibrateCableDepth(depth, face, points, 1, 1);
    const values = calibratedCableDepth(depth, { width: 3, height: 3 }, fit);
    expect(values[0]).toBeCloseTo(0); expect(values[2]).toBeCloseTo(0.2);
    depth.values.fill(1);
    expect(calibratedCableDepth(depth, depth, calibrateCableDepth(depth, undefined, undefined, 1, 1)).every(Number.isFinite)).toBe(true);
    expect(cableDepthGrid(1080, 1920)).toEqual({ width: 28, height: 49 });
  });
});
