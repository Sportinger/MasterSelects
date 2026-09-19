import type {
  DenseTerrainMesh,
  TerrainReconstruction,
  TerrainVector,
  TerrainVertex,
} from '../../types/terrainTracking';
import { retainTerrainMesh } from './immutableTerrainMesh';

type SurfaceFrame = Pick<DenseTerrainMesh, 'origin' | 'axisX' | 'axisY' | 'normal' | 'size'>;

const derivedSurfaces: WeakMap<TerrainReconstruction, TerrainReconstruction> =
  import.meta.hot?.data?.terrainSurfaceReconstructions ?? new WeakMap();

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.terrainSurfaceReconstructions = derivedSurfaces;
  });
}

const subtract = (left: TerrainVector, right: TerrainVector): TerrainVector => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

const dot = (left: TerrainVector, right: TerrainVector): number => (
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
);

const cross = (left: TerrainVector, right: TerrainVector): TerrainVector => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

const scale = (vector: TerrainVector, amount: number): TerrainVector => [
  vector[0] * amount,
  vector[1] * amount,
  vector[2] * amount,
];

const add = (left: TerrainVector, right: TerrainVector): TerrainVector => [
  left[0] + right[0],
  left[1] + right[1],
  left[2] + right[2],
];

function normalize(vector: TerrainVector): TerrainVector | null {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length < 1e-10) return null;
  return scale(vector, 1 / length);
}

function finitePoint(point: readonly number[]): point is TerrainVector {
  return point.length === 3 && point.every(Number.isFinite);
}

function referenceUv(vertex: TerrainVertex): [number, number] | null {
  const q = vertex.uvq[2];
  if (!Number.isFinite(q) || Math.abs(q) < 1e-10) return null;
  const uv: [number, number] = [vertex.uvq[0] / q, vertex.uvq[1] / q];
  return uv.every(Number.isFinite) ? uv : null;
}

function orthonormalFrame(axisXCandidate: TerrainVector, axisYCandidate: TerrainVector): Omit<SurfaceFrame, 'origin' | 'size'> | null {
  const axisX = normalize(axisXCandidate);
  if (!axisX) return null;
  const normal = normalize(cross(axisXCandidate, axisYCandidate));
  if (!normal) return null;
  let axisY = normalize(cross(normal, axisX));
  if (!axisY) return null;
  if (dot(axisY, axisYCandidate) < 0) {
    axisY = scale(axisY, -1);
    return { axisX, axisY, normal: scale(normal, -1) };
  }
  return { axisX, axisY, normal };
}

/** Least-squares reference-UV tangents from the observed world points. */
function frameFromReferenceCovariance(vertices: readonly TerrainVertex[]): Omit<SurfaceFrame, 'origin' | 'size'> | null {
  const samples = vertices.flatMap((vertex) => {
    const uv = referenceUv(vertex);
    return uv && finitePoint(vertex.position) ? [{ uv, position: vertex.position }] : [];
  });
  if (samples.length < 3) return null;

  const means = samples.reduce((sum, sample) => ({
    u: sum.u + sample.uv[0],
    v: sum.v + sample.uv[1],
    position: add(sum.position, sample.position),
  }), { u: 0, v: 0, position: [0, 0, 0] as TerrainVector });
  means.u /= samples.length;
  means.v /= samples.length;
  means.position = scale(means.position, 1 / samples.length);

  let covarianceUU = 0;
  let covarianceUV = 0;
  let covarianceVV = 0;
  let covarianceUP: TerrainVector = [0, 0, 0];
  let covarianceVP: TerrainVector = [0, 0, 0];
  for (const sample of samples) {
    const u = sample.uv[0] - means.u;
    const v = sample.uv[1] - means.v;
    const position = subtract(sample.position, means.position);
    covarianceUU += u * u;
    covarianceUV += u * v;
    covarianceVV += v * v;
    covarianceUP = add(covarianceUP, scale(position, u));
    covarianceVP = add(covarianceVP, scale(position, v));
  }
  const determinant = covarianceUU * covarianceVV - covarianceUV * covarianceUV;
  const scaleThreshold = Math.max(covarianceUU * covarianceVV, 1) * 1e-10;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= scaleThreshold) return null;

  const tangentU = scale(
    add(scale(covarianceUP, covarianceVV), scale(covarianceVP, -covarianceUV)),
    1 / determinant,
  );
  const tangentV = scale(
    add(scale(covarianceVP, covarianceUU), scale(covarianceUP, -covarianceUV)),
    1 / determinant,
  );
  return orthonormalFrame(tangentU, tangentV);
}

interface ObservedTriangle {
  indices: [number, number, number];
  areaSquared: number;
}

function observedTriangles(terrain: TerrainReconstruction): ObservedTriangle[] {
  const triangles: ObservedTriangle[] = [];
  for (let cursor = 0; cursor + 2 < terrain.triangles.length; cursor += 3) {
    const indices = terrain.triangles.slice(cursor, cursor + 3) as [number, number, number];
    if (!indices.every((index) => Number.isInteger(index) && index >= 0 && index < terrain.vertices.length)) continue;
    const [a, b, c] = indices.map((index) => terrain.vertices[index]!.position);
    if (!finitePoint(a) || !finitePoint(b) || !finitePoint(c)) continue;
    const areaVector = cross(subtract(b, a), subtract(c, a));
    const areaSquared = dot(areaVector, areaVector);
    if (!Number.isFinite(areaSquared) || areaSquared <= 1e-20) continue;
    triangles.push({ indices, areaSquared });
  }
  return triangles;
}

function uvTangentsForTriangle(
  vertices: readonly TerrainVertex[],
  indices: ObservedTriangle['indices'],
): [TerrainVector, TerrainVector] | null {
  const [a, b, c] = indices.map((index) => vertices[index]!);
  const uvA = referenceUv(a);
  const uvB = referenceUv(b);
  const uvC = referenceUv(c);
  if (!uvA || !uvB || !uvC) return null;
  const edgeB = subtract(b.position, a.position);
  const edgeC = subtract(c.position, a.position);
  const duB = uvB[0] - uvA[0];
  const dvB = uvB[1] - uvA[1];
  const duC = uvC[0] - uvA[0];
  const dvC = uvC[1] - uvA[1];
  const determinant = duB * dvC - duC * dvB;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return null;
  return [
    scale(add(scale(edgeB, dvC), scale(edgeC, -dvB)), 1 / determinant),
    scale(add(scale(edgeC, duB), scale(edgeB, -duC)), 1 / determinant),
  ];
}

function frameFromLargestTriangle(
  vertices: readonly TerrainVertex[],
  triangles: readonly ObservedTriangle[],
): Omit<SurfaceFrame, 'origin' | 'size'> | null {
  const largest = triangles.reduce<ObservedTriangle | null>(
    (current, triangle) => !current || triangle.areaSquared > current.areaSquared ? triangle : current,
    null,
  );
  if (!largest) return null;
  const uvTangents = uvTangentsForTriangle(vertices, largest.indices);
  if (uvTangents) {
    const frame = orthonormalFrame(...uvTangents);
    if (frame) return frame;
  }

  const [a, b, c] = largest.indices.map((index) => vertices[index]!.position);
  const edges = [subtract(b, a), subtract(c, a), subtract(c, b)].toSorted(
    (left, right) => dot(right, right) - dot(left, left),
  );
  return orthonormalFrame(edges[0]!, cross(cross(subtract(b, a), subtract(c, a)), edges[0]!));
}

function completeFrame(
  positions: readonly number[],
  axes: Omit<SurfaceFrame, 'origin' | 'size'>,
): SurfaceFrame | null {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let cursor = 0; cursor + 2 < positions.length; cursor += 3) {
    const point: TerrainVector = [positions[cursor]!, positions[cursor + 1]!, positions[cursor + 2]!];
    for (const [index, axis] of [axes.axisX, axes.axisY, axes.normal].entries()) {
      const value = dot(point, axis);
      low[index] = Math.min(low[index]!, value);
      high[index] = Math.max(high[index]!, value);
    }
  }
  const width = high[0]! - low[0]!;
  const height = high[1]! - low[1]!;
  if (![width, height, ...low, ...high].every(Number.isFinite) || width <= 1e-10 || height <= 1e-10) return null;
  const origin = add(
    add(scale(axes.axisX, (low[0]! + high[0]!) / 2), scale(axes.axisY, (low[1]! + high[1]!) / 2)),
    scale(axes.normal, (low[2]! + high[2]!) / 2),
  );
  return { ...axes, origin, size: [width, height] };
}

function deriveObservedSurfaceMesh(terrain: TerrainReconstruction): DenseTerrainMesh | null {
  const triangles = observedTriangles(terrain);
  if (triangles.length === 0) return null;
  const positions = terrain.vertices.flatMap((vertex) => vertex.position);
  const indices = triangles.flatMap((triangle) => triangle.indices);
  const axes = frameFromReferenceCovariance(terrain.vertices)
    ?? frameFromLargestTriangle(terrain.vertices, triangles);
  if (!axes) return null;
  const frame = completeFrame(positions, axes);
  if (!frame) return null;
  return retainTerrainMesh({ positions, indices, ...frame });
}

/**
 * Resolve terrain into the dense-mesh render/raycast contract without adding
 * synthetic vertices or triangles. Browser-SfM surfaces are promoted from
 * their observed sparse topology once and shared for the terrain's lifetime.
 */
export function getTerrainSurfaceReconstruction(terrain: TerrainReconstruction): TerrainReconstruction {
  if (terrain.denseMesh) {
    retainTerrainMesh(terrain.denseMesh);
    return terrain;
  }
  const cached = derivedSurfaces.get(terrain);
  if (cached) return cached;

  const denseMesh = deriveObservedSurfaceMesh(terrain)
    ?? terrain.footsteps?.find((step) => step.mesh)?.mesh;
  const resolved = denseMesh
    ? { ...terrain, denseMesh: retainTerrainMesh(denseMesh) }
    : terrain;
  derivedSurfaces.set(terrain, resolved);
  return resolved;
}
