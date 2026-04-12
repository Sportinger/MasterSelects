import { describe, expect, it } from 'vitest';

import { applyCanonicalBasisCorrection } from '../../src/engine/gaussian/loaders/normalize';
import { loadGaussianSplatAsset } from '../../src/engine/gaussian/loaders';

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
});
