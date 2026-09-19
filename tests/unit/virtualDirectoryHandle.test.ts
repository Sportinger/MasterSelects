import { describe, expect, it } from 'vitest';
import { inspectColmapDataset } from '../../src/services/photogrammetry/colmapDataset';
import {
  createVirtualDirectoryHandle,
  createVirtualDirectoryHandleFromEntries,
} from '../../src/services/photogrammetry/virtualDirectoryHandle';

function folderFile(path: string): File {
  const file = new File(['x'], path.split('/').at(-1) ?? 'file');
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('virtual photogrammetry directory handles', () => {
  it('exposes a selected COLMAP folder through the File System Access shape', async () => {
    const handle = createVirtualDirectoryHandle([
      folderFile('scan/images/frame-0001.jpg'),
      folderFile('scan/images/frame-0002.jpg'),
      folderFile('scan/sparse/0/cameras.bin'),
      folderFile('scan/sparse/0/images.bin'),
      folderFile('scan/sparse/0/points3D.bin'),
    ]);

    await expect(inspectColmapDataset(handle)).resolves.toMatchObject({
      status: 'valid',
      name: 'scan',
      imageCount: 2,
      modelFormat: 'binary',
    });
  });

  it('rebuilds paths sent through the training worker contract', async () => {
    const handle = createVirtualDirectoryHandleFromEntries([
      { file: new File(['x'], 'frame.jpg'), path: 'dataset/images/frame.jpg' },
      { file: new File(['x'], 'cameras.bin'), path: 'dataset/sparse/0/cameras.bin' },
      { file: new File(['x'], 'images.bin'), path: 'dataset/sparse/0/images.bin' },
      { file: new File(['x'], 'points3D.bin'), path: 'dataset/sparse/0/points3D.bin' },
    ]);

    await expect(inspectColmapDataset(handle)).resolves.toMatchObject({
      status: 'valid',
      name: 'dataset',
      imageCount: 1,
    });
  });
});
