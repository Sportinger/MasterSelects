import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractColmapDatasetArchive } from '../../src/services/photogrammetry/colmapDatasetArchive';
import { inspectColmapDataset } from '../../src/services/photogrammetry/colmapDataset';
import { createVirtualDirectoryHandle } from '../../src/services/photogrammetry/virtualDirectoryHandle';

describe('COLMAP dataset archives', () => {
  it('turns a ZIP into a Brush-compatible directory handle', async () => {
    const bytes = zipSync({
      'scan/images/frame-0001.jpg': new Uint8Array([1]),
      'scan/sparse/0/cameras.bin': new Uint8Array([2]),
      'scan/sparse/0/images.bin': new Uint8Array([3]),
      'scan/sparse/0/points3D.bin': new Uint8Array([4]),
    });
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const files = await extractColmapDatasetArchive(new File([buffer], 'scan.zip'));

    await expect(inspectColmapDataset(createVirtualDirectoryHandle(files))).resolves.toMatchObject({
      status: 'valid',
      name: 'scan',
      imageCount: 1,
      modelFormat: 'binary',
    });
  });
});
