import { cableSceneLayout, type CableSceneBake } from '../../../../services/faceCables/cableSceneData';
import { buildCableDepthGeometry } from '../../../../services/faceCables/cableDepthSurface';
import { unstabilizedCableSceneFrame } from '../../../../services/faceCables/cableSceneStabilization';

const SIDES = 8;
const ringCos = Array.from({ length: SIDES }, (_, side) => Math.cos(side / SIDES * Math.PI * 2));
const ringSin = Array.from({ length: SIDES }, (_, side) => Math.sin(side / SIDES * Math.PI * 2));
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
export function buildCableSceneGeometry(bake: CableSceneBake, time: number, stabilizationBypassed = false, clipTransformBypassed = false) {
  if (!Number.isFinite(time) || time < 0 || time >= bake.duration) return null;
  const layout = cableSceneLayout(bake.cables, bake.depthGrid), frame = Math.min(bake.frames - 1, Math.floor(time * bake.fps + 1e-5));
  const unstabilized = stabilizationBypassed || clipTransformBypassed ? unstabilizedCableSceneFrame(bake, frame, clipTransformBypassed) : null;
  const data = unstabilized ?? bake.data, base = unstabilized ? 0 : frame * layout.stride;
  const hasFace = Boolean(data[base] && bake.surface?.face !== false);
  const holes = hasFace ? faceHoles(bake) : [];
  const surface = bake.depthGrid ? buildCableDepthGeometry(unstabilized ? { ...bake, data } : bake, base) : null;
  let vertexCount = 4 + (hasFace ? 468 + holes.length : 0) + (surface?.vertices.length ?? 0);
  let indexCount = (bake.depthGrid ? 0 : 6) + (hasFace ? bake.triangles.length + holes.reduce((n, loop) => n + loop.length * 3, 0) : 0) + (surface?.indices.length ?? 0);
  bake.cables.forEach((c, ci) => {
    if (!data[base + layout.offsets[ci]]) return;
    const spans = (c.segments ?? 24) * 3;
    vertexCount += (spans + 1) * SIDES;
    indexCount += spans * SIDES * 6;
  });
  // Allocate the final upload buffers once. Growing JS arrays and copying them
  // to typed arrays dominated dense face/depth/cable frames.
  const vertices = new Float32Array(vertexCount * 12), indices = new Uint32Array(indexCount);
  let vertexOffset = 0, indexOffset = 0;
  const triangle = (a: number, b: number, c: number) => {
    indices[indexOffset++] = a; indices[indexOffset++] = b; indices[indexOffset++] = c;
  };
  const add = (p: number[], n: number[], uv: number[], color: number[], material: number) => {
    const index = vertexOffset / 12;
    vertices[vertexOffset++] = p[0]; vertices[vertexOffset++] = p[1]; vertices[vertexOffset++] = p[2];
    vertices[vertexOffset++] = n[0]; vertices[vertexOffset++] = n[1]; vertices[vertexOffset++] = n[2];
    vertices[vertexOffset++] = uv[0]; vertices[vertexOffset++] = uv[1];
    vertices[vertexOffset++] = color[0]; vertices[vertexOffset++] = color[1]; vertices[vertexOffset++] = color[2];
    vertices[vertexOffset++] = material;
    return index;
  };
  for (let i = 0; i < 4; i++) {
    const o = base + 1 + i * 5;
    add(Array.from(data.subarray(o, o + 3)), [0, 0, 1], Array.from(data.subarray(o + 3, o + 5)), [1, 1, 1], 0);
  }
  if (!bake.depthGrid) { triangle(0, 2, 1); triangle(0, 3, 2); }
  const outline: number[] = [];
  if (hasFace) {
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
    for (const index of bake.triangles) indices[indexOffset++] = index + 4;
    // MediaPipe excludes eye and mouth interiors; cap them with the captured video instead of exposing black holes.
    for (const loop of holes) {
      const center = [0, 0, 0], uv = [0, 0];
      loop.forEach(i => { const o = base + 21 + i * 5; center.forEach((_, j) => { center[j] += data[o + j] / loop.length; }); uv[0] += data[o + 3] / loop.length; uv[1] += data[o + 4] / loop.length; });
      const middle = add(center, [0, 0, 1], uv, [1, 1, 1], 1);
      loop.forEach((i, j) => triangle(middle, i + 4, loop[(j + 1) % loop.length] + 4));
    }
    bake.outline.forEach(i => { const o = base + 21 + i * 5; outline.push(data[o + 3], data[o + 4], 0, 0); });
  }
  if (surface) {
    const start = vertexOffset / 12;
    surface.vertices.forEach(p => add(p.position, [0, 0, 1], p.uv, [1, 1, 1], 1));
    // Textured depth receivers use the same material as the face: cable shadows and scene depth.
    for (const index of surface.indices) indices[indexOffset++] = index + start;
  }
  // The tracked face receives cable shadows. Its approximate open scan must not cast
  // triangle-shaped self shadows or shadows from the artificial eye/mouth caps.
  const casterStart = indexOffset;
  bake.cables.forEach((c, ci) => {
    const o = base + layout.offsets[ci];
    if (!data[o]) return;
    const sourceCount = (c.segments ?? 24) + 1, count = (sourceCount - 1) * 3 + 1, start = vertexOffset / 12, radius = data[o + 1];
    const coordinate = (i: number, axis: number) => data[o + 6 + Math.max(0, Math.min(sourceCount - 1, i)) * 3 + axis];
    // Sample the spline once per ring; Float64 scratch preserves JS precision.
    const centers = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      const at = i / 3, segment = Math.min(sourceCount - 2, Math.floor(at)), t = at - segment;
      for (let axis = 0; axis < 3; axis++) {
        const a = coordinate(segment - 1, axis), b = coordinate(segment, axis), c = coordinate(segment + 1, axis), d = coordinate(segment + 2, axis);
        centers[i * 3 + axis] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      }
    }
    const red = data[o + 2], green = data[o + 3], blue = data[o + 4], material = data[o + 5] ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const before = Math.max(0, i - 1) * 3, after = Math.min(count - 1, i + 1) * 3;
      let tx = centers[after] - centers[before], ty = centers[after + 1] - centers[before + 1], tz = centers[after + 2] - centers[before + 2];
      const len = Math.hypot(tx, ty, tz) || 1;
      tx /= len; ty /= len; tz /= len;
      const referenceY = Math.abs(tz) < 0.9 ? 0 : 1, referenceZ = 1 - referenceY;
      let ux = ty * referenceZ - tz * referenceY, uy = -tx * referenceZ, uz = tx * referenceY;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      const cx = centers[i * 3], cy = centers[i * 3 + 1], cz = centers[i * 3 + 2];
      for (let side = 0; side < SIDES; side++) {
        const cosine = ringCos[side], sine = ringSin[side];
        const nx = ux * cosine + vx * sine, ny = uy * cosine + vy * sine, nz = uz * cosine + vz * sine;
        vertices[vertexOffset++] = cx + nx * radius; vertices[vertexOffset++] = cy + ny * radius; vertices[vertexOffset++] = cz + nz * radius;
        vertices[vertexOffset++] = nx; vertices[vertexOffset++] = ny; vertices[vertexOffset++] = nz;
        vertices[vertexOffset++] = 0; vertices[vertexOffset++] = 0;
        vertices[vertexOffset++] = red; vertices[vertexOffset++] = green; vertices[vertexOffset++] = blue; vertices[vertexOffset++] = material;
        if (i < count - 1) {
          const a = start + i * SIDES + side, b = start + i * SIDES + (side + 1) % SIDES;
          triangle(a, b, a + SIDES); triangle(b, b + SIDES, a + SIDES);
        }
      }
    }
  });
  return { vertices, indices, casterStart, outline };
}
