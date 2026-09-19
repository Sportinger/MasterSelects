import type { ModelRuntimePrimitive } from './modelRuntimeCache/types';

export interface ModelVolumeCenter {
  x: number;
  y: number;
  z: number;
}

interface WeightedCenter extends ModelVolumeCenter {
  weight: number;
}

function position(vertices: Float32Array, index: number): ModelVolumeCenter {
  const offset = index * 8;
  return {
    x: vertices[offset] ?? 0,
    y: vertices[offset + 1] ?? 0,
    z: vertices[offset + 2] ?? 0,
  };
}

function isClosedTriangleMesh(indices: Uint32Array): boolean {
  if (indices.length < 12 || indices.length % 3 !== 0) return false;
  const edgeCounts = new Map<string, number>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  };
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] ?? 0;
    const b = indices[index + 1] ?? 0;
    const c = indices[index + 2] ?? 0;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return [...edgeCounts.values()].every(count => count === 2);
}

function volumeCenter(primitive: ModelRuntimePrimitive, vertices: Float32Array): WeightedCenter | null {
  if (!isClosedTriangleMesh(primitive.indices)) return null;
  let signedVolume6 = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < primitive.indices.length; index += 3) {
    const a = position(vertices, primitive.indices[index] ?? 0);
    const b = position(vertices, primitive.indices[index + 1] ?? 0);
    const c = position(vertices, primitive.indices[index + 2] ?? 0);
    const crossX = b.y * c.z - b.z * c.y;
    const crossY = b.z * c.x - b.x * c.z;
    const crossZ = b.x * c.y - b.y * c.x;
    const tetraVolume6 = a.x * crossX + a.y * crossY + a.z * crossZ;
    signedVolume6 += tetraVolume6;
    x += (a.x + b.x + c.x) * tetraVolume6;
    y += (a.y + b.y + c.y) * tetraVolume6;
    z += (a.z + b.z + c.z) * tetraVolume6;
  }
  if (!Number.isFinite(signedVolume6) || Math.abs(signedVolume6) < 1e-10) return null;
  return {
    x: x / (signedVolume6 * 4),
    y: y / (signedVolume6 * 4),
    z: z / (signedVolume6 * 4),
    weight: Math.abs(signedVolume6),
  };
}

function surfaceCenter(primitive: ModelRuntimePrimitive, vertices: Float32Array): WeightedCenter | null {
  let weight = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < primitive.indices.length; index += 3) {
    const a = position(vertices, primitive.indices[index] ?? 0);
    const b = position(vertices, primitive.indices[index + 1] ?? 0);
    const c = position(vertices, primitive.indices[index + 2] ?? 0);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    const area2 = Math.hypot(
      aby * acz - abz * acy,
      abz * acx - abx * acz,
      abx * acy - aby * acx,
    );
    if (!Number.isFinite(area2) || area2 <= 1e-12) continue;
    weight += area2;
    x += ((a.x + b.x + c.x) / 3) * area2;
    y += ((a.y + b.y + c.y) / 3) * area2;
    z += ((a.z + b.z + c.z) / 3) * area2;
  }
  return weight > 0 ? { x: x / weight, y: y / weight, z: z / weight, weight } : null;
}

function vertexCenter(vertices: Float32Array): WeightedCenter | null {
  const count = Math.floor(vertices.length / 8);
  if (count === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < count; index += 1) {
    const point = position(vertices, index);
    x += point.x;
    y += point.y;
    z += point.z;
  }
  return { x: x / count, y: y / count, z: z / count, weight: count };
}

export function computeModelVolumeCenter(
  primitives: readonly ModelRuntimePrimitive[],
  selectedPrimitiveIndex?: number,
): ModelVolumeCenter {
  const selected = selectedPrimitiveIndex === undefined
    ? primitives
    : primitives.slice(selectedPrimitiveIndex, selectedPrimitiveIndex + 1);
  const centers = selected.map((primitive) => {
    const vertices = selectedPrimitiveIndex === undefined
      ? primitive.vertices
      : (primitive.centeredVertices ?? primitive.vertices);
    return volumeCenter(primitive, vertices)
      ?? surfaceCenter(primitive, vertices)
      ?? vertexCenter(vertices);
  }).filter((center): center is WeightedCenter => center !== null);
  const totalWeight = centers.reduce((sum, center) => sum + center.weight, 0);
  if (!(totalWeight > 0)) return { x: 0, y: 0, z: 0 };
  return {
    x: centers.reduce((sum, center) => sum + center.x * center.weight, 0) / totalWeight,
    y: centers.reduce((sum, center) => sum + center.y * center.weight, 0) / totalWeight,
    z: centers.reduce((sum, center) => sum + center.z * center.weight, 0) / totalWeight,
  };
}
