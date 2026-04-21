import { Logger } from '../../../services/logger';

const log = Logger.create('ModelRuntimeCache');

const DEFAULT_MODEL_COLOR = [0.5333, 0.5333, 0.5333, 1] as const;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

type ModelColor = readonly [number, number, number, number];

export interface ModelRuntimePrimitive {
  vertices: Float32Array;
  indices: Uint32Array;
  baseColor: ModelColor;
}

export interface ModelRuntimeData {
  url: string;
  fileName?: string;
  format: 'obj' | 'gltf' | 'glb';
  primitives: ModelRuntimePrimitive[];
}

export interface ModelRuntimeRequest {
  url: string;
  fileName?: string;
}

interface PendingPrimitive {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  baseColor: ModelColor;
}

interface GltfBuffer {
  byteLength: number;
  uri?: string;
}

interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  normalized?: boolean;
}

interface GltfPrimitive {
  attributes: Partial<Record<'POSITION' | 'NORMAL', number>>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GltfMesh {
  primitives: GltfPrimitive[];
}

interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfScene {
  nodes?: number[];
}

interface GltfMaterial {
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
  };
}

interface GltfAsset {
  buffers?: GltfBuffer[];
  bufferViews?: GltfBufferView[];
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
  scenes?: GltfScene[];
  scene?: number;
  materials?: GltfMaterial[];
}

function normalizeVector3(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
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

function identityMat4(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function mat4FromTrs(
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

function transformPosition(matrix: Float32Array, x: number, y: number, z: number): [number, number, number] {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function computeNormalMatrix(matrix: Float32Array): Float32Array {
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

function transformNormal(normalMatrix: Float32Array, x: number, y: number, z: number): [number, number, number] {
  return normalizeVector3(
    normalMatrix[0] * x + normalMatrix[3] * y + normalMatrix[6] * z,
    normalMatrix[1] * x + normalMatrix[4] * y + normalMatrix[7] * z,
    normalMatrix[2] * x + normalMatrix[5] * y + normalMatrix[8] * z,
  );
}

function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
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

function interleaveVertices(positions: Float32Array, normals: Float32Array): Float32Array {
  const count = Math.floor(positions.length / 3);
  const vertices = new Float32Array(count * 6);
  for (let i = 0; i < count; i += 1) {
    const positionOffset = i * 3;
    const vertexOffset = i * 6;
    vertices[vertexOffset] = positions[positionOffset] ?? 0;
    vertices[vertexOffset + 1] = positions[positionOffset + 1] ?? 0;
    vertices[vertexOffset + 2] = positions[positionOffset + 2] ?? 0;
    vertices[vertexOffset + 3] = normals[positionOffset] ?? 0;
    vertices[vertexOffset + 4] = normals[positionOffset + 1] ?? 0;
    vertices[vertexOffset + 5] = normals[positionOffset + 2] ?? 1;
  }
  return vertices;
}

function normalizeModelPrimitives(primitives: PendingPrimitive[]): ModelRuntimePrimitive[] {
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
    return [];
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const scale = 1 / maxDim;

  return primitives.map((primitive) => {
    const normalizedPositions = new Float32Array(primitive.positions.length);
    for (let i = 0; i < primitive.positions.length; i += 3) {
      normalizedPositions[i] = ((primitive.positions[i] ?? 0) - centerX) * scale;
      normalizedPositions[i + 1] = ((primitive.positions[i + 1] ?? 0) - centerY) * scale;
      normalizedPositions[i + 2] = ((primitive.positions[i + 2] ?? 0) - centerZ) * scale;
    }

    return {
      vertices: interleaveVertices(normalizedPositions, primitive.normals),
      indices: primitive.indices,
      baseColor: primitive.baseColor,
    };
  });
}

function decodeText(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

function decodeDataUri(uri: string): ArrayBuffer | null {
  const match = uri.match(/^data:.*?(;base64)?,(.*)$/i);
  if (!match) {
    return null;
  }
  const isBase64 = !!match[1];
  const payload = match[2] ?? '';

  if (isBase64) {
    if (typeof atob === 'function') {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
    if (typeof Buffer !== 'undefined') {
      const bytes = Buffer.from(payload, 'base64');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    return null;
  }

  const text = decodeURIComponent(payload);
  return new TextEncoder().encode(text).buffer;
}

function getComponentSize(componentType: number): number {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      return 4;
  }
}

function getComponentCount(type: GltfAccessor['type']): number {
  switch (type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
      return 4;
    case 'MAT4':
      return 16;
    default:
      return 1;
  }
}

function readComponent(
  view: DataView,
  byteOffset: number,
  componentType: number,
  normalized: boolean,
): number {
  switch (componentType) {
    case 5120: {
      const value = view.getInt8(byteOffset);
      return normalized ? Math.max(value / 127, -1) : value;
    }
    case 5121: {
      const value = view.getUint8(byteOffset);
      return normalized ? value / 255 : value;
    }
    case 5122: {
      const value = view.getInt16(byteOffset, true);
      return normalized ? Math.max(value / 32767, -1) : value;
    }
    case 5123: {
      const value = view.getUint16(byteOffset, true);
      return normalized ? value / 65535 : value;
    }
    case 5125:
      return view.getUint32(byteOffset, true);
    case 5126:
    default:
      return view.getFloat32(byteOffset, true);
  }
}

function readAccessorFloats(
  gltf: GltfAsset,
  buffers: ArrayBuffer[],
  accessorIndex: number,
): Float32Array | null {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView == null) {
    return null;
  }
  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    return null;
  }
  const buffer = buffers[bufferView.buffer];
  if (!buffer) {
    return null;
  }

  const componentCount = getComponentCount(accessor.type);
  const componentSize = getComponentSize(accessor.componentType);
  const stride = bufferView.byteStride ?? componentCount * componentSize;
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(buffer);
  const output = new Float32Array(accessor.count * componentCount);

  for (let i = 0; i < accessor.count; i += 1) {
    for (let component = 0; component < componentCount; component += 1) {
      const byteOffset = baseOffset + i * stride + component * componentSize;
      output[i * componentCount + component] = readComponent(
        view,
        byteOffset,
        accessor.componentType,
        accessor.normalized === true,
      );
    }
  }

  return output;
}

function readAccessorIndices(
  gltf: GltfAsset,
  buffers: ArrayBuffer[],
  accessorIndex: number | undefined,
  fallbackCount: number,
): Uint32Array {
  if (accessorIndex == null) {
    const sequential = new Uint32Array(fallbackCount);
    for (let i = 0; i < fallbackCount; i += 1) {
      sequential[i] = i;
    }
    return sequential;
  }

  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView == null) {
    const sequential = new Uint32Array(fallbackCount);
    for (let i = 0; i < fallbackCount; i += 1) {
      sequential[i] = i;
    }
    return sequential;
  }
  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    const sequential = new Uint32Array(fallbackCount);
    for (let i = 0; i < fallbackCount; i += 1) {
      sequential[i] = i;
    }
    return sequential;
  }
  const buffer = buffers[bufferView.buffer];
  if (!buffer) {
    const sequential = new Uint32Array(fallbackCount);
    for (let i = 0; i < fallbackCount; i += 1) {
      sequential[i] = i;
    }
    return sequential;
  }

  const componentSize = getComponentSize(accessor.componentType);
  const stride = bufferView.byteStride ?? componentSize;
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(buffer);
  const output = new Uint32Array(accessor.count);

  for (let i = 0; i < accessor.count; i += 1) {
    const byteOffset = baseOffset + i * stride;
    output[i] = Math.max(0, Math.trunc(readComponent(view, byteOffset, accessor.componentType, false)));
  }

  return output;
}

function readMaterialColor(gltf: GltfAsset, materialIndex: number | undefined): ModelColor {
  if (materialIndex == null) {
    return DEFAULT_MODEL_COLOR;
  }

  const factor = gltf.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor;
  if (!factor || factor.length < 3) {
    return DEFAULT_MODEL_COLOR;
  }

  return [
    Number.isFinite(factor[0]) ? factor[0]! : DEFAULT_MODEL_COLOR[0],
    Number.isFinite(factor[1]) ? factor[1]! : DEFAULT_MODEL_COLOR[1],
    Number.isFinite(factor[2]) ? factor[2]! : DEFAULT_MODEL_COLOR[2],
    Number.isFinite(factor[3]) ? factor[3]! : DEFAULT_MODEL_COLOR[3],
  ];
}

function parseGlb(buffer: ArrayBuffer): { json: GltfAsset; buffers: ArrayBuffer[] } | null {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return null;
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    return null;
  }

  let offset = 12;
  let jsonChunk: ArrayBuffer | null = null;
  let binChunk: ArrayBuffer | null = null;

  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > buffer.byteLength) {
      break;
    }

    const chunk = buffer.slice(chunkStart, chunkEnd);
    if (chunkType === GLB_JSON_CHUNK) {
      jsonChunk = chunk;
    } else if (chunkType === GLB_BIN_CHUNK) {
      binChunk = chunk;
    }

    offset = chunkEnd;
  }

  if (!jsonChunk) {
    return null;
  }

  const json = JSON.parse(decodeText(jsonChunk)) as GltfAsset;
  const buffers = (json.buffers ?? []).map((entry, index) =>
    index === 0 && !entry.uri && binChunk ? binChunk : new ArrayBuffer(entry.byteLength),
  );
  return { json, buffers };
}

async function resolveGltfBuffers(gltf: GltfAsset, sourceUrl: string, embeddedGlbBin?: ArrayBuffer): Promise<ArrayBuffer[] | null> {
  const buffers = gltf.buffers ?? [];
  const resolved: ArrayBuffer[] = [];

  for (let i = 0; i < buffers.length; i += 1) {
    const buffer = buffers[i]!;
    if (!buffer.uri) {
      if (embeddedGlbBin) {
        resolved.push(embeddedGlbBin);
        continue;
      }
      return null;
    }

    if (buffer.uri.startsWith('data:')) {
      const decoded = decodeDataUri(buffer.uri);
      if (!decoded) {
        return null;
      }
      resolved.push(decoded);
      continue;
    }

    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(buffer.uri, sourceUrl).toString();
    } catch {
      return null;
    }
    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      return null;
    }
    resolved.push(await response.arrayBuffer());
  }

  return resolved;
}

function parseGltfPrimitives(gltf: GltfAsset, buffers: ArrayBuffer[]): PendingPrimitive[] {
  const primitives: PendingPrimitive[] = [];
  const sceneIndex = gltf.scene ?? 0;
  const scene = gltf.scenes?.[sceneIndex] ?? gltf.scenes?.[0];
  const rootNodes = scene?.nodes ?? [];

  const visitNode = (nodeIndex: number, parentMatrix: Float32Array): void => {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) {
      return;
    }

    const localMatrix = node.matrix
      ? new Float32Array(node.matrix)
      : mat4FromTrs(node.translation, node.rotation, node.scale);
    const worldMatrix = multiplyMat4(parentMatrix, localMatrix);
    const normalMatrix = computeNormalMatrix(worldMatrix);

    if (node.mesh != null) {
      const mesh = gltf.meshes?.[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4) {
          continue;
        }

        const positionAccessor = primitive.attributes.POSITION;
        if (positionAccessor == null) {
          continue;
        }

        const positions = readAccessorFloats(gltf, buffers, positionAccessor);
        if (!positions || positions.length === 0) {
          continue;
        }

        const vertexCount = Math.floor(positions.length / 3);
        const indices = readAccessorIndices(gltf, buffers, primitive.indices, vertexCount);
        const sourceNormals = primitive.attributes.NORMAL != null
          ? readAccessorFloats(gltf, buffers, primitive.attributes.NORMAL)
          : null;

        const transformedPositions = new Float32Array(positions.length);
        for (let i = 0; i < vertexCount; i += 1) {
          const transformed = transformPosition(
            worldMatrix,
            positions[i * 3] ?? 0,
            positions[i * 3 + 1] ?? 0,
            positions[i * 3 + 2] ?? 0,
          );
          transformedPositions[i * 3] = transformed[0];
          transformedPositions[i * 3 + 1] = transformed[1];
          transformedPositions[i * 3 + 2] = transformed[2];
        }

        let transformedNormals: Float32Array;
        if (sourceNormals && sourceNormals.length === positions.length) {
          transformedNormals = new Float32Array(sourceNormals.length);
          for (let i = 0; i < vertexCount; i += 1) {
            const transformed = transformNormal(
              normalMatrix,
              sourceNormals[i * 3] ?? 0,
              sourceNormals[i * 3 + 1] ?? 0,
              sourceNormals[i * 3 + 2] ?? 1,
            );
            transformedNormals[i * 3] = transformed[0];
            transformedNormals[i * 3 + 1] = transformed[1];
            transformedNormals[i * 3 + 2] = transformed[2];
          }
        } else {
          transformedNormals = computeNormals(transformedPositions, indices);
        }

        primitives.push({
          positions: transformedPositions,
          normals: transformedNormals,
          indices,
          baseColor: readMaterialColor(gltf, primitive.material),
        });
      }
    }

    for (const childIndex of node.children ?? []) {
      visitNode(childIndex, worldMatrix);
    }
  };

  for (const nodeIndex of rootNodes) {
    visitNode(nodeIndex, identityMat4());
  }

  return primitives;
}

function parseSignedIndex(raw: string, total: number): number | null {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value === 0) {
    return null;
  }
  return value > 0 ? value - 1 : total + value;
}

function parseObj(text: string): PendingPrimitive[] {
  const positionsSource: Array<[number, number, number]> = [];
  const normalsSource: Array<[number, number, number]> = [];
  const faces: Array<Array<{ positionIndex: number; normalIndex: number | null }>> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const parts = line.split(/\s+/);
    const keyword = parts[0];

    if (keyword === 'v' && parts.length >= 4) {
      positionsSource.push([
        Number(parts[1] ?? 0),
        Number(parts[2] ?? 0),
        Number(parts[3] ?? 0),
      ]);
      continue;
    }

    if (keyword === 'vn' && parts.length >= 4) {
      normalsSource.push(normalizeVector3(
        Number(parts[1] ?? 0),
        Number(parts[2] ?? 0),
        Number(parts[3] ?? 1),
      ));
      continue;
    }

    if (keyword === 'f' && parts.length >= 4) {
      const face = parts.slice(1).map((entry) => {
        const [positionRaw, , normalRaw] = entry.split('/');
        return {
          positionIndex: parseSignedIndex(positionRaw ?? '', positionsSource.length) ?? -1,
          normalIndex: normalRaw
            ? parseSignedIndex(normalRaw, normalsSource.length)
            : null,
        };
      }).filter((entry) => entry.positionIndex >= 0);
      if (face.length >= 3) {
        faces.push(face);
      }
    }
  }

  if (faces.length === 0) {
    return [];
  }

  const vertexMap = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let missingNormals = false;

  const getVertexIndex = (positionIndex: number, normalIndex: number | null): number => {
    const key = normalIndex == null ? `${positionIndex}` : `${positionIndex}/${normalIndex}`;
    const cached = vertexMap.get(key);
    if (cached != null) {
      return cached;
    }

    const position = positionsSource[positionIndex] ?? [0, 0, 0];
    positions.push(position[0], position[1], position[2]);

    if (normalIndex != null && normalsSource[normalIndex]) {
      const normal = normalsSource[normalIndex];
      normals.push(normal[0], normal[1], normal[2]);
    } else {
      normals.push(0, 0, 0);
      missingNormals = true;
    }

    const index = positions.length / 3 - 1;
    vertexMap.set(key, index);
    return index;
  };

  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i += 1) {
      const tri = [face[0]!, face[i]!, face[i + 1]!];
      for (const vertex of tri) {
        indices.push(getVertexIndex(vertex.positionIndex, vertex.normalIndex));
      }
    }
  }

  const positionArray = new Float32Array(positions);
  const indexArray = new Uint32Array(indices);
  const normalArray = missingNormals
    ? computeNormals(positionArray, indexArray)
    : new Float32Array(normals);

  return [{
    positions: positionArray,
    normals: normalArray,
    indices: indexArray,
    baseColor: DEFAULT_MODEL_COLOR,
  }];
}

export class ModelRuntimeCache {
  private requests = new Map<string, ModelRuntimeRequest>();
  private runtimes = new Map<string, ModelRuntimeData>();
  private loading = new Map<string, Promise<ModelRuntimeData | null>>();

  touch(url: string, fileName?: string): void {
    if (!url) {
      return;
    }
    this.requests.set(url, { url, fileName });
  }

  has(url: string): boolean {
    return this.requests.has(url) || this.runtimes.has(url);
  }

  isLoaded(url: string): boolean {
    return this.runtimes.has(url);
  }

  get(url: string): ModelRuntimeData | undefined {
    return this.runtimes.get(url);
  }

  values(): ModelRuntimeRequest[] {
    return [...this.requests.values()];
  }

  async preload(url: string, fileName?: string): Promise<boolean> {
    if (!url) {
      return false;
    }
    this.touch(url, fileName);
    if (this.runtimes.has(url)) {
      return true;
    }

    const pending = this.loading.get(url);
    if (pending) {
      return !!(await pending);
    }

    const loadPromise = this.loadRuntime(url, fileName)
      .then((runtime) => {
        if (runtime) {
          this.runtimes.set(url, runtime);
        }
        return runtime;
      })
      .catch((error) => {
        log.error('Failed to preload native model runtime', {
          url,
          fileName,
          error,
        });
        return null;
      })
      .finally(() => {
        this.loading.delete(url);
      });

    this.loading.set(url, loadPromise);
    return !!(await loadPromise);
  }

  clear(): void {
    this.requests.clear();
    this.runtimes.clear();
    this.loading.clear();
  }

  private async loadRuntime(url: string, fileName?: string): Promise<ModelRuntimeData | null> {
    const resolvedFileName = fileName ?? this.requests.get(url)?.fileName ?? url;
    const extension = resolvedFileName.split('.').pop()?.toLowerCase() ?? '';
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    if (extension === 'obj') {
      const primitives = normalizeModelPrimitives(parseObj(await response.text()));
      return primitives.length > 0
        ? {
            url,
            fileName: resolvedFileName,
            format: 'obj',
            primitives,
          }
        : null;
    }

    const buffer = await response.arrayBuffer();
    let gltf: GltfAsset | null = null;
    let binaryChunk: ArrayBuffer | undefined;
    let format: 'gltf' | 'glb' = extension === 'gltf' ? 'gltf' : 'glb';

    const parsedGlb = parseGlb(buffer);
    if (parsedGlb) {
      gltf = parsedGlb.json;
      binaryChunk = parsedGlb.buffers[0];
      format = 'glb';
    } else {
      try {
        gltf = JSON.parse(decodeText(buffer)) as GltfAsset;
        format = 'gltf';
      } catch {
        return null;
      }
    }

    const buffers = await resolveGltfBuffers(gltf, url, binaryChunk);
    if (!buffers) {
      return null;
    }

    const primitives = normalizeModelPrimitives(parseGltfPrimitives(gltf, buffers));
    if (primitives.length === 0) {
      return null;
    }

    return {
      url,
      fileName: resolvedFileName,
      format,
      primitives,
    };
  }
}
