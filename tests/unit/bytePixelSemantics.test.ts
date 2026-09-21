import { describe, expect, it } from 'vitest';
import { decodeByteFloatChannel, decodeBytePixel8, decodeBytePixel16, decodeBytePixel32 } from '../../src/services/operators/bytePixelSemantics';

const bits = (value: number) => { const view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, value, true); return view.getUint32(0, true); };

describe('memory byte pixel semantics', () => {
  it('unpacks one word as four little-endian 8-bit UNORM channels', () => {
    expect(decodeBytePixel8(0xff804000)).toEqual([0, Math.fround(64 / 255), Math.fround(128 / 255), 1]);
  });

  it('unpacks two words as four little-endian 16-bit UNORM channels', () => {
    expect(decodeBytePixel16(0x80000000, 0xffff4000)).toEqual([0, Math.fround(0x8000 / 0xffff), Math.fround(0x4000 / 0xffff), 1]);
  });

  it('maps four float words with f32 gain before clamp, wrap, or absolute mode', () => {
    const words = [bits(.1), bits(-.25), bits(1.5), bits(-2.25)] as const;
    expect(decodeBytePixel32(words, 'clamp', 2)).toEqual([Math.fround(Math.fround(.1) * 2), 0, 1, 0]);
    expect(decodeBytePixel32(words, 'wrap', 2)).toEqual([Math.fround(Math.fround(.1) * 2), .5, 0, .5]);
    expect(decodeBytePixel32(words, 'absolute', .5)).toEqual([
      Math.abs(Math.fround(Math.fround(.1) * Math.fround(.5))), .125, .75, 1,
    ]);
  });

  it('turns every exponent-all-ones record into zero before applying gain', () => {
    expect(decodeByteFloatChannel(0x7f800000, 'absolute', 10)).toBe(0);
    expect(decodeByteFloatChannel(0xff800000, 'wrap', 10)).toBe(0);
    expect(decodeByteFloatChannel(0x7fc12345, 'clamp', 10)).toBe(0);
  });

  it('rejects values that are not genuine u32 words and invalid gain', () => {
    expect(() => decodeBytePixel8(-1)).toThrow(/unsigned 32-bit/);
    expect(() => decodeBytePixel16(1.5, 0)).toThrow(/unsigned 32-bit/);
    expect(() => decodeBytePixel32([0, 0, 0, 0x1_0000_0000], 'clamp', 1)).toThrow(/unsigned 32-bit/);
    expect(() => decodeByteFloatChannel(0, 'clamp', Number.NaN)).toThrow(/finite/);
    expect(() => decodeByteFloatChannel(0x7f800000, 'unknown' as never, 1)).toThrow(/Unsupported/);
  });
});
