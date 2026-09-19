// CPU BC1/BC3/BC4 (DXT1/DXT5/RGTC1) decompression plus the scaled-YCoCg
// reconstruction used by HAP Q. Used by the HAP frame provider fallback and
// by conformance probes; GPU-native compressed-texture presentation can be
// layered on top later without changing this contract.

export type HapDecodeTextureFormat = 'bc1' | 'bc3' | 'ycocg-bc3' | 'bc4-alpha' | 'bc4-luma';

export function decodedBytesPerBlock(format: HapDecodeTextureFormat): number {
  return format === 'bc1' || format === 'bc4-alpha' || format === 'bc4-luma' ? 8 : 16;
}

function expand565(c: number, out: Uint8Array, offset: number): void {
  const r5 = (c >>> 11) & 0x1f;
  const g6 = (c >>> 5) & 0x3f;
  const b5 = c & 0x1f;
  out[offset] = (r5 << 3) | (r5 >>> 2);
  out[offset + 1] = (g6 << 2) | (g6 >>> 4);
  out[offset + 2] = (b5 << 3) | (b5 >>> 2);
}

const colorPalette = new Uint8Array(16);
const alphaPalette = new Uint8Array(8);
const alphaIndices = new Uint8Array(16);

/** Build the 4-entry RGB palette. `forceFourColors` is set for BC3 blocks. */
function buildColorPalette(c0: number, c1: number, forceFourColors: boolean): boolean {
  expand565(c0, colorPalette, 0);
  expand565(c1, colorPalette, 4);
  if (c0 > c1 || forceFourColors) {
    for (let ch = 0; ch < 3; ch++) {
      colorPalette[8 + ch] = Math.round((2 * colorPalette[ch] + colorPalette[4 + ch]) / 3);
      colorPalette[12 + ch] = Math.round((colorPalette[ch] + 2 * colorPalette[4 + ch]) / 3);
    }
    return false;
  }
  for (let ch = 0; ch < 3; ch++) {
    colorPalette[8 + ch] = Math.round((colorPalette[ch] + colorPalette[4 + ch]) / 2);
    colorPalette[12 + ch] = 0;
  }
  return true; // index 3 is transparent black in BC1 three-color mode
}

function buildAlphaBlock(blocks: Uint8Array, offset: number): void {
  const a0 = blocks[offset];
  const a1 = blocks[offset + 1];
  alphaPalette[0] = a0;
  alphaPalette[1] = a1;
  if (a0 > a1) {
    for (let i = 2; i < 8; i++) {
      alphaPalette[i] = Math.round(((8 - i) * a0 + (i - 1) * a1) / 7);
    }
  } else {
    for (let i = 2; i < 6; i++) {
      alphaPalette[i] = Math.round(((6 - i) * a0 + (i - 1) * a1) / 5);
    }
    alphaPalette[6] = 0;
    alphaPalette[7] = 255;
  }

  let bitBuffer = 0;
  let bitCount = 0;
  let byteIndex = offset + 2;
  for (let i = 0; i < 16; i++) {
    while (bitCount < 3) {
      bitBuffer |= blocks[byteIndex++] << bitCount;
      bitCount += 8;
    }
    alphaIndices[i] = bitBuffer & 0x7;
    bitBuffer >>>= 3;
    bitCount -= 3;
  }
}

function scaledYCoCgToRgb(rgba: Uint8Array, pixelOffset: number): void {
  const co = rgba[pixelOffset];
  const cg = rgba[pixelOffset + 1];
  const scale = rgba[pixelOffset + 2] / 8 + 1;
  const y = rgba[pixelOffset + 3];
  const coCentered = (co - 128) / scale;
  const cgCentered = (cg - 128) / scale;
  rgba[pixelOffset] = Math.min(255, Math.max(0, Math.round(y + coCentered - cgCentered)));
  rgba[pixelOffset + 1] = Math.min(255, Math.max(0, Math.round(y + cgCentered)));
  rgba[pixelOffset + 2] = Math.min(255, Math.max(0, Math.round(y - coCentered - cgCentered)));
  rgba[pixelOffset + 3] = 255;
}

/**
 * Decode tightly packed BC blocks into an RGBA8 image of `width`x`height`.
 * When `target` is passed it must be width*height*4 bytes and is written in
 * place (BC4 alpha planes only touch the alpha channel).
 */
export function decodeTextureCpu(
  format: HapDecodeTextureFormat,
  blocks: Uint8Array,
  width: number,
  height: number,
  target?: Uint8Array,
): Uint8Array {
  const blocksX = Math.max(1, Math.ceil(width / 4));
  const blocksY = Math.max(1, Math.ceil(height / 4));
  const bytesPerBlock = decodedBytesPerBlock(format);
  const expected = blocksX * blocksY * bytesPerBlock;
  if (blocks.length < expected) {
    throw new Error(`HAP texture data too small: ${blocks.length} < ${expected} (${format})`);
  }
  const out = target ?? new Uint8Array(width * height * 4);
  if (out.length !== width * height * 4) {
    throw new Error('HAP decode target has wrong size');
  }

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockOffset = (by * blocksX + bx) * bytesPerBlock;

      if (format === 'bc4-alpha' || format === 'bc4-luma') {
        buildAlphaBlock(blocks, blockOffset);
        for (let py = 0; py < 4; py++) {
          const y = by * 4 + py;
          if (y >= height) break;
          for (let px = 0; px < 4; px++) {
            const x = bx * 4 + px;
            if (x >= width) break;
            const value = alphaPalette[alphaIndices[py * 4 + px]];
            const dst = (y * width + x) * 4;
            if (format === 'bc4-alpha') {
              out[dst + 3] = value;
            } else {
              out[dst] = value;
              out[dst + 1] = value;
              out[dst + 2] = value;
              out[dst + 3] = 255;
            }
          }
        }
        continue;
      }

      const hasAlphaBlock = format !== 'bc1';
      const colorOffset = hasAlphaBlock ? blockOffset + 8 : blockOffset;
      if (hasAlphaBlock) buildAlphaBlock(blocks, blockOffset);
      const c0 = blocks[colorOffset] | (blocks[colorOffset + 1] << 8);
      const c1 = blocks[colorOffset + 2] | (blocks[colorOffset + 3] << 8);
      const transparentIndex3 = buildColorPalette(c0, c1, hasAlphaBlock);

      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= height) break;
        const rowBits = blocks[colorOffset + 4 + py];
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= width) break;
          const index = (rowBits >>> (px * 2)) & 0x3;
          const dst = (y * width + x) * 4;
          out[dst] = colorPalette[index * 4];
          out[dst + 1] = colorPalette[index * 4 + 1];
          out[dst + 2] = colorPalette[index * 4 + 2];
          if (format === 'bc1') {
            out[dst + 3] = transparentIndex3 && index === 3 ? 0 : 255;
          } else if (format === 'bc3') {
            out[dst + 3] = alphaPalette[alphaIndices[py * 4 + px]];
          } else {
            // ycocg-bc3: stash Y in alpha, then reconstruct RGB in place.
            out[dst + 3] = alphaPalette[alphaIndices[py * 4 + px]];
            scaledYCoCgToRgb(out, dst);
          }
        }
      }
    }
  }
  return out;
}
