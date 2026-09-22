/** Bounded density reconstruction in the same local coordinates as the splat buffer. */
export interface SplatMeshOptions { resolution: number; threshold: number; radius: number }
export interface SplatMeshGeometry { vertices: Float32Array; indices: Uint32Array }
const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];

export function reconstructSplatMesh(source: Float32Array, count: number, options: SplatMeshOptions): SplatMeshGeometry {
  if (!Number.isFinite(options.resolution) || !Number.isFinite(options.threshold) || !Number.isFinite(options.radius)
    || options.threshold <= 0 || options.radius <= 0 || source.length < count * 14) throw new Error('Invalid mesh reconstruction input.');
  const n = Math.max(12, Math.min(64, Math.round(options.resolution)));
  const radius = Math.max(0.5, Math.min(3, options.radius));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const stride = Math.max(1, Math.ceil(count / 32768));
  let valid = 0;
  for (let i = 0; i < count; i += stride) {
    const b = i * 14;
    if (!(source[b + 13] > 0.01) || ![source[b], source[b + 1], source[b + 2]].every(Number.isFinite)) continue;
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], source[b + a]); max[a] = Math.max(max[a], source[b + a]); } valid++;
  }
  if (!valid) return { vertices: new Float32Array(), indices: new Uint32Array() };
  const extent = Math.max(...max.map((v, i) => v - min[i]), 0.001);
  const margin = Math.ceil(radius * 2) + 1;
  const step = extent / Math.max(2, n - 1 - 2 * margin);
  const origin = min.map((v, i) => (v + max[i] - step * (n - 1)) * 0.5);
  const density = new Float32Array(n ** 3), colors = new Float32Array(n ** 3 * 3);
  const index = (x: number, y: number, z: number) => x + n * (y + n * z);
  const reach = Math.ceil(radius * 2);
  for (let i = 0; i < count; i += stride) {
    const b = i * 14, alpha = source[b + 13]; if (!(alpha > 0.01)) continue;
    const p = origin.map((v, a) => (source[b + a] - v) / step); if (!p.every(Number.isFinite)) continue;
    for (let z = Math.max(0, Math.floor(p[2]) - reach); z <= Math.min(n - 1, Math.ceil(p[2]) + reach); z++)
      for (let y = Math.max(0, Math.floor(p[1]) - reach); y <= Math.min(n - 1, Math.ceil(p[1]) + reach); y++)
        for (let x = Math.max(0, Math.floor(p[0]) - reach); x <= Math.min(n - 1, Math.ceil(p[0]) + reach); x++) {
          const d = ((x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2) / (radius * radius);
          if (d > 4) continue;
          const weight = Math.min(1, alpha) * Math.exp(-2 * d), j = index(x, y, z);
          density[j] += weight;
          for (let a = 0; a < 3; a++) colors[j * 3 + a] += weight * Math.max(0, Math.min(1, source[b + 10 + a] || 0));
        }
  }
  const vertices: number[] = [], indices: number[] = [];
  const edgeVertices = new Map<string, number>();
  const segmentSet = new Set<string>();
  const vertex = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const old = edgeVertices.get(key); if (old !== undefined) return old;
    const t = Math.max(0, Math.min(1, (options.threshold - density[a]) / (density[b] - density[a])));
    const pos = (j: number) => [j % n, Math.floor(j / n) % n, Math.floor(j / (n * n))];
    const pa = pos(a), pb = pos(b), id = vertices.length / 6;
    for (let axis = 0; axis < 3; axis++) vertices.push(origin[axis] + (pa[axis] + (pb[axis] - pa[axis]) * t) * step);
    for (let axis = 0; axis < 3; axis++) {
      const ca = colors[a * 3 + axis] / Math.max(1e-12, density[a]), cb = colors[b * 3 + axis] / Math.max(1e-12, density[b]);
      vertices.push(ca + (cb - ca) * t);
    }
    edgeVertices.set(key, id); return id;
  };
  const triangle = (a: number, b: number, c: number) => {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (!segmentSet.has(key)) { segmentSet.add(key); indices.push(u, v); }
    }
  };
  for (let z = 0; z < n - 1; z++) for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const cube = corners.map(c => index(x + c[0], y + c[1], z + c[2]));
    if (cube.every(i => density[i] < options.threshold) || cube.every(i => density[i] >= options.threshold)) continue;
    for (const tetra of tetrahedra) {
      const ids = tetra.map(i => cube[i]), inside = ids.filter(i => density[i] >= options.threshold), outside = ids.filter(i => density[i] < options.threshold);
      if (!inside.length || !outside.length) continue;
      if (inside.length === 1 || outside.length === 1) {
        const one = inside.length === 1 ? inside[0] : outside[0], rest = inside.length === 1 ? outside : inside;
        triangle(vertex(one, rest[0]), vertex(one, rest[1]), vertex(one, rest[2]));
      } else {
        const a = vertex(inside[0], outside[0]), b = vertex(inside[0], outside[1]), c = vertex(inside[1], outside[0]), d = vertex(inside[1], outside[1]);
        triangle(a, b, c); triangle(b, d, c);
      }
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
