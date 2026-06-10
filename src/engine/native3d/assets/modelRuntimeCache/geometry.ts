import type {
  ModelRuntimeBounds,
  ModelRuntimePrimitive,
  PendingPrimitive,
} from './types';

export function normalizeVector3(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function identityMat4(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function mat4FromTrs(
  translation?: number[],
  rotation?: number[],
  scale?: number[],
): Float32Array {
  const tx = translation?.[0] ?? 0;
  const ty = translation?.[1] ?? 0;
  const tz = translation?.[2] ?? 0;
  const qx = rotation?.[0] ?? 0;
  const qy = rotation?.[1] ?? 0;
  const qz = rotation?.[2] ?? 0;
  const qw = rotation?.[3] ?? 1;
  const sx = scale?.[0] ?? 1;
  const sy = scale?.[1] ?? 1;
  const sz = scale?.[2] ?? 1;

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  return new Float32Array([
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]);
}

export function transformPosition(matrix: Float32Array, x: number, y: number, z: number): [number, number, number] {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

export function computeNormalMatrix(matrix: Float32Array): Float32Array {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const determinant = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(determinant) < 1e-8) {
    return new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]);
  }

  const invDet = 1 / determinant;
  const m00 = b01 * invDet;
  const m01 = (-a22 * a01 + a02 * a21) * invDet;
  const m02 = (a12 * a01 - a02 * a11) * invDet;
  const m10 = b11 * invDet;
  const m11 = (a22 * a00 - a02 * a20) * invDet;
  const m12 = (-a12 * a00 + a02 * a10) * invDet;
  const m20 = b21 * invDet;
  const m21 = (-a21 * a00 + a01 * a20) * invDet;
  const m22 = (a11 * a00 - a01 * a10) * invDet;

  return new Float32Array([
    m00, m10, m20,
    m01, m11, m21,
    m02, m12, m22,
  ]);
}

export function transformNormal(normalMatrix: Float32Array, x: number, y: number, z: number): [number, number, number] {
  return normalizeVector3(
    normalMatrix[0] * x + normalMatrix[3] * y + normalMatrix[6] * z,
    normalMatrix[1] * x + normalMatrix[4] * y + normalMatrix[7] * z,
    normalMatrix[2] * x + normalMatrix[5] * y + normalMatrix[8] * z,
  );
}

export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const ia = (indices[i] ?? 0) * 3;
    const ib = (indices[i + 1] ?? 0) * 3;
    const ic = (indices[i + 2] ?? 0) * 3;

    const ax = positions[ia] ?? 0;
    const ay = positions[ia + 1] ?? 0;
    const az = positions[ia + 2] ?? 0;
    const bx = positions[ib] ?? 0;
    const by = positions[ib + 1] ?? 0;
    const bz = positions[ib + 2] ?? 0;
    const cx = positions[ic] ?? 0;
    const cy = positions[ic + 1] ?? 0;
    const cz = positions[ic + 2] ?? 0;

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    normals[ia] += nx;
    normals[ia + 1] += ny;
    normals[ia + 2] += nz;
    normals[ib] += nx;
    normals[ib + 1] += ny;
    normals[ib + 2] += nz;
    normals[ic] += nx;
    normals[ic + 1] += ny;
    normals[ic + 2] += nz;
  }

  for (let i = 0; i < normals.length; i += 3) {
    const normalized = normalizeVector3(
      normals[i] ?? 0,
      normals[i + 1] ?? 0,
      normals[i + 2] ?? 1,
    );
    normals[i] = normalized[0];
    normals[i + 1] = normalized[1];
    normals[i + 2] = normalized[2];
  }

  return normals;
}

function interleaveVertices(
  positions: Float32Array,
  normals: Float32Array,
  texcoords?: Float32Array,
): Float32Array {
  const count = Math.floor(positions.length / 3);
  const vertices = new Float32Array(count * 8);
  for (let i = 0; i < count; i += 1) {
    const positionOffset = i * 3;
    const uvOffset = i * 2;
    const vertexOffset = i * 8;
    vertices[vertexOffset] = positions[positionOffset] ?? 0;
    vertices[vertexOffset + 1] = positions[positionOffset + 1] ?? 0;
    vertices[vertexOffset + 2] = positions[positionOffset + 2] ?? 0;
    vertices[vertexOffset + 3] = normals[positionOffset] ?? 0;
    vertices[vertexOffset + 4] = normals[positionOffset + 1] ?? 0;
    vertices[vertexOffset + 5] = normals[positionOffset + 2] ?? 1;
    vertices[vertexOffset + 6] = texcoords?.[uvOffset] ?? 0;
    vertices[vertexOffset + 7] = texcoords?.[uvOffset + 1] ?? 0;
  }
  return vertices;
}

export function computeModelBounds(primitives: PendingPrimitive[]): ModelRuntimeBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const primitive of primitives) {
    for (let i = 0; i < primitive.positions.length; i += 3) {
      const x = primitive.positions[i] ?? 0;
      const y = primitive.positions[i + 1] ?? 0;
      const z = primitive.positions[i + 2] ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(minZ)) {
    return null;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

export function normalizeModelPrimitives(
  primitives: PendingPrimitive[],
  bounds: ModelRuntimeBounds | null = computeModelBounds(primitives),
): ModelRuntimePrimitive[] {
  if (!bounds) {
    return [];
  }

  const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
  const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
  const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
  const maxDim = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ) || 1;
  const scale = 1 / maxDim;

  return primitives.map((primitive) => {
    const normalizedPositions = new Float32Array(primitive.positions.length);
    for (let i = 0; i < primitive.positions.length; i += 3) {
      normalizedPositions[i] = ((primitive.positions[i] ?? 0) - centerX) * scale;
      normalizedPositions[i + 1] = ((primitive.positions[i + 1] ?? 0) - centerY) * scale;
      normalizedPositions[i + 2] = ((primitive.positions[i + 2] ?? 0) - centerZ) * scale;
    }

    return {
      vertices: interleaveVertices(normalizedPositions, primitive.normals, primitive.texcoords),
      indices: primitive.indices,
      baseColor: primitive.baseColor,
      ...(primitive.baseColorTexture ? { baseColorTexture: primitive.baseColorTexture } : {}),
      ...(primitive.unlit ? { unlit: true } : {}),
    };
  });
}
