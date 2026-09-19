import { describe, expect, it } from 'vitest';

import { dropMpeg4DonorIFrame } from '../../src/services/datamosh/mpeg4Datamosh';

const startCode = (code: number, payload: number[]) => [0, 0, 1, code, ...payload];

describe('MPEG-4 Part 2 datamosh splicing', () => {
  it('drops the donor I-VOP while keeping one shared stream header', () => {
    const encoded = new Uint8Array([
      ...startCode(0xb0, [0x12]),
      ...startCode(0xb6, [0x00, 0xaa]),
      ...startCode(0xb6, [0x00, 0xbb]),
      ...startCode(0xb6, [0x40, 0xcc]),
      ...startCode(0xb6, [0x40, 0xdd]),
      ...startCode(0xb1, []),
    ]);

    const result = [...dropMpeg4DonorIFrame(encoded)];

    expect(result).toEqual([
      ...startCode(0xb0, [0x12]),
      ...startCode(0xb6, [0x00, 0xaa]),
      ...startCode(0xb6, [0x40, 0xcc]),
      ...startCode(0xb6, [0x40, 0xdd]),
      ...startCode(0xb1, []),
    ]);
    expect(result).not.toContain(0xbb);
  });

  it('rejects a stream without donor predictive frames', () => {
    const encoded = new Uint8Array([
      ...startCode(0xb6, [0x00, 0xaa]),
      ...startCode(0xb6, [0x00, 0xbb]),
    ]);

    expect(() => dropMpeg4DonorIFrame(encoded)).toThrow(/stream/);
  });
});
