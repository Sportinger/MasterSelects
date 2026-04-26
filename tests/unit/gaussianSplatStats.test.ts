import { describe, expect, it } from 'vitest';

import {
  getGaussianSplatContainerLabelFromFileName,
  readGaussianSplatFileStats,
  summarizeGaussianSplatSequenceStats,
} from '../../src/stores/mediaStore/helpers/gaussianSplatStats';

function createPlyFile(name: string, vertexCount: number): File {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    'end_header',
    '',
  ].join('\n');
  const bytes = new TextEncoder().encode(header);
  return {
    name,
    size: bytes.byteLength,
    slice: () => ({
      arrayBuffer: async () => bytes.buffer.slice(0),
    }),
  } as File;
}

describe('gaussian splat stats', () => {
  it('reads splat count from PLY headers', async () => {
    const stats = await readGaussianSplatFileStats(createPlyFile('scan000000.ply', 12345));

    expect(stats).toMatchObject({
      splatCount: 12345,
      container: 'PLY',
      codec: 'Splat',
    });
  });

  it('derives .splat count from 32-byte records', async () => {
    const stats = await readGaussianSplatFileStats(new File([new Uint8Array(96)], 'scan.splat'));

    expect(stats.splatCount).toBe(3);
    expect(stats.container).toBe('SPLAT');
  });

  it('summarizes sequence counts and total size', () => {
    const summary = summarizeGaussianSplatSequenceStats([
      { name: 'scan000000.ply', splatCount: 1000, fileSize: 64, container: 'PLY', codec: 'Splat' },
      { name: 'scan000001.ply', splatCount: 2500, fileSize: 96, container: 'PLY', codec: 'Splat' },
    ]);

    expect(summary).toMatchObject({
      splatCount: 1000,
      totalSplatCount: 3500,
      minSplatCount: 1000,
      maxSplatCount: 2500,
      fileSize: 160,
      container: 'PLY',
      codec: 'Splat Seq',
    });
  });

  it('keeps compressed PLY grouped under the PLY container label', () => {
    expect(getGaussianSplatContainerLabelFromFileName('scan.compressed.ply')).toBe('PLY');
  });
});
