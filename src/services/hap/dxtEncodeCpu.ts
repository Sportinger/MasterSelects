// CPU BC1/BC3 (DXT1/DXT5) block compression for HAP encoding.
// Range-fit with inset — the quality tier realtime HAP encoders ship.
// The WebGPU compute path implements the same algorithm; this module is the
// reference implementation, the non-GPU fallback, and the probe target.

export type HapTextureEncodeFormat = 'bc1' | 'bc3' | 'ycocg-bc3';

export function blockDimensions(width: number, height: number): {
  blocksX: number;
  blocksY: number;
} {
  return {
    blocksX: Math.max(1, Math.ceil(width / 4)),
    blocksY: Math.max(1, Math.ceil(height / 4)),
  };
}

export function compressedTextureByteLength(
  format: HapTextureEncodeFormat,
  width: number,
  height: number,
): number {
  const { blocksX, blocksY } = blockDimensions(width, height);
  const bytesPerBlock = format === 'bc1' ? 8 : 16;
  return blocksX * blocksY * bytesPerBlock;
}

function expand565(c: number): [number, number, number] {
  const r5 = (c >>> 11) & 0x1f;
  const g6 = (c >>> 5) & 0x3f;
  const b5 = c & 0x1f;
  return [
    (r5 << 3) | (r5 >>> 2),
    (g6 << 2) | (g6 >>> 4),
    (b5 << 3) | (b5 >>> 2),
  ];
}

function pack565(r: number, g: number, b: number): number {
  const r5 = Math.min(31, Math.max(0, Math.round((r * 31) / 255)));
  const g6 = Math.min(63, Math.max(0, Math.round((g * 63) / 255)));
  const b5 = Math.min(31, Math.max(0, Math.round((b * 31) / 255)));
  return (r5 << 11) | (g6 << 5) | b5;
}

/**
 * Gather one 4x4 block of RGBA pixels, clamping reads at the image edge so
 * partial blocks replicate their border pixels.
 */
function gatherBlock(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  blockX: number,
  blockY: number,
  out: Uint8Array,
): void {
  for (let py = 0; py < 4; py++) {
    const sy = Math.min(height - 1, blockY * 4 + py);
    for (let px = 0; px < 4; px++) {
      const sx = Math.min(width - 1, blockX * 4 + px);
      const src = (sy * width + sx) * 4;
      const dst = (py * 4 + px) * 4;
      out[dst] = rgba[src];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src + 2];
      out[dst + 3] = rgba[src + 3];
    }
  }
}

/** Write one BC1 color block (8 bytes) for 16 RGBA pixels. */
function writeColorBlock(pixels: Uint8Array, out: Uint8Array, offset: number): void {
  let minR = 255; let minG = 255; let minB = 255;
  let maxR = 0; let maxG = 0; let maxB = 0;
  for (let i = 0; i < 16; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (g < minG) minG = g; if (g > maxG) maxG = g;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }

  // Inset the bounding box by 1/16th of its range to reduce quantization error.
  const insetR = (maxR - minR) >>> 4;
  const insetG = (maxG - minG) >>> 4;
  const insetB = (maxB - minB) >>> 4;
  minR += insetR; minG += insetG; minB += insetB;
  maxR -= insetR; maxG -= insetG; maxB -= insetB;

  let c0 = pack565(maxR, maxG, maxB);
  let c1 = pack565(minR, minG, minB);
  if (c0 < c1) {
    const swap = c0; c0 = c1; c1 = swap;
  }

  out[offset] = c0 & 0xff;
  out[offset + 1] = (c0 >>> 8) & 0xff;
  out[offset + 2] = c1 & 0xff;
  out[offset + 3] = (c1 >>> 8) & 0xff;

  if (c0 === c1) {
    // Flat block: index 0 resolves to the single endpoint in either mode.
    out[offset + 4] = 0;
    out[offset + 5] = 0;
    out[offset + 6] = 0;
    out[offset + 7] = 0;
    return;
  }

  const [p0r, p0g, p0b] = expand565(c0);
  const [p1r, p1g, p1b] = expand565(c1);
  // c0 > c1 selects four-color mode.
  const palette = [
    [p0r, p0g, p0b],
    [p1r, p1g, p1b],
    [(2 * p0r + p1r + 1) / 3, (2 * p0g + p1g + 1) / 3, (2 * p0b + p1b + 1) / 3],
    [(p0r + 2 * p1r + 1) / 3, (p0g + 2 * p1g + 1) / 3, (p0b + 2 * p1b + 1) / 3],
  ];

  for (let row = 0; row < 4; row++) {
    let bits = 0;
    for (let col = 0; col < 4; col++) {
      const i = row * 4 + col;
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let p = 0; p < 4; p++) {
        const dr = r - palette[p][0];
        const dg = g - palette[p][1];
        const db = b - palette[p][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      }
      bits |= best << (col * 2);
    }
    out[offset + 4 + row] = bits;
  }
}

/** Write one BC3/BC4-style alpha block (8 bytes) for 16 alpha values. */
function writeAlphaBlock(
  pixels: Uint8Array,
  channelOffset: number,
  out: Uint8Array,
  offset: number,
): void {
  let minA = 255;
  let maxA = 0;
  for (let i = 0; i < 16; i++) {
    const a = pixels[i * 4 + channelOffset];
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }

  out[offset] = maxA;
  out[offset + 1] = minA;
  if (maxA === minA) {
    for (let i = 2; i < 8; i++) out[offset + i] = 0;
    return;
  }

  // a0 > a1 selects the eight-value interpolated ramp.
  const palette = new Float64Array(8);
  palette[0] = maxA;
  palette[1] = minA;
  for (let i = 2; i < 8; i++) {
    palette[i] = ((8 - i) * maxA + (i - 1) * minA) / 7;
  }

  let bitBuffer = 0;
  let bitCount = 0;
  let byteIndex = offset + 2;
  for (let i = 0; i < 16; i++) {
    const a = pixels[i * 4 + channelOffset];
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let p = 0; p < 8; p++) {
      const dist = Math.abs(a - palette[p]);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    bitBuffer |= best << bitCount;
    bitCount += 3;
    while (bitCount >= 8) {
      out[byteIndex++] = bitBuffer & 0xff;
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  }
}

/**
 * Convert one gathered RGBA block to scaled-YCoCg layout in place:
 * R=Co*scale+128, G=Cg*scale+128, B=(scale-1)*8, A=Y. The BC3 encoder then
 * stores Y in the high-precision alpha ramp (the HAP Q arrangement).
 */
function blockToScaledYCoCg(pixels: Uint8Array): void {
  const co = new Float64Array(16);
  const cg = new Float64Array(16);
  const y = new Float64Array(16);
  let maxAbs = 0;
  for (let i = 0; i < 16; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    y[i] = r * 0.25 + g * 0.5 + b * 0.25;
    co[i] = (r - b) * 0.5;
    cg[i] = (2 * g - r - b) * 0.25;
    const abs = Math.max(Math.abs(co[i]), Math.abs(cg[i]));
    if (abs > maxAbs) maxAbs = abs;
  }

  const scale = maxAbs < 32 ? 4 : maxAbs < 64 ? 2 : 1;
  const scaleByte = (scale - 1) * 8;
  for (let i = 0; i < 16; i++) {
    pixels[i * 4] = Math.min(255, Math.max(0, Math.round(co[i] * scale + 128)));
    pixels[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(cg[i] * scale + 128)));
    pixels[i * 4 + 2] = scaleByte;
    pixels[i * 4 + 3] = Math.min(255, Math.max(0, Math.round(y[i])));
  }
}

/**
 * Compress an RGBA8 image into the requested BC layout.
 * Returns tightly packed blocks in row-major block order.
 */
export function encodeTextureCpu(
  format: HapTextureEncodeFormat,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  if (width <= 0 || height <= 0) throw new Error('HAP encode requires positive dimensions');
  if (rgba.length < width * height * 4) {
    throw new Error(`HAP encode input too small: ${rgba.length} < ${width * height * 4}`);
  }

  const { blocksX, blocksY } = blockDimensions(width, height);
  const bytesPerBlock = format === 'bc1' ? 8 : 16;
  const out = new Uint8Array(blocksX * blocksY * bytesPerBlock);
  const block = new Uint8Array(64);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      gatherBlock(rgba, width, height, bx, by, block);
      const offset = (by * blocksX + bx) * bytesPerBlock;
      if (format === 'bc1') {
        writeColorBlock(block, out, offset);
      } else if (format === 'bc3') {
        writeAlphaBlock(block, 3, out, offset);
        writeColorBlock(block, out, offset + 8);
      } else {
        blockToScaledYCoCg(block);
        writeAlphaBlock(block, 3, out, offset);
        writeColorBlock(block, out, offset + 8);
      }
    }
  }
  return out;
}
