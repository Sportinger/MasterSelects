import { describe, expect, it } from 'vitest';
import { loadPly } from '../../src/engine/gaussian/loaders/PlyLoader';

function createBinaryPly(vertexCount: number): File {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
    '',
  ].join('\n');
  const headerBytes = new TextEncoder().encode(header);
  const stride = 15;
  const payload = new ArrayBuffer(vertexCount * stride);
  const view = new DataView(payload);

  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * stride;
    view.setFloat32(offset + 0, index, true);
    view.setFloat32(offset + 4, index + 0.25, true);
    view.setFloat32(offset + 8, index + 0.5, true);
    view.setUint8(offset + 12, 10 + index);
    view.setUint8(offset + 13, 20 + index);
    view.setUint8(offset + 14, 30 + index);
  }

  const bytes = new Uint8Array(headerBytes.byteLength + payload.byteLength);
  bytes.set(headerBytes, 0);
  bytes.set(new Uint8Array(payload), headerBytes.byteLength);
  return {
    name: 'sequence-frame.ply',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(0),
  } as File;
}

describe('loadPly', () => {
  it('can downsample a binary PLY for realtime splat sequence preview', async () => {
    const asset = await loadPly(createBinaryPly(6), { maxSplats: 3 });
    const frame = asset.frames[0];

    expect(asset.metadata.splatCount).toBe(3);
    expect(frame?.buffer.splatCount).toBe(3);
    expect(Array.from(frame?.buffer.data.slice(0, 3) ?? [])).toEqual([0, 0.25, 0.5]);
    expect(Array.from(frame?.buffer.data.slice(14, 17) ?? [])).toEqual([2, 2.25, 2.5]);
    expect(Array.from(frame?.buffer.data.slice(28, 31) ?? [])).toEqual([4, 4.25, 4.5]);
  });
});
