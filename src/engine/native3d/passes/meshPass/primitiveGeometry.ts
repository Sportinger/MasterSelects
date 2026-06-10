import type { SceneNativeMeshLayer } from '../MeshPass';

export interface PrimitiveGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  edgeIndices: Uint32Array;
}

export function createPrimitiveGeometry(
  meshType: Extract<SceneNativeMeshLayer, { kind: 'primitive' }>['meshType'],
): PrimitiveGeometryData | null {
  switch (meshType) {
    case 'cube':
      return createBoxGeometry(0.6, 0.6, 0.6);
    case 'sphere':
      return createSphereGeometry(0.35, 32, 24);
    case 'plane':
      return createPlaneGeometry(0.8, 0.8);
    case 'cylinder':
      return createCylinderGeometry(0.25, 0.25, 0.6, 32);
    case 'torus':
      return createTorusGeometry(0.3, 0.1, 16, 48);
    case 'cone':
      return createCylinderGeometry(0, 0.3, 0.6, 32);
    default:
      return null;
  }
}

export function buildEdgeIndices(indices: Uint32Array): Uint32Array {
  const edges = new Set<string>();
  const result: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge];
      const b = triangle[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) {
        continue;
      }
      edges.add(key);
      result.push(a, b);
    }
  }
  return new Uint32Array(result);
}

function createBoxGeometry(width: number, height: number, depth: number): PrimitiveGeometryData {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const hd = depth * 0.5;
  const positions = [
    [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd],
    [hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd],
    [-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd],
    [-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd],
    [hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd],
    [-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd],
  ];
  const normals = [
    [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1],
    [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1],
    [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0],
    [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0],
    [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0],
    [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0],
  ];
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ]);
  return buildGeometryData(positions, normals, indices);
}

function createPlaneGeometry(width: number, height: number): PrimitiveGeometryData {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const positions = [
    [-hw, -hh, 0],
    [hw, -hh, 0],
    [hw, hh, 0],
    [-hw, hh, 0],
  ];
  const normals = [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ];
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return buildGeometryData(positions, normals, indices);
}

function createSphereGeometry(radius: number, widthSegments: number, heightSegments: number): PrimitiveGeometryData {
  const positions: number[][] = [];
  const normals: number[][] = [];
  const indices: number[] = [];

  for (let y = 0; y <= heightSegments; y += 1) {
    const v = y / heightSegments;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let x = 0; x <= widthSegments; x += 1) {
      const u = x / widthSegments;
      const theta = u * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const nx = sinPhi * cosTheta;
      const ny = cosPhi;
      const nz = sinPhi * sinTheta;
      positions.push([radius * nx, radius * ny, radius * nz]);
      normals.push([nx, ny, nz]);
    }
  }

  for (let y = 0; y < heightSegments; y += 1) {
    for (let x = 0; x < widthSegments; x += 1) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      if (y !== 0) {
        indices.push(a, b, a + 1);
      }
      if (y !== heightSegments - 1) {
        indices.push(a + 1, b, b + 1);
      }
    }
  }

  return buildGeometryData(positions, normals, new Uint32Array(indices));
}

function createCylinderGeometry(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments: number,
): PrimitiveGeometryData {
  const positions: number[][] = [];
  const normals: number[][] = [];
  const indices: number[] = [];
  const halfHeight = height * 0.5;
  const slope = (radiusBottom - radiusTop) / Math.max(height, 0.0001);

  for (let i = 0; i <= radialSegments; i += 1) {
    const u = i / radialSegments;
    const theta = u * Math.PI * 2;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const sideNormal = normalize([sinTheta, slope, cosTheta]);
    positions.push([radiusTop * sinTheta, halfHeight, radiusTop * cosTheta]);
    normals.push(sideNormal);
    positions.push([radiusBottom * sinTheta, -halfHeight, radiusBottom * cosTheta]);
    normals.push(sideNormal);
  }

  for (let i = 0; i < radialSegments; i += 1) {
    const topA = i * 2;
    const bottomA = topA + 1;
    const topB = topA + 2;
    const bottomB = topA + 3;
    indices.push(topA, bottomA, topB);
    indices.push(topB, bottomA, bottomB);
  }

  const addCap = (top: boolean, radius: number) => {
    if (radius <= 0) {
      return;
    }
    const start = positions.length;
    const y = top ? halfHeight : -halfHeight;
    const normal = top ? [0, 1, 0] : [0, -1, 0];
    positions.push([0, y, 0]);
    normals.push(normal);
    for (let i = 0; i <= radialSegments; i += 1) {
      const u = i / radialSegments;
      const theta = u * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      positions.push([radius * sinTheta, y, radius * cosTheta]);
      normals.push(normal);
    }
    for (let i = 0; i < radialSegments; i += 1) {
      const center = start;
      const a = start + i + 1;
      const b = start + i + 2;
      if (top) {
        indices.push(center, a, b);
      } else {
        indices.push(center, b, a);
      }
    }
  };

  addCap(true, radiusTop);
  addCap(false, radiusBottom);

  return buildGeometryData(positions, normals, new Uint32Array(indices));
}

function createTorusGeometry(
  radius: number,
  tube: number,
  radialSegments: number,
  tubularSegments: number,
): PrimitiveGeometryData {
  const positions: number[][] = [];
  const normals: number[][] = [];
  const indices: number[] = [];

  for (let j = 0; j <= radialSegments; j += 1) {
    const v = (j / radialSegments) * Math.PI * 2;
    const cosV = Math.cos(v);
    const sinV = Math.sin(v);
    for (let i = 0; i <= tubularSegments; i += 1) {
      const u = (i / tubularSegments) * Math.PI * 2;
      const cosU = Math.cos(u);
      const sinU = Math.sin(u);
      const x = (radius + tube * cosV) * cosU;
      const y = tube * sinV;
      const z = (radius + tube * cosV) * sinU;
      positions.push([x, y, z]);
      normals.push([cosV * cosU, sinV, cosV * sinU]);
    }
  }

  for (let j = 1; j <= radialSegments; j += 1) {
    for (let i = 1; i <= tubularSegments; i += 1) {
      const a = (tubularSegments + 1) * j + i - 1;
      const b = (tubularSegments + 1) * (j - 1) + i - 1;
      const c = (tubularSegments + 1) * (j - 1) + i;
      const d = (tubularSegments + 1) * j + i;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  return buildGeometryData(positions, normals, new Uint32Array(indices));
}

function buildGeometryData(
  positions: number[][],
  normals: number[][],
  indices: Uint32Array,
): PrimitiveGeometryData {
  const vertices = new Float32Array(positions.length * 8);
  for (let i = 0; i < positions.length; i += 1) {
    const vertexOffset = i * 8;
    const position = positions[i];
    const normal = normals[i];
    vertices[vertexOffset + 0] = position?.[0] ?? 0;
    vertices[vertexOffset + 1] = position?.[1] ?? 0;
    vertices[vertexOffset + 2] = position?.[2] ?? 0;
    vertices[vertexOffset + 3] = normal?.[0] ?? 0;
    vertices[vertexOffset + 4] = normal?.[1] ?? 0;
    vertices[vertexOffset + 5] = normal?.[2] ?? 1;
    vertices[vertexOffset + 6] = 0;
    vertices[vertexOffset + 7] = 0;
  }

  const edgeIndices = buildEdgeIndices(indices);
  return { vertices, indices, edgeIndices };
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
