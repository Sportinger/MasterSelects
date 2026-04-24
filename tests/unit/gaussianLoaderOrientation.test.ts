import { describe, expect, it } from 'vitest';

import { applyCanonicalBasisCorrection } from '../../src/engine/gaussian/loaders/normalize';
import { loadGaussianSplatAsset, type GaussianSplatLoadProgress } from '../../src/engine/gaussian/loaders';

function createSplatFile(): File {
  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);

  view.setFloat32(0, 1, true);
  view.setFloat32(4, 2, true);
  view.setFloat32(8, 3, true);
  view.setFloat32(12, 0.5, true);
  view.setFloat32(16, 0.75, true);
  view.setFloat32(20, 1.25, true);
  view.setUint8(24, 255);
  view.setUint8(25, 128);
  view.setUint8(26, 64);
  view.setUint8(27, 255);
  view.setUint8(28, 255);
  view.setUint8(29, 128);
  view.setUint8(30, 128);
  view.setUint8(31, 128);

  return {
    name: 'scene.splat',
    size: buffer.byteLength,
    type: 'application/octet-stream',
    arrayBuffer: async () => buffer,
  } as unknown as File;
}

function createPointCloudPlyFile(): File {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    'element vertex 4',
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'property uchar alpha',
    'end_header',
    '',
  ].join('\n');

  const headerBytes = new TextEncoder().encode(header);
  const stride = 16;
  const payload = new ArrayBuffer(stride * 4);
  const view = new DataView(payload);
  const vertices = [
    { x: 0, y: 0, z: 0, r: 255, g: 0, b: 0, a: 255 },
    { x: 1, y: 0, z: 0, r: 0, g: 255, b: 0, a: 255 },
    { x: 0, y: 1, z: 0, r: 0, g: 0, b: 255, a: 255 },
    { x: 1, y: 1, z: 0, r: 255, g: 255, b: 255, a: 255 },
  ];

  vertices.forEach((vertex, index) => {
    const offset = index * stride;
    view.setFloat32(offset + 0, vertex.x, true);
    view.setFloat32(offset + 4, vertex.y, true);
    view.setFloat32(offset + 8, vertex.z, true);
    view.setUint8(offset + 12, vertex.r);
    view.setUint8(offset + 13, vertex.g);
    view.setUint8(offset + 14, vertex.b);
    view.setUint8(offset + 15, vertex.a);
  });

  const bytes = new Uint8Array(headerBytes.byteLength + payload.byteLength);
  bytes.set(headerBytes, 0);
  bytes.set(new Uint8Array(payload), headerBytes.byteLength);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  return {
    name: 'point-cloud.ply',
    size: bytes.byteLength,
    type: 'application/octet-stream',
    arrayBuffer: async () => buffer,
    slice: (start?: number, end?: number) => new Blob([bytes.slice(start ?? 0, end ?? bytes.byteLength)]),
  } as unknown as File;
}

describe('gaussian splat loader orientation', () => {
  it('rotates canonical splat data into the editor basis', () => {
    const data = new Float32Array([
      1, 2, 3,
      4, 5, 6,
      1, 0, 0, 0,
      0.1, 0.2, 0.3, 0.4,
    ]);

    applyCanonicalBasisCorrection(data, 1);

    expect(Array.from(data.slice(0, 3))).toEqual([1, -2, -3]);
    expect(Array.from(data.slice(6, 10))).toEqual([0, 1, 0, 0]);
  });

  it('applies the basis correction during .splat import', async () => {
    const asset = await loadGaussianSplatAsset(createSplatFile(), 'splat');
    const data = asset.frames[0]?.buffer.data;

    expect(data).toBeDefined();
    expect(Array.from(data!.slice(0, 3))).toEqual([1, -2, -3]);
    expect(asset.metadata.boundingBox).toEqual({
      min: [1, -2, -3],
      max: [1, -2, -3],
    });
  });

  it('reports progress while loading splat assets', async () => {
    const events: GaussianSplatLoadProgress[] = [];

    await loadGaussianSplatAsset(createSplatFile(), 'splat', {
      onProgress: (progress) => events.push(progress),
    });

    expect(events.some((event) => event.phase === 'reading')).toBe(true);
    expect(events.some((event) => event.phase === 'parsing')).toBe(true);
    expect(events.some((event) => event.phase === 'normalizing')).toBe(true);
    expect(Math.max(...events.map((event) => event.percent ?? 0))).toBeGreaterThanOrEqual(0.96);
  });

  it('does not fall back to legacy point-cloud PLY conversion', async () => {
    await expect(loadGaussianSplatAsset(createPointCloudPlyFile(), 'ply')).rejects.toThrow(
      /invalid file header|Missing required splat properties/i,
    );
  });
});
