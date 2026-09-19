import type { DenseTerrainMesh, TerrainReconstruction } from '../../types/terrainTracking';

export type TrackingSceneGeometrySource = 'dense' | 'footstep-patches' | 'sparse';

export interface TrackingSceneBounds {
  min: [number, number, number];
  max: [number, number, number];
  center: { x: number; y: number; z: number };
  maxDimension: number;
  diagonal: number;
}

export interface TrackingSceneMesh {
  positions: number[];
  indices: number[];
  source: TrackingSceneGeometrySource;
  bounds: TrackingSceneBounds;
}

export interface TrackingSceneGlbMetadata {
  assetId: string;
  sourceMediaId: string;
  geometrySource: TrackingSceneGeometrySource;
}

interface RawMesh {
  positions: readonly number[];
  indices: readonly number[];
}

function cleanCoordinate(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function appendMesh(
  outputPositions: number[],
  outputIndices: number[],
  mesh: RawMesh,
): boolean {
  if (mesh.positions.length < 9 || mesh.positions.length % 3 !== 0 || mesh.indices.length < 3) {
    return false;
  }
  if (!mesh.positions.every(Number.isFinite)) return false;

  const vertexCount = mesh.positions.length / 3;
  const validIndices: number[] = [];
  for (let cursor = 0; cursor + 2 < mesh.indices.length; cursor += 3) {
    const triangle = mesh.indices.slice(cursor, cursor + 3);
    if (!triangle.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)) continue;
    validIndices.push(triangle[0]!, triangle[1]!, triangle[2]!);
  }
  if (validIndices.length === 0) return false;

  const vertexOffset = outputPositions.length / 3;
  for (let cursor = 0; cursor < mesh.positions.length; cursor += 3) {
    // COLMAP is +X right, +Y down, +Z forward. The editor is +X right,
    // +Y up, -Z forward. This handedness-preserving rotation keeps winding.
    outputPositions.push(
      cleanCoordinate(mesh.positions[cursor]!),
      cleanCoordinate(-mesh.positions[cursor + 1]!),
      cleanCoordinate(-mesh.positions[cursor + 2]!),
    );
  }
  for (const index of validIndices) outputIndices.push(vertexOffset + index);
  return true;
}

function calculateBounds(positions: readonly number[]): TrackingSceneBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let cursor = 0; cursor < positions.length; cursor += 3) {
    minX = Math.min(minX, positions[cursor]!);
    minY = Math.min(minY, positions[cursor + 1]!);
    minZ = Math.min(minZ, positions[cursor + 2]!);
    maxX = Math.max(maxX, positions[cursor]!);
    maxY = Math.max(maxY, positions[cursor + 1]!);
    maxZ = Math.max(maxZ, positions[cursor + 2]!);
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    maxDimension: Math.max(dx, dy, dz) || 1,
    diagonal: Math.hypot(dx, dy, dz),
  };
}

function meshFromDenseTerrain(mesh: DenseTerrainMesh): RawMesh {
  return { positions: mesh.positions, indices: mesh.indices };
}

export function buildTrackingSceneMesh(terrain: TerrainReconstruction): TrackingSceneMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  let source: TrackingSceneGeometrySource = 'dense';

  const hasDense = terrain.denseMesh
    ? appendMesh(positions, indices, meshFromDenseTerrain(terrain.denseMesh))
    : false;
  if (!hasDense) {
    source = 'footstep-patches';
    const seen = new Set<DenseTerrainMesh>();
    for (const step of terrain.footsteps ?? []) {
      if (!step.mesh || seen.has(step.mesh)) continue;
      seen.add(step.mesh);
      appendMesh(positions, indices, meshFromDenseTerrain(step.mesh));
    }
  }
  if (indices.length === 0) {
    source = 'sparse';
    appendMesh(positions, indices, {
      positions: terrain.vertices.flatMap((vertex) => vertex.position),
      indices: terrain.triangles,
    });
  }
  if (indices.length === 0) {
    throw new Error('The tracking result has no valid terrain triangles to create a 3D scene.');
  }

  return { positions, indices, source, bounds: calculateBounds(positions) };
}

function calculateNormals(positions: readonly number[], indices: readonly number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let cursor = 0; cursor < indices.length; cursor += 3) {
    const ia = indices[cursor]! * 3;
    const ib = indices[cursor + 1]! * 3;
    const ic = indices[cursor + 2]! * 3;
    const abx = positions[ib]! - positions[ia]!;
    const aby = positions[ib + 1]! - positions[ia + 1]!;
    const abz = positions[ib + 2]! - positions[ia + 2]!;
    const acx = positions[ic]! - positions[ia]!;
    const acy = positions[ic + 1]! - positions[ia + 1]!;
    const acz = positions[ic + 2]! - positions[ia + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const offset of [ia, ib, ic]) {
      normals[offset] += nx;
      normals[offset + 1] += ny;
      normals[offset + 2] += nz;
    }
  }
  for (let cursor = 0; cursor < normals.length; cursor += 3) {
    const length = Math.hypot(normals[cursor]!, normals[cursor + 1]!, normals[cursor + 2]!) || 1;
    normals[cursor] /= length;
    normals[cursor + 1] /= length;
    normals[cursor + 2] /= length;
  }
  return normals;
}

function float32Bytes(values: readonly number[] | Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new DataView(buffer);
  for (let index = 0; index < values.length; index += 1) view.setFloat32(index * 4, values[index]!, true);
  return new Uint8Array(buffer);
}

function indexBytes(values: readonly number[], useUint32: boolean): Uint8Array {
  const bytes = useUint32 ? 4 : 2;
  const buffer = new ArrayBuffer(values.length * bytes);
  const view = new DataView(buffer);
  for (let index = 0; index < values.length; index += 1) {
    if (useUint32) view.setUint32(index * bytes, values[index]!, true);
    else view.setUint16(index * bytes, values[index]!, true);
  }
  return new Uint8Array(buffer);
}

function paddedLength(length: number): number {
  return (length + 3) & ~3;
}

function joinBinary(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + paddedLength(part.byteLength), 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += paddedLength(part.byteLength);
  }
  return output;
}

/** Encode one dependency-free GLB that the existing model import/runtime path can consume. */
export function encodeTrackingSceneGlb(
  mesh: TrackingSceneMesh,
  metadata: TrackingSceneGlbMetadata,
): ArrayBuffer {
  const positionBytes = float32Bytes(mesh.positions);
  const normalBytes = float32Bytes(calculateNormals(mesh.positions, mesh.indices));
  const useUint32 = mesh.indices.some((index) => index > 65_535);
  const indicesBytes = indexBytes(mesh.indices, useUint32);
  const binary = joinBinary([positionBytes, normalBytes, indicesBytes]);
  const normalOffset = paddedLength(positionBytes.byteLength);
  const indexOffset = normalOffset + paddedLength(normalBytes.byteLength);
  const json = {
    asset: { version: '2.0', generator: 'MasterSelects Tracking Scene' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Tracked terrain' }],
    meshes: [{ name: 'Tracked terrain', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Terrain', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.48, 0.53, 0.46, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34_962 },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBytes.byteLength, target: 34_962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indicesBytes.byteLength, target: 34_963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5_126, count: mesh.positions.length / 3, type: 'VEC3', min: mesh.bounds.min, max: mesh.bounds.max },
      { bufferView: 1, componentType: 5_126, count: mesh.positions.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: useUint32 ? 5_125 : 5_123, count: mesh.indices.length, type: 'SCALAR' },
    ],
    extras: { masterselects: metadata },
  };
  const encodedJson = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = paddedLength(encodedJson.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binary.byteLength;
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(encodedJson, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  bytes.set(binary, binaryHeader + 8);
  return output;
}
