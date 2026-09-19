import { cableSceneLayout, type CableSceneBake } from '../../../../services/faceCables/cableSceneData';

const SIDES = 8;
const holeCache = new WeakMap<CableSceneBake, number[][]>();
function faceHoles(bake: CableSceneBake): number[][] {
  const cached = holeCache.get(bake); if (cached) return cached;
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < bake.triangles.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = bake.triangles[i + j], b = bake.triangles[i + (j + 1) % 3], key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    const edge = edges.get(key); if (edge) edge.count++; else edges.set(key, { a, b, count: 1 });
  }
  const neighbors = new Map<number, number[]>();
  edges.forEach(({ a, b, count }) => { if (count === 1) { neighbors.set(a, [...(neighbors.get(a) ?? []), b]); neighbors.set(b, [...(neighbors.get(b) ?? []), a]); } });
  const visited = new Set<number>(), outer = new Set(bake.outline), holes: number[][] = [];
  for (const start of neighbors.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = []; let at = start;
    while (!visited.has(at)) { visited.add(at); loop.push(at); const next = neighbors.get(at)?.find(n => !visited.has(n)); if (next === undefined) break; at = next; }
    if (loop.length >= 3 && !loop.some(i => outer.has(i))) holes.push(loop);
  }
  holeCache.set(bake, holes); return holes;
}
export function buildCableSceneGeometry(bake: CableSceneBake, time: number) {
  if (!Number.isFinite(time) || time < 0 || time >= bake.duration) return null;
  const layout = cableSceneLayout(bake.cables), base = Math.min(bake.frames - 1, Math.floor(time * bake.fps + 1e-5)) * layout.stride;
  const data = bake.data, vertices: number[] = [], indices: number[] = [];
  const add = (p: number[], n: number[], uv: number[], color: number[], material: number) => {
    const index = vertices.length / 12; vertices.push(...p, ...n, ...uv, ...color, material); return index;
  };
  for (let i = 0; i < 4; i++) {
    const o = base + 1 + i * 5;
    add(Array.from(data.subarray(o, o + 3)), [0, 0, 1], Array.from(data.subarray(o + 3, o + 5)), [1, 1, 1], 0);
  }
  indices.push(0, 2, 1, 0, 3, 2);
  const outline: number[] = [];
  if (data[base]) {
    const normals = new Float32Array(468 * 3);
    const point = (i: number) => data.subarray(base + 21 + i * 5, base + 24 + i * 5);
    for (let i = 0; i < bake.triangles.length; i += 3) {
      const ids = bake.triangles.slice(i, i + 3), [a, b, c] = ids.map(point);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (n[2] < 0) n.forEach((_, j) => { n[j] *= -1; });
      ids.forEach(id => n.forEach((value, j) => { normals[id * 3 + j] += value; }));
    }
    for (let i = 0; i < 468; i++) {
      const o = base + 21 + i * 5, n = Array.from(normals.subarray(i * 3, i * 3 + 3)), len = Math.hypot(...n) || 1;
      add(Array.from(data.subarray(o, o + 3)), n.map(x => x / len), Array.from(data.subarray(o + 3, o + 5)), [1, 1, 1], 1);
    }
    indices.push(...bake.triangles.map(i => i + 4));
    // MediaPipe excludes eye and mouth interiors; cap them with the captured video instead of exposing black holes.
    for (const loop of faceHoles(bake)) {
      const center = [0, 0, 0], uv = [0, 0];
      loop.forEach(i => { const o = base + 21 + i * 5; center.forEach((_, j) => { center[j] += data[o + j] / loop.length; }); uv[0] += data[o + 3] / loop.length; uv[1] += data[o + 4] / loop.length; });
      const middle = add(center, [0, 0, 1], uv, [1, 1, 1], 1);
      loop.forEach((i, j) => indices.push(middle, i + 4, loop[(j + 1) % loop.length] + 4));
    }
    bake.outline.forEach(i => { const o = base + 21 + i * 5; outline.push(data[o + 3], data[o + 4], 0, 0); });
  }
  // The tracked face receives cable shadows. Its approximate open scan must not cast
  // triangle-shaped self shadows or shadows from the artificial eye/mouth caps.
  const casterStart = indices.length;
  bake.cables.forEach((c, ci) => {
    const o = base + layout.offsets[ci];
    if (!data[o]) return;
    const sourceCount = (c.segments ?? 24) + 1, count = (sourceCount - 1) * 3 + 1, start = vertices.length / 12, radius = data[o + 1];
    const coordinate = (i: number, axis: number) => data[o + 6 + Math.max(0, Math.min(sourceCount - 1, i)) * 3 + axis];
    const p = (i: number) => {
      const at = Math.max(0, Math.min(count - 1, i)) / 3, segment = Math.min(sourceCount - 2, Math.floor(at)), t = at - segment;
      return [0, 1, 2].map(axis => {
        const a = coordinate(segment - 1, axis), b = coordinate(segment, axis), c = coordinate(segment + 1, axis), d = coordinate(segment + 2, axis);
        return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      });
    };
    for (let i = 0; i < count; i++) {
      const center = p(i), before = p(i - 1), after = p(i + 1);
      const t = after.map((v, j) => v - before[j]), len = Math.hypot(...t) || 1;
      t.forEach((_, j) => { t[j] /= len; });
      const reference = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
      const u = [t[1] * reference[2] - t[2] * reference[1], t[2] * reference[0] - t[0] * reference[2], t[0] * reference[1] - t[1] * reference[0]];
      const ul = Math.hypot(...u) || 1; u.forEach((_, j) => { u[j] /= ul; });
      const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
      for (let side = 0; side < SIDES; side++) {
        const angle = side / SIDES * Math.PI * 2, n = u.map((x, j) => x * Math.cos(angle) + v[j] * Math.sin(angle));
        add(center.map((x, j) => x + n[j] * radius), n, [0, 0], Array.from(data.subarray(o + 2, o + 5)), data[o + 5] ? 3 : 2);
        if (i < count - 1) {
          const a = start + i * SIDES + side, b = start + i * SIDES + (side + 1) % SIDES;
          indices.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
        }
      }
    }
  });
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices), casterStart, outline };
}
