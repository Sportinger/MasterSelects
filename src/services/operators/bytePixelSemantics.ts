export type BytePixel = readonly [number, number, number, number];
export type BytePixelFloatMode = 'clamp' | 'wrap' | 'absolute';

const requireWord = (word: number): number => {
  if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) throw new Error('Byte pixel words must be unsigned 32-bit integers.');
  return word;
};
const unorm = (value: number, maximum: number) => Math.fround(value / maximum);

/** Decodes one little-endian packed word like WGSL unpack4x8unorm. The byte-texture
 * runtime only uploads words; this pure layer is needed by graph CPU references. */
export function decodeBytePixel8(word: number): BytePixel {
  word = requireWord(word);
  return [unorm(word & 0xff, 0xff), unorm((word >>> 8) & 0xff, 0xff),
    unorm((word >>> 16) & 0xff, 0xff), unorm((word >>> 24) & 0xff, 0xff)];
}

/** Decodes two consecutive little-endian words like two WGSL unpack2x16unorm calls. */
export function decodeBytePixel16(lowWord: number, highWord: number): BytePixel {
  lowWord = requireWord(lowWord); highWord = requireWord(highWord);
  return [unorm(lowWord & 0xffff, 0xffff), unorm((lowWord >>> 16) & 0xffff, 0xffff),
    unorm(highWord & 0xffff, 0xffff), unorm((highWord >>> 16) & 0xffff, 0xffff)];
}

function littleEndianFloat(word: number): number {
  const floatBits = new DataView(new ArrayBuffer(4));
  floatBits.setUint32(0, requireWord(word), true);
  return floatBits.getFloat32(0, true);
}

export function decodeByteFloatChannel(word: number, mode: BytePixelFloatMode, floatGain: number): number {
  word = requireWord(word);
  if (mode !== 'clamp' && mode !== 'wrap' && mode !== 'absolute') throw new Error(`Unsupported byte pixel float mode: ${String(mode)}.`);
  if ((word & 0x7f800000) === 0x7f800000) return 0;
  if (!Number.isFinite(floatGain)) throw new Error('Byte pixel float gain must be finite.');
  const value = Math.fround(littleEndianFloat(word) * Math.fround(floatGain));
  if (mode === 'clamp') return Math.min(1, Math.max(0, value));
  const absolute = Math.abs(value);
  if (mode === 'wrap') return Math.fround(absolute - Math.floor(absolute));
  return Math.min(1, absolute);
}

/** Decodes four consecutive words as little-endian IEEE-754 channels. */
export function decodeBytePixel32(words: readonly [number, number, number, number], mode: BytePixelFloatMode, floatGain: number): BytePixel {
  return words.map(word => decodeByteFloatChannel(word, mode, floatGain)) as unknown as BytePixel;
}
