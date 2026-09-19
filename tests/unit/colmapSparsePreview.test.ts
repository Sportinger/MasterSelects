import { describe, expect, it } from 'vitest';
import { parsePlyHeader } from '../../src/engine/gaussian/loaders/PlyLoader';
import { createColmapSparsePreviewSplat } from '../../src/services/photogrammetry/colmapSparsePreview';
import { createVirtualDirectoryHandle } from '../../src/services/photogrammetry/virtualDirectoryHandle';

function createPointsFile(): File {
  const buffer = new ArrayBuffer(8 + 2 * 51);
  const view = new DataView(buffer);
  view.setUint32(0, 2, true);
  let offset = 8;
  for (const [index, point] of [[1, 2, 3, 255, 0, 0], [-1, -2, -3, 0, 255, 0]].entries()) {
    view.setUint32(offset, index + 1, true); offset += 8;
    view.setFloat64(offset, point[0], true);
    view.setFloat64(offset + 8, point[1], true);
    view.setFloat64(offset + 16, point[2], true); offset += 24;
    view.setUint8(offset, point[3]); view.setUint8(offset + 1, point[4]); view.setUint8(offset + 2, point[5]); offset += 3;
    view.setFloat64(offset, 0.4, true); offset += 8;
    view.setUint32(offset, 0, true); offset += 8;
  }
  const file = new File([buffer], 'points3D.bin');
  Object.defineProperty(file, 'webkitRelativePath', { value: 'scan/sparse/0/points3D.bin' });
  return file;
}

describe('COLMAP sparse preview splats', () => {
  it('converts binary sparse points into a renderable point-cloud PLY', async () => {
    const result = await createColmapSparsePreviewSplat(
      createVirtualDirectoryHandle([createPointsFile()]),
      'scan',
    );
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(result.file);
    });
    const header = parsePlyHeader(new Uint8Array(bytes));
    expect(result.pointCount).toBe(2);
    expect(result.file.name).toBe('scan-sparse-preview.ply');
    expect(header).toMatchObject({ vertexCount: 2, perVertexByteStride: 15 });
  });
});
