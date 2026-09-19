// tools/hap-probe/hapProbe.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// src/services/hap/snappy.ts
var MAX_HASH_TABLE_BITS = 14;
var HASH_MULTIPLIER = 506832829;
var INPUT_MARGIN = 15;
var BLOCK_SIZE = 65536;
function snappyMaxCompressedLength(sourceLength) {
  return 32 + sourceLength + Math.floor(sourceLength / 6);
}
function writeVarint(out, offset, value) {
  let v = value >>> 0;
  while (v >= 128) {
    out[offset++] = v & 127 | 128;
    v >>>= 7;
  }
  out[offset++] = v;
  return offset;
}
function readVarint(data, offset) {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    if (offset >= data.length) throw new Error("Snappy: truncated length varint");
    const byte = data[offset++];
    value |= (byte & 127) << shift;
    if ((byte & 128) === 0) return { value: value >>> 0, offset };
    shift += 7;
  }
  throw new Error("Snappy: length varint too long");
}
function load32(data, offset) {
  return (data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24) >>> 0;
}
function hash32(value, shift) {
  return Math.imul(value, HASH_MULTIPLIER) >>> shift >>> 0;
}
function emitLiteral(src, start, length, out, op) {
  const n = length - 1;
  if (n < 60) {
    out[op++] = n << 2;
  } else if (n < 256) {
    out[op++] = 60 << 2;
    out[op++] = n;
  } else {
    out[op++] = 61 << 2;
    out[op++] = n & 255;
    out[op++] = n >>> 8 & 255;
  }
  out.set(src.subarray(start, start + length), op);
  return op + length;
}
function emitCopyElement(out, op, offset, length) {
  if (length <= 11 && offset <= 2047) {
    out[op++] = 1 | length - 4 << 2 | offset >>> 8 << 5;
    out[op++] = offset & 255;
  } else {
    out[op++] = 2 | length - 1 << 2;
    out[op++] = offset & 255;
    out[op++] = offset >>> 8 & 255;
  }
  return op;
}
function emitCopy(out, op, offset, length) {
  let remaining = length;
  while (remaining >= 68) {
    op = emitCopyElement(out, op, offset, 64);
    remaining -= 64;
  }
  if (remaining > 64) {
    op = emitCopyElement(out, op, offset, 60);
    remaining -= 60;
  }
  return emitCopyElement(out, op, offset, remaining);
}
function compressBlock(src, blockStart, blockEnd, table, out, opStart) {
  table.fill(-1);
  const shift = 32 - MAX_HASH_TABLE_BITS;
  let op = opStart;
  let nextEmit = blockStart;
  const blockLength = blockEnd - blockStart;
  if (blockLength >= INPUT_MARGIN) {
    const ipLimit = blockEnd - INPUT_MARGIN;
    let ip = blockStart;
    outer: while (true) {
      let skip = 32;
      let candidate = -1;
      let nextIp = ip + 1;
      while (true) {
        ip = nextIp;
        if (ip > ipLimit) break outer;
        const hash = hash32(load32(src, ip), shift);
        nextIp = ip + (skip >>> 5);
        skip++;
        candidate = table[hash];
        table[hash] = ip - blockStart;
        if (candidate >= 0 && load32(src, blockStart + candidate) === load32(src, ip)) {
          candidate = blockStart + candidate;
          break;
        }
      }
      if (nextEmit < ip) {
        op = emitLiteral(src, nextEmit, ip - nextEmit, out, op);
      }
      let matched = 4;
      while (ip + matched < blockEnd && src[ip + matched] === src[candidate + matched]) {
        matched++;
      }
      op = emitCopy(out, op, ip - candidate, matched);
      ip += matched;
      nextEmit = ip;
      if (ip > ipLimit) break;
      table[hash32(load32(src, ip - 1), shift)] = ip - 1 - blockStart;
      ip -= 1;
    }
  }
  if (nextEmit < blockEnd) {
    op = emitLiteral(src, nextEmit, blockEnd - nextEmit, out, op);
  }
  return op;
}
function snappyCompress(source) {
  const out = new Uint8Array(snappyMaxCompressedLength(source.length));
  let op = writeVarint(out, 0, source.length);
  const table = new Int32Array(1 << MAX_HASH_TABLE_BITS);
  for (let start = 0; start < source.length; start += BLOCK_SIZE) {
    const end = Math.min(start + BLOCK_SIZE, source.length);
    op = compressBlock(source, start, end, table, out, op);
  }
  if (source.length === 0) {
  }
  return out.slice(0, op);
}
function snappyUncompress(compressed, target) {
  const header = readVarint(compressed, 0);
  const expected = header.value;
  const out = target ?? new Uint8Array(expected);
  if (out.length !== expected) {
    throw new Error(`Snappy: target length ${out.length} does not match announced ${expected}`);
  }
  let ip = header.offset;
  let op = 0;
  const ipEnd = compressed.length;
  while (ip < ipEnd) {
    const tag = compressed[ip++];
    const elementType = tag & 3;
    if (elementType === 0) {
      let length2 = (tag >>> 2) + 1;
      if (length2 > 60) {
        const extraBytes = length2 - 60;
        if (ip + extraBytes > ipEnd) throw new Error("Snappy: truncated literal length");
        length2 = 0;
        for (let i = 0; i < extraBytes; i++) {
          length2 |= compressed[ip + i] << 8 * i;
        }
        length2 = (length2 >>> 0) + 1;
        ip += extraBytes;
      }
      if (ip + length2 > ipEnd) throw new Error("Snappy: literal overruns input");
      if (op + length2 > out.length) throw new Error("Snappy: literal overruns output");
      out.set(compressed.subarray(ip, ip + length2), op);
      ip += length2;
      op += length2;
      continue;
    }
    let length;
    let offset;
    if (elementType === 1) {
      if (ip >= ipEnd) throw new Error("Snappy: truncated copy element");
      length = 4 + (tag >>> 2 & 7);
      offset = tag >>> 5 << 8 | compressed[ip++];
    } else if (elementType === 2) {
      if (ip + 2 > ipEnd) throw new Error("Snappy: truncated copy element");
      length = (tag >>> 2) + 1;
      offset = compressed[ip] | compressed[ip + 1] << 8;
      ip += 2;
    } else {
      if (ip + 4 > ipEnd) throw new Error("Snappy: truncated copy element");
      length = (tag >>> 2) + 1;
      offset = (compressed[ip] | compressed[ip + 1] << 8 | compressed[ip + 2] << 16 | compressed[ip + 3] << 24) >>> 0;
      ip += 4;
    }
    if (offset === 0 || offset > op) throw new Error("Snappy: copy offset out of range");
    if (op + length > out.length) throw new Error("Snappy: copy overruns output");
    let from = op - offset;
    for (let i = 0; i < length; i++) {
      out[op + i] = out[from + i];
    }
    op += length;
  }
  if (op !== expected) {
    throw new Error(`Snappy: produced ${op} bytes, expected ${expected}`);
  }
  return out;
}

// src/services/hap/dxtEncodeCpu.ts
function blockDimensions(width, height) {
  return {
    blocksX: Math.max(1, Math.ceil(width / 4)),
    blocksY: Math.max(1, Math.ceil(height / 4))
  };
}
function compressedTextureByteLength(format, width, height) {
  const { blocksX, blocksY } = blockDimensions(width, height);
  const bytesPerBlock = format === "bc1" ? 8 : 16;
  return blocksX * blocksY * bytesPerBlock;
}
function expand565(c) {
  const r5 = c >>> 11 & 31;
  const g6 = c >>> 5 & 63;
  const b5 = c & 31;
  return [
    r5 << 3 | r5 >>> 2,
    g6 << 2 | g6 >>> 4,
    b5 << 3 | b5 >>> 2
  ];
}
function pack565(r, g, b) {
  const r5 = Math.min(31, Math.max(0, Math.round(r * 31 / 255)));
  const g6 = Math.min(63, Math.max(0, Math.round(g * 63 / 255)));
  const b5 = Math.min(31, Math.max(0, Math.round(b * 31 / 255)));
  return r5 << 11 | g6 << 5 | b5;
}
function gatherBlock(rgba, width, height, blockX, blockY, out) {
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
function writeColorBlock(pixels, out, offset) {
  let minR = 255;
  let minG = 255;
  let minB = 255;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  for (let i = 0; i < 16; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }
  const insetR = maxR - minR >>> 4;
  const insetG = maxG - minG >>> 4;
  const insetB = maxB - minB >>> 4;
  minR += insetR;
  minG += insetG;
  minB += insetB;
  maxR -= insetR;
  maxG -= insetG;
  maxB -= insetB;
  let c0 = pack565(maxR, maxG, maxB);
  let c1 = pack565(minR, minG, minB);
  if (c0 < c1) {
    const swap = c0;
    c0 = c1;
    c1 = swap;
  }
  out[offset] = c0 & 255;
  out[offset + 1] = c0 >>> 8 & 255;
  out[offset + 2] = c1 & 255;
  out[offset + 3] = c1 >>> 8 & 255;
  if (c0 === c1) {
    out[offset + 4] = 0;
    out[offset + 5] = 0;
    out[offset + 6] = 0;
    out[offset + 7] = 0;
    return;
  }
  const [p0r, p0g, p0b] = expand565(c0);
  const [p1r, p1g, p1b] = expand565(c1);
  const palette = [
    [p0r, p0g, p0b],
    [p1r, p1g, p1b],
    [(2 * p0r + p1r + 1) / 3, (2 * p0g + p1g + 1) / 3, (2 * p0b + p1b + 1) / 3],
    [(p0r + 2 * p1r + 1) / 3, (p0g + 2 * p1g + 1) / 3, (p0b + 2 * p1b + 1) / 3]
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
      bits |= best << col * 2;
    }
    out[offset + 4 + row] = bits;
  }
}
function writeAlphaBlock(pixels, channelOffset, out, offset) {
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
      out[byteIndex++] = bitBuffer & 255;
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  }
}
function blockToScaledYCoCg(pixels) {
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
function encodeTextureCpu(format, rgba, width, height) {
  if (width <= 0 || height <= 0) throw new Error("HAP encode requires positive dimensions");
  if (rgba.length < width * height * 4) {
    throw new Error(`HAP encode input too small: ${rgba.length} < ${width * height * 4}`);
  }
  const { blocksX, blocksY } = blockDimensions(width, height);
  const bytesPerBlock = format === "bc1" ? 8 : 16;
  const out = new Uint8Array(blocksX * blocksY * bytesPerBlock);
  const block = new Uint8Array(64);
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      gatherBlock(rgba, width, height, bx, by, block);
      const offset = (by * blocksX + bx) * bytesPerBlock;
      if (format === "bc1") {
        writeColorBlock(block, out, offset);
      } else if (format === "bc3") {
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

// src/services/hap/dxtDecodeCpu.ts
function decodedBytesPerBlock(format) {
  return format === "bc1" || format === "bc4-alpha" || format === "bc4-luma" ? 8 : 16;
}
function expand5652(c, out, offset) {
  const r5 = c >>> 11 & 31;
  const g6 = c >>> 5 & 63;
  const b5 = c & 31;
  out[offset] = r5 << 3 | r5 >>> 2;
  out[offset + 1] = g6 << 2 | g6 >>> 4;
  out[offset + 2] = b5 << 3 | b5 >>> 2;
}
var colorPalette = new Uint8Array(16);
var alphaPalette = new Uint8Array(8);
var alphaIndices = new Uint8Array(16);
function buildColorPalette(c0, c1, forceFourColors) {
  expand5652(c0, colorPalette, 0);
  expand5652(c1, colorPalette, 4);
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
  return true;
}
function buildAlphaBlock(blocks, offset) {
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
    alphaIndices[i] = bitBuffer & 7;
    bitBuffer >>>= 3;
    bitCount -= 3;
  }
}
function scaledYCoCgToRgb(rgba, pixelOffset) {
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
function decodeTextureCpu(format, blocks, width, height, target) {
  const blocksX = Math.max(1, Math.ceil(width / 4));
  const blocksY = Math.max(1, Math.ceil(height / 4));
  const bytesPerBlock = decodedBytesPerBlock(format);
  const expected = blocksX * blocksY * bytesPerBlock;
  if (blocks.length < expected) {
    throw new Error(`HAP texture data too small: ${blocks.length} < ${expected} (${format})`);
  }
  const out = target ?? new Uint8Array(width * height * 4);
  if (out.length !== width * height * 4) {
    throw new Error("HAP decode target has wrong size");
  }
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockOffset = (by * blocksX + bx) * bytesPerBlock;
      if (format === "bc4-alpha" || format === "bc4-luma") {
        buildAlphaBlock(blocks, blockOffset);
        for (let py = 0; py < 4; py++) {
          const y = by * 4 + py;
          if (y >= height) break;
          for (let px = 0; px < 4; px++) {
            const x = bx * 4 + px;
            if (x >= width) break;
            const value = alphaPalette[alphaIndices[py * 4 + px]];
            const dst = (y * width + x) * 4;
            if (format === "bc4-alpha") {
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
      const hasAlphaBlock = format !== "bc1";
      const colorOffset = hasAlphaBlock ? blockOffset + 8 : blockOffset;
      if (hasAlphaBlock) buildAlphaBlock(blocks, blockOffset);
      const c0 = blocks[colorOffset] | blocks[colorOffset + 1] << 8;
      const c1 = blocks[colorOffset + 2] | blocks[colorOffset + 3] << 8;
      const transparentIndex3 = buildColorPalette(c0, c1, hasAlphaBlock);
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= height) break;
        const rowBits = blocks[colorOffset + 4 + py];
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= width) break;
          const index = rowBits >>> px * 2 & 3;
          const dst = (y * width + x) * 4;
          out[dst] = colorPalette[index * 4];
          out[dst + 1] = colorPalette[index * 4 + 1];
          out[dst + 2] = colorPalette[index * 4 + 2];
          if (format === "bc1") {
            out[dst + 3] = transparentIndex3 && index === 3 ? 0 : 255;
          } else if (format === "bc3") {
            out[dst + 3] = alphaPalette[alphaIndices[py * 4 + px]];
          } else {
            out[dst + 3] = alphaPalette[alphaIndices[py * 4 + px]];
            scaledYCoCgToRgb(out, dst);
          }
        }
      }
    }
  }
  return out;
}

// src/services/hap/hapFrame.ts
var HAP_FORMAT_RGB_DXT1 = 11;
var HAP_FORMAT_RGBA_DXT5 = 14;
var HAP_FORMAT_YCOCG_DXT5 = 15;
var HAP_FORMAT_A_RGTC1 = 1;
var HAP_COMPRESSOR_NONE = 10;
var HAP_COMPRESSOR_SNAPPY = 11;
var HAP_COMPRESSOR_COMPLEX = 12;
var SECTION_DECODE_INSTRUCTIONS = 1;
var SECTION_CHUNK_COMPRESSORS = 2;
var SECTION_CHUNK_SIZES = 3;
var SECTION_CHUNK_OFFSETS = 4;
var SECTION_MULTIPLE_IMAGES = 13;
var CHUNK_COMPRESSOR_NONE = 10;
var CHUNK_COMPRESSOR_SNAPPY = 11;
function hapTextureFormatName(nibble) {
  switch (nibble) {
    case HAP_FORMAT_RGB_DXT1:
      return "bc1";
    case HAP_FORMAT_RGBA_DXT5:
      return "bc3";
    case HAP_FORMAT_YCOCG_DXT5:
      return "ycocg-bc3";
    case HAP_FORMAT_A_RGTC1:
      return "bc4-alpha";
    default:
      return void 0;
  }
}
function readSection(frame, offset, limit) {
  if (offset + 4 > limit) throw new Error("HAP frame: truncated section header");
  let size = frame[offset] | frame[offset + 1] << 8 | frame[offset + 2] << 16;
  const type = frame[offset + 3];
  let headerSize = 4;
  if (size === 0) {
    if (offset + 8 > limit) throw new Error("HAP frame: truncated extended section header");
    size = (frame[offset + 4] | frame[offset + 5] << 8 | frame[offset + 6] << 16 | frame[offset + 7] << 24) >>> 0;
    headerSize = 8;
  }
  const start = offset + headerSize;
  const end = start + size;
  if (end > limit) throw new Error(`HAP frame: section overruns data (${end} > ${limit})`);
  return { type, start, end };
}
function decodeChunkedPayload(frame, section) {
  const instructions = readSection(frame, section.start, section.end);
  if (instructions.type !== SECTION_DECODE_INSTRUCTIONS) {
    throw new Error(`HAP frame: expected decode instructions, got 0x${instructions.type.toString(16)}`);
  }
  let compressors = null;
  let sizes = null;
  let offsets = null;
  let cursor = instructions.start;
  while (cursor < instructions.end) {
    const sub = readSection(frame, cursor, instructions.end);
    if (sub.type === SECTION_CHUNK_COMPRESSORS) {
      compressors = frame.subarray(sub.start, sub.end);
    } else if (sub.type === SECTION_CHUNK_SIZES) {
      sizes = frame.subarray(sub.start, sub.end);
    } else if (sub.type === SECTION_CHUNK_OFFSETS) {
      offsets = frame.subarray(sub.start, sub.end);
    }
    cursor = sub.end;
  }
  if (!compressors || !sizes) {
    throw new Error("HAP frame: chunked payload lacks compressor or size table");
  }
  const chunkCount = compressors.length;
  if (sizes.length !== chunkCount * 4) {
    throw new Error("HAP frame: chunk size table length mismatch");
  }
  if (offsets && offsets.length !== chunkCount * 4) {
    throw new Error("HAP frame: chunk offset table length mismatch");
  }
  const dataStart = instructions.end;
  const parts = [];
  let totalLength = 0;
  let runningOffset = 0;
  for (let i = 0; i < chunkCount; i++) {
    const storedSize = (sizes[i * 4] | sizes[i * 4 + 1] << 8 | sizes[i * 4 + 2] << 16 | sizes[i * 4 + 3] << 24) >>> 0;
    const chunkOffset = offsets ? (offsets[i * 4] | offsets[i * 4 + 1] << 8 | offsets[i * 4 + 2] << 16 | offsets[i * 4 + 3] << 24) >>> 0 : runningOffset;
    const chunkStart = dataStart + chunkOffset;
    const chunkEnd = chunkStart + storedSize;
    if (chunkEnd > section.end) throw new Error("HAP frame: chunk overruns section");
    const stored = frame.subarray(chunkStart, chunkEnd);
    const compressor = compressors[i];
    let chunk;
    if (compressor === CHUNK_COMPRESSOR_SNAPPY) {
      chunk = snappyUncompress(stored);
    } else if (compressor === CHUNK_COMPRESSOR_NONE) {
      chunk = stored;
    } else {
      throw new Error(`HAP frame: unsupported chunk compressor 0x${compressor.toString(16)}`);
    }
    parts.push(chunk);
    totalLength += chunk.length;
    runningOffset += storedSize;
  }
  const out = new Uint8Array(totalLength);
  let write = 0;
  for (const part of parts) {
    out.set(part, write);
    write += part.length;
  }
  return out;
}
function decodeTextureSection(frame, section) {
  const compressor = section.type >>> 4 & 15;
  const formatNibble = section.type & 15;
  const formatName = hapTextureFormatName(formatNibble);
  if (!formatName) {
    throw new Error(`HAP frame: unsupported texture format 0x${formatNibble.toString(16)}`);
  }
  let data;
  if (compressor === HAP_COMPRESSOR_NONE) {
    data = frame.subarray(section.start, section.end);
  } else if (compressor === HAP_COMPRESSOR_SNAPPY) {
    data = snappyUncompress(frame.subarray(section.start, section.end));
  } else if (compressor === HAP_COMPRESSOR_COMPLEX) {
    data = decodeChunkedPayload(frame, section);
  } else {
    throw new Error(`HAP frame: unsupported compressor 0x${compressor.toString(16)}`);
  }
  return { formatNibble, formatName, data };
}
function parseHapFrame(frame) {
  const top = readSection(frame, 0, frame.length);
  if (top.type === SECTION_MULTIPLE_IMAGES) {
    const textures = [];
    let cursor = top.start;
    while (cursor < top.end) {
      const inner = readSection(frame, cursor, top.end);
      textures.push(decodeTextureSection(frame, inner));
      cursor = inner.end;
    }
    if (textures.length === 0) throw new Error("HAP frame: empty multiple-images section");
    return { textures };
  }
  return { textures: [decodeTextureSection(frame, top)] };
}
function sectionHeaderBytes(size) {
  return size < 16777215 ? 4 : 8;
}
function writeSectionHeader(out, offset, size, type) {
  if (size < 16777215) {
    out[offset] = size & 255;
    out[offset + 1] = size >>> 8 & 255;
    out[offset + 2] = size >>> 16 & 255;
    out[offset + 3] = type;
    return offset + 4;
  }
  out[offset] = 0;
  out[offset + 1] = 0;
  out[offset + 2] = 0;
  out[offset + 3] = type;
  out[offset + 4] = size & 255;
  out[offset + 5] = size >>> 8 & 255;
  out[offset + 6] = size >>> 16 & 255;
  out[offset + 7] = size >>> 24 & 255;
  return offset + 8;
}
function buildHapFrame(options) {
  const { formatNibble, texture } = options;
  const requestedChunks = Math.max(1, Math.floor(options.chunkCount ?? 1));
  const maxUseful = Math.max(1, Math.floor(texture.length / 65536));
  const chunkCount = Math.min(64, requestedChunks, maxUseful);
  if (chunkCount <= 1) {
    const compressed = snappyCompress(texture);
    const useSnappy = compressed.length < texture.length;
    const payload = useSnappy ? compressed : texture;
    const type2 = (useSnappy ? HAP_COMPRESSOR_SNAPPY : HAP_COMPRESSOR_NONE) << 4 | formatNibble;
    const headerBytes = sectionHeaderBytes(payload.length);
    const out2 = new Uint8Array(headerBytes + payload.length);
    const dataOffset = writeSectionHeader(out2, 0, payload.length, type2);
    out2.set(payload, dataOffset);
    return out2;
  }
  const baseSize = Math.ceil(texture.length / chunkCount);
  const chunks = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * baseSize;
    const end = Math.min(texture.length, start + baseSize);
    const raw = texture.subarray(start, end);
    const compressed = snappyCompress(raw);
    if (compressed.length < raw.length) {
      chunks.push({ stored: compressed, compressor: CHUNK_COMPRESSOR_SNAPPY });
    } else {
      chunks.push({ stored: raw, compressor: CHUNK_COMPRESSOR_NONE });
    }
  }
  const compressorTableSize = chunkCount;
  const sizeTableSize = chunkCount * 4;
  const instructionsPayloadSize = sectionHeaderBytes(compressorTableSize) + compressorTableSize + sectionHeaderBytes(sizeTableSize) + sizeTableSize;
  const chunkDataSize = chunks.reduce((sum, chunk) => sum + chunk.stored.length, 0);
  const topPayloadSize = sectionHeaderBytes(instructionsPayloadSize) + instructionsPayloadSize + chunkDataSize;
  const type = HAP_COMPRESSOR_COMPLEX << 4 | formatNibble;
  const out = new Uint8Array(sectionHeaderBytes(topPayloadSize) + topPayloadSize);
  let cursor = writeSectionHeader(out, 0, topPayloadSize, type);
  cursor = writeSectionHeader(out, cursor, instructionsPayloadSize, SECTION_DECODE_INSTRUCTIONS);
  cursor = writeSectionHeader(out, cursor, compressorTableSize, SECTION_CHUNK_COMPRESSORS);
  for (const chunk of chunks) {
    out[cursor++] = chunk.compressor;
  }
  cursor = writeSectionHeader(out, cursor, sizeTableSize, SECTION_CHUNK_SIZES);
  for (const chunk of chunks) {
    out[cursor++] = chunk.stored.length & 255;
    out[cursor++] = chunk.stored.length >>> 8 & 255;
    out[cursor++] = chunk.stored.length >>> 16 & 255;
    out[cursor++] = chunk.stored.length >>> 24 & 255;
  }
  for (const chunk of chunks) {
    out.set(chunk.stored, cursor);
    cursor += chunk.stored.length;
  }
  if (cursor !== out.length) {
    throw new Error(`HAP frame build mismatch: wrote ${cursor}, allocated ${out.length}`);
  }
  return out;
}

// src/services/hap/hapMovMuxer.ts
var MVHD_TIMESCALE = 600;
var AUDIO_CHUNK_SECONDS = 0.5;
var AtomWriter = class {
  buffer;
  view;
  length = 0;
  openAtoms = [];
  constructor(initialCapacity = 4096) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }
  ensure(extra) {
    if (this.length + extra <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }
  u8(value) {
    this.ensure(1);
    this.view.setUint8(this.length, value);
    this.length += 1;
  }
  u16(value) {
    this.ensure(2);
    this.view.setUint16(this.length, value);
    this.length += 2;
  }
  i16(value) {
    this.ensure(2);
    this.view.setInt16(this.length, value);
    this.length += 2;
  }
  u24(value) {
    this.u8(value >>> 16 & 255);
    this.u16(value & 65535);
  }
  u32(value) {
    this.ensure(4);
    this.view.setUint32(this.length, value >>> 0);
    this.length += 4;
  }
  u64(value) {
    this.u32(Math.floor(value / 4294967296));
    this.u32(value >>> 0);
  }
  fourCC(code) {
    this.ensure(4);
    for (let i = 0; i < 4; i++) {
      this.view.setUint8(this.length + i, code.charCodeAt(i) & 255);
    }
    this.length += 4;
  }
  bytes(data) {
    this.ensure(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
  }
  zeros(count) {
    this.ensure(count);
    this.buffer.fill(0, this.length, this.length + count);
    this.length += count;
  }
  /** 32-byte Pascal string used by video sample descriptions. */
  pascalString32(text) {
    const truncated = text.slice(0, 31);
    this.u8(truncated.length);
    for (let i = 0; i < truncated.length; i++) this.u8(truncated.charCodeAt(i) & 255);
    this.zeros(31 - truncated.length);
  }
  beginAtom(type) {
    this.openAtoms.push(this.length);
    this.u32(0);
    this.fourCC(type);
  }
  endAtom() {
    const start = this.openAtoms.pop();
    if (start === void 0) throw new Error("AtomWriter: endAtom without beginAtom");
    this.view.setUint32(start, this.length - start);
  }
  toBytes() {
    if (this.openAtoms.length > 0) throw new Error("AtomWriter: unclosed atom");
    return this.buffer.slice(0, this.length);
  }
};
function identityMatrix(w) {
  w.u32(65536);
  w.u32(0);
  w.u32(0);
  w.u32(0);
  w.u32(65536);
  w.u32(0);
  w.u32(0);
  w.u32(0);
  w.u32(1073741824);
}
function fullAtomHeader(w, version, atomFlags) {
  w.u8(version);
  w.u24(atomFlags);
}
var HapMovWriter = class {
  options;
  sampleBlobs = [];
  sampleSizes = [];
  audio = null;
  constructor(options) {
    if (options.width <= 0 || options.height <= 0) {
      throw new Error("HapMovWriter requires positive dimensions");
    }
    if (!Number.isFinite(options.fps) || options.fps <= 0) {
      throw new Error("HapMovWriter requires a positive fps");
    }
    if (options.videoFourCC.length !== 4) {
      throw new Error(`HapMovWriter FourCC must be 4 characters: ${options.videoFourCC}`);
    }
    this.options = options;
  }
  get sampleCount() {
    return this.sampleSizes.length;
  }
  addVideoSample(sample) {
    this.sampleBlobs.push(new Blob([sample.slice().buffer]));
    this.sampleSizes.push(sample.length);
  }
  setAudio(track) {
    if (track && (track.channelCount <= 0 || track.sampleRate <= 0)) {
      throw new Error("HapMovWriter audio track needs positive rate and channels");
    }
    this.audio = track && track.samples.length > 0 ? track : null;
  }
  finalize() {
    if (this.sampleSizes.length === 0) {
      throw new Error("HapMovWriter has no video samples");
    }
    const ftyp = new AtomWriter(32);
    ftyp.beginAtom("ftyp");
    ftyp.fourCC("qt  ");
    ftyp.u32(537199360);
    ftyp.fourCC("qt  ");
    ftyp.endAtom();
    const ftypBytes = ftyp.toBytes();
    const videoBytes = this.sampleSizes.reduce((sum, size) => sum + size, 0);
    const audioBytes = this.audio ? this.audio.samples.length * 2 : 0;
    const payloadBytes = videoBytes + audioBytes;
    const useLargeMdat = payloadBytes + 8 > 4294967295;
    const mdatHeaderSize = useLargeMdat ? 16 : 8;
    const mdatHeader = new AtomWriter(16);
    if (useLargeMdat) {
      mdatHeader.u32(1);
      mdatHeader.fourCC("mdat");
      mdatHeader.u64(mdatHeaderSize + payloadBytes);
    } else {
      mdatHeader.u32(mdatHeaderSize + payloadBytes);
      mdatHeader.fourCC("mdat");
    }
    const dataStart = ftypBytes.length + mdatHeaderSize;
    const videoOffsets = new Array(this.sampleSizes.length);
    let cursor = dataStart;
    for (let i = 0; i < this.sampleSizes.length; i++) {
      videoOffsets[i] = cursor;
      cursor += this.sampleSizes[i];
    }
    const audio = this.audio;
    let audioChunkOffsets = [];
    let audioFramesPerChunk = 0;
    let audioFrameCount = 0;
    if (audio) {
      const bytesPerFrame = audio.channelCount * 2;
      audioFrameCount = Math.floor(audio.samples.length / audio.channelCount);
      audioFramesPerChunk = Math.max(1, Math.round(audio.sampleRate * AUDIO_CHUNK_SECONDS));
      const chunkCount = Math.ceil(audioFrameCount / audioFramesPerChunk);
      audioChunkOffsets = new Array(chunkCount);
      for (let i = 0; i < chunkCount; i++) {
        audioChunkOffsets[i] = cursor + i * audioFramesPerChunk * bytesPerFrame;
      }
    }
    const moovBytes = this.buildMoov({
      videoOffsets,
      audioChunkOffsets,
      audioFramesPerChunk,
      audioFrameCount
    });
    const parts = [ftypBytes.buffer, mdatHeader.toBytes().buffer, ...this.sampleBlobs];
    if (audio) {
      parts.push(new Uint8Array(
        audio.samples.buffer,
        audio.samples.byteOffset,
        audio.samples.length * 2
      ).slice().buffer);
    }
    parts.push(moovBytes.buffer);
    return new Blob(parts, { type: "video/quicktime" });
  }
  buildMoov(layout) {
    const { fps } = this.options;
    const videoTimescale = Math.max(1, Math.round(fps * 1e3));
    const videoSampleDelta = 1e3;
    const videoDuration = this.sampleSizes.length * videoSampleDelta;
    const videoDurationSeconds = videoDuration / videoTimescale;
    const audio = this.audio;
    const audioDurationSeconds = audio ? layout.audioFrameCount / audio.sampleRate : 0;
    const movieDurationSeconds = Math.max(videoDurationSeconds, audioDurationSeconds);
    const movieDuration = Math.round(movieDurationSeconds * MVHD_TIMESCALE);
    const w = new AtomWriter(64 * 1024);
    w.beginAtom("moov");
    w.beginAtom("mvhd");
    fullAtomHeader(w, 0, 0);
    w.u32(0);
    w.u32(0);
    w.u32(MVHD_TIMESCALE);
    w.u32(movieDuration);
    w.u32(65536);
    w.u16(256);
    w.u16(0);
    w.u32(0);
    w.u32(0);
    identityMatrix(w);
    w.zeros(24);
    w.u32(audio ? 3 : 2);
    w.endAtom();
    this.writeVideoTrak(w, {
      trackId: 1,
      timescale: videoTimescale,
      sampleDelta: videoSampleDelta,
      duration: videoDuration,
      movieDuration,
      offsets: layout.videoOffsets
    });
    if (audio) {
      this.writeAudioTrak(w, {
        trackId: 2,
        movieDuration,
        chunkOffsets: layout.audioChunkOffsets,
        framesPerChunk: layout.audioFramesPerChunk,
        frameCount: layout.audioFrameCount
      });
    }
    w.endAtom();
    return w.toBytes();
  }
  writeVideoTrak(w, params) {
    const { width, height, videoFourCC } = this.options;
    w.beginAtom("trak");
    w.beginAtom("tkhd");
    fullAtomHeader(w, 0, 7);
    w.u32(0);
    w.u32(0);
    w.u32(params.trackId);
    w.u32(0);
    w.u32(params.movieDuration);
    w.u32(0);
    w.u32(0);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    identityMatrix(w);
    w.u32(width << 16);
    w.u32(height << 16);
    w.endAtom();
    w.beginAtom("mdia");
    w.beginAtom("mdhd");
    fullAtomHeader(w, 0, 0);
    w.u32(0);
    w.u32(0);
    w.u32(params.timescale);
    w.u32(params.duration);
    w.u16(21956);
    w.u16(0);
    w.endAtom();
    w.beginAtom("hdlr");
    fullAtomHeader(w, 0, 0);
    w.fourCC("mhlr");
    w.fourCC("vide");
    w.u32(0);
    w.u32(0);
    w.u32(0);
    w.pascalString32("VideoHandler");
    w.endAtom();
    w.beginAtom("minf");
    w.beginAtom("vmhd");
    fullAtomHeader(w, 0, 1);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.endAtom();
    this.writeDinf(w);
    w.beginAtom("stbl");
    w.beginAtom("stsd");
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.beginAtom(videoFourCC);
    w.zeros(6);
    w.u16(1);
    w.u16(0);
    w.u16(0);
    w.u32(0);
    w.u32(0);
    w.u32(0);
    w.u16(width);
    w.u16(height);
    w.u32(4718592);
    w.u32(4718592);
    w.u32(0);
    w.u16(1);
    w.pascalString32("Hap");
    w.u16(this.options.depth ?? 24);
    w.i16(-1);
    w.endAtom();
    w.endAtom();
    w.beginAtom("stts");
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.u32(this.sampleSizes.length);
    w.u32(params.sampleDelta);
    w.endAtom();
    w.beginAtom("stsc");
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.u32(1);
    w.u32(1);
    w.u32(1);
    w.endAtom();
    w.beginAtom("stsz");
    fullAtomHeader(w, 0, 0);
    w.u32(0);
    w.u32(this.sampleSizes.length);
    for (const size of this.sampleSizes) w.u32(size);
    w.endAtom();
    this.writeChunkOffsets(w, params.offsets);
    w.endAtom();
    w.endAtom();
    w.endAtom();
    w.endAtom();
  }
  writeAudioTrak(w, params) {
    const audio = this.audio;
    if (!audio) return;
    w.beginAtom("trak");
    w.beginAtom("tkhd");
    fullAtomHeader(w, 0, 7);
    w.u32(0);
    w.u32(0);
    w.u32(params.trackId);
    w.u32(0);
    w.u32(params.movieDuration);
    w.u32(0);
    w.u32(0);
    w.u16(0);
    w.u16(1);
    w.u16(256);
    w.u16(0);
    identityMatrix(w);
    w.u32(0);
    w.u32(0);
    w.endAtom();
    w.beginAtom("mdia");
    w.beginAtom("mdhd");
    fullAtomHeader(w, 0, 0);
    w.u32(0);
    w.u32(0);
    w.u32(audio.sampleRate);
    w.u32(params.frameCount);
    w.u16(21956);
    w.u16(0);
    w.endAtom();
    w.beginAtom("hdlr");
    fullAtomHeader(w, 0, 0);
    w.fourCC("mhlr");
    w.fourCC("soun");
    w.u32(0);
    w.u32(0);
    w.u32(0);
    w.pascalString32("SoundHandler");
    w.endAtom();
    w.beginAtom("minf");
    w.beginAtom("smhd");
    fullAtomHeader(w, 0, 0);
    w.u16(0);
    w.u16(0);
    w.endAtom();
    this.writeDinf(w);
    w.beginAtom("stbl");
    w.beginAtom("stsd");
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.beginAtom("sowt");
    w.zeros(6);
    w.u16(1);
    w.u16(0);
    w.u16(0);
    w.u32(0);
    w.u16(audio.channelCount);
    w.u16(16);
    w.u16(0);
    w.u16(0);
    w.u32(audio.sampleRate << 16);
    w.endAtom();
    w.endAtom();
    w.beginAtom("stts");
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.u32(params.frameCount);
    w.u32(1);
    w.endAtom();
    const fullChunks = Math.floor(params.frameCount / params.framesPerChunk);
    const remainder = params.frameCount - fullChunks * params.framesPerChunk;
    w.beginAtom("stsc");
    fullAtomHeader(w, 0, 0);
    if (remainder > 0 && fullChunks > 0) {
      w.u32(2);
      w.u32(1);
      w.u32(params.framesPerChunk);
      w.u32(1);
      w.u32(fullChunks + 1);
      w.u32(remainder);
      w.u32(1);
    } else {
      w.u32(1);
      w.u32(1);
      w.u32(remainder > 0 ? remainder : params.framesPerChunk);
      w.u32(1);
    }
    w.endAtom();
    w.beginAtom("stsz");
    fullAtomHeader(w, 0, 0);
    w.u32(audio.channelCount * 2);
    w.u32(params.frameCount);
    w.endAtom();
    this.writeChunkOffsets(w, params.chunkOffsets);
    w.endAtom();
    w.endAtom();
    w.endAtom();
    w.endAtom();
  }
  writeDinf(w) {
    w.beginAtom("dinf");
    w.beginAtom("dref");
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.beginAtom("url ");
    fullAtomHeader(w, 0, 1);
    w.endAtom();
    w.endAtom();
    w.endAtom();
  }
  writeChunkOffsets(w, offsets) {
    const needs64 = offsets.length > 0 && offsets[offsets.length - 1] > 4294967295;
    w.beginAtom(needs64 ? "co64" : "stco");
    fullAtomHeader(w, 0, 0);
    w.u32(offsets.length);
    for (const offset of offsets) {
      if (needs64) w.u64(offset);
      else w.u32(offset);
    }
    w.endAtom();
  }
};

// tools/hap-probe/hapProbe.ts
var TMP = join(process.cwd(), "tools", "hap-probe", ".tmp");
var WIDTH = 192;
var HEIGHT = 108;
var FRAMES = 10;
var FPS = 30;
var failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}
function runTool(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}):
${result.stderr}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function psnr(a, b, stride = 1, offset = 0) {
  let sum = 0;
  let count = 0;
  for (let i = offset; i < Math.min(a.length, b.length); i += stride) {
    const diff = a[i] - b[i];
    sum += diff * diff;
    count++;
  }
  if (count === 0) return 0;
  const mse = sum / count;
  if (mse === 0) return Infinity;
  return 10 * Math.log10(255 * 255 / mse);
}
function psnrRgb(a, b) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = a[i + c] - b[i + c];
      sum += diff * diff;
      count++;
    }
  }
  const mse = sum / count;
  if (mse === 0) return Infinity;
  return 10 * Math.log10(255 * 255 / mse);
}
function synthFrame(frameIndex) {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  const cx = WIDTH * (0.25 + 0.5 * (frameIndex / Math.max(1, FRAMES - 1)));
  const cy = HEIGHT / 2;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const inDisc = dx * dx + dy * dy < 24 * 24;
      rgba[i] = inDisc ? 230 : Math.round(x / WIDTH * 255);
      rgba[i + 1] = inDisc ? 80 : Math.round(y / HEIGHT * 255);
      rgba[i + 2] = inDisc ? 40 : Math.round((x + y) / (WIDTH + HEIGHT) * 255);
      rgba[i + 3] = Math.round(x / WIDTH * 255);
    }
  }
  return rgba;
}
function testSnappy() {
  console.log("A. snappy");
  const cases = [
    new Uint8Array(0),
    new Uint8Array([42]),
    new Uint8Array(1e5).fill(7),
    (() => {
      const buf = new Uint8Array(2e5);
      for (let i = 0; i < buf.length; i++) buf[i] = i * 31 + (i / 100 | 0) & 255;
      return buf;
    })(),
    (() => {
      let seed = 1234567;
      const buf = new Uint8Array(15e4);
      for (let i = 0; i < buf.length; i++) {
        seed = Math.imul(seed, 1103515245) + 12345 >>> 0;
        buf[i] = seed & 255;
      }
      return buf;
    })()
  ];
  for (const [index, source] of cases.entries()) {
    const compressed = snappyCompress(source);
    const restored = snappyUncompress(compressed);
    const equal = restored.length === source.length && restored.every((value, i) => value === source[i]);
    check(
      `round-trip case ${index}`,
      equal,
      `${source.length} -> ${compressed.length} bytes`
    );
  }
}
function testDxtCpu() {
  console.log("B. CPU BC encode/decode");
  const source = synthFrame(3);
  for (const [format, decodeAs, minDb] of [
    ["bc1", "bc1", 30],
    ["bc3", "bc3", 30],
    ["ycocg-bc3", "ycocg-bc3", 30]
  ]) {
    const blocks = encodeTextureCpu(format, source, WIDTH, HEIGHT);
    check(
      `${format} size`,
      blocks.length === compressedTextureByteLength(format, WIDTH, HEIGHT),
      `${blocks.length} bytes`
    );
    const decoded = decodeTextureCpu(decodeAs, blocks, WIDTH, HEIGHT);
    const rgbDb = psnrRgb(source, decoded);
    check(`${format} rgb psnr >= ${minDb}`, rgbDb >= minDb, `${rgbDb.toFixed(1)} dB`);
    if (format === "bc3") {
      const alphaDb = psnr(source, decoded, 4, 3);
      check("bc3 alpha psnr >= 40", alphaDb >= 40, `${alphaDb.toFixed(1)} dB`);
    }
  }
}
function testFrameRoundTrip() {
  console.log("C. HAP frame sections");
  const source = synthFrame(5);
  const blocks = encodeTextureCpu("bc1", source, WIDTH, HEIGHT);
  for (const chunkCount of [1, 4]) {
    const frame = buildHapFrame({
      formatNibble: HAP_FORMAT_RGB_DXT1,
      texture: blocks,
      chunkCount
    });
    const parsed = parseHapFrame(frame);
    const texture = parsed.textures[0];
    const equal = texture.data.length === blocks.length && texture.data.every((value, i) => value === blocks[i]);
    check(
      `chunks=${chunkCount} round-trip`,
      parsed.textures.length === 1 && texture.formatName === "bc1" && equal,
      `${blocks.length} -> ${frame.length} bytes`
    );
  }
}
var ENCODE_FLAVORS = [
  { variant: "hap", fourCC: "Hap1", format: "bc1", nibble: HAP_FORMAT_RGB_DXT1, chunkCount: 1, minSourceDb: 28 },
  { variant: "hap-alpha", fourCC: "Hap5", format: "bc3", nibble: HAP_FORMAT_RGBA_DXT5, chunkCount: 4, minSourceDb: 28 },
  { variant: "hap-q", fourCC: "HapY", format: "ycocg-bc3", nibble: HAP_FORMAT_YCOCG_DXT5, chunkCount: 1, minSourceDb: 28 }
];
async function testEncodeInterop() {
  console.log("D. our encode -> ffmpeg decode");
  const sourceFrames = Array.from({ length: FRAMES }, (_, i) => synthFrame(i));
  let firstMovPath = "";
  for (const flavor of ENCODE_FLAVORS) {
    const writer = new HapMovWriter({
      videoFourCC: flavor.fourCC,
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      depth: flavor.fourCC === "Hap5" ? 32 : 24
    });
    for (const frame of sourceFrames) {
      const blocks = encodeTextureCpu(flavor.format, frame, WIDTH, HEIGHT);
      writer.addVideoSample(buildHapFrame({
        formatNibble: flavor.nibble,
        texture: blocks,
        chunkCount: flavor.chunkCount
      }));
    }
    const audioFrames = Math.round(FRAMES / FPS * 48e3);
    const pcm = new Int16Array(audioFrames * 2);
    for (let i = 0; i < audioFrames; i++) {
      const value = Math.round(Math.sin(i / 48e3 * 2 * Math.PI * 440) * 12e3);
      pcm[i * 2] = value;
      pcm[i * 2 + 1] = value;
    }
    writer.setAudio({ samples: pcm, sampleRate: 48e3, channelCount: 2 });
    const blob = writer.finalize();
    const movPath = join(TMP, `ours-${flavor.variant}.mov`);
    writeFileSync(movPath, new Uint8Array(await blob.arrayBuffer()));
    if (!firstMovPath) firstMovPath = movPath;
    const probe = JSON.parse(runTool("ffprobe", [
      "-v",
      "error",
      "-of",
      "json",
      "-show_streams",
      movPath
    ]).stdout);
    const video = probe.streams.find((s) => s.codec_name === "hap");
    const audio = probe.streams.find((s) => s.codec_name === "pcm_s16le");
    check(
      `${flavor.variant} ffprobe streams`,
      !!video && !!audio && video.codec_tag_string === flavor.fourCC && video.width === WIDTH && video.height === HEIGHT && audio.sample_rate === "48000",
      `tag=${video?.codec_tag_string} frames=${video?.nb_frames}`
    );
    const rawPath = join(TMP, `ours-${flavor.variant}.raw`);
    runTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      movPath,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      rawPath
    ]);
    const decoded = new Uint8Array(readFileSync(rawPath));
    const frameBytes = WIDTH * HEIGHT * 4;
    check(
      `${flavor.variant} ffmpeg frame count`,
      decoded.length === frameBytes * FRAMES,
      `${decoded.length / frameBytes} frames`
    );
    let worstDb = Infinity;
    for (let i = 0; i < FRAMES; i++) {
      const db = psnrRgb(
        sourceFrames[i],
        decoded.subarray(i * frameBytes, (i + 1) * frameBytes)
      );
      if (db < worstDb) worstDb = db;
    }
    check(
      `${flavor.variant} ffmpeg-decode psnr >= ${flavor.minSourceDb}`,
      worstDb >= flavor.minSourceDb,
      `${worstDb.toFixed(1)} dB`
    );
    if (flavor.variant === "hap-alpha") {
      const alphaDb = psnr(sourceFrames[0], decoded.subarray(0, frameBytes), 4, 3);
      check("hap-alpha alpha channel psnr >= 40", alphaDb >= 40, `${alphaDb.toFixed(1)} dB`);
    }
  }
  return firstMovPath;
}
async function testDecodeInterop() {
  console.log("E. ffmpeg encode -> our decode");
  const { Input, BlobSource, EncodedPacketSink, ALL_FORMATS } = await import("mediabunny");
  for (const [ffFormat, fourCC, planeName] of [
    ["hap", "Hap1", "bc1"],
    ["hap_alpha", "Hap5", "bc3"],
    ["hap_q", "HapY", "ycocg-bc3"]
  ]) {
    const refPath = join(TMP, `ref-${ffFormat}.mov`);
    runTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}`,
      "-frames:v",
      String(FRAMES),
      "-c:v",
      "hap",
      "-format",
      ffFormat,
      "-chunks",
      ffFormat === "hap" ? "4" : "1",
      refPath
    ]);
    const refRawPath = join(TMP, `ref-${ffFormat}.raw`);
    runTool("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-i",
      refPath,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      refRawPath
    ]);
    const ffmpegDecoded = new Uint8Array(readFileSync(refRawPath));
    const frameBytes = WIDTH * HEIGHT * 4;
    const movBytes = readFileSync(refPath);
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(new Blob([movBytes]))
    });
    try {
      const track = await input.getPrimaryVideoTrack();
      check(
        `${ffFormat} mediabunny codec id`,
        track?.internalCodecId === fourCC,
        String(track?.internalCodecId)
      );
      if (!track) continue;
      const sink = new EncodedPacketSink(track);
      let packet = await sink.getFirstPacket();
      let frameIndex = 0;
      let worstDb = Infinity;
      while (packet && frameIndex < FRAMES) {
        const parsed = parseHapFrame(packet.data);
        const texture = parsed.textures[0];
        check(
          `${ffFormat} frame ${frameIndex} plane`,
          parsed.textures.length === 1 && texture.formatName === planeName,
          texture.formatName
        );
        const ours = decodeTextureCpu(texture.formatName, texture.data, WIDTH, HEIGHT);
        const reference = ffmpegDecoded.subarray(frameIndex * frameBytes, (frameIndex + 1) * frameBytes);
        const db = psnrRgb(ours, reference);
        if (db < worstDb) worstDb = db;
        packet = await sink.getNextPacket(packet);
        frameIndex++;
      }
      check(`${ffFormat} decoded frame count`, frameIndex === FRAMES, String(frameIndex));
      check(
        `${ffFormat} ours-vs-ffmpeg psnr >= 45`,
        worstDb >= 45,
        `${worstDb.toFixed(1)} dB`
      );
    } finally {
      input.dispose();
    }
  }
}
async function testOwnFileDemux(movPath) {
  console.log("F. mediabunny demux of our own .mov");
  const { Input, BlobSource, EncodedPacketSink, ALL_FORMATS } = await import("mediabunny");
  const movBytes = readFileSync(movPath);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(new Blob([movBytes]))
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    check("video track present", !!track, String(track?.internalCodecId));
    if (!track) return;
    check("codec id Hap1", track.internalCodecId === "Hap1");
    check(
      "dimensions",
      track.displayWidth === WIDTH && track.displayHeight === HEIGHT,
      `${track.displayWidth}x${track.displayHeight}`
    );
    const duration = await input.computeDuration();
    check("duration ~= frames/fps", Math.abs(duration - FRAMES / FPS) < 0.05, `${duration.toFixed(3)}s`);
    const sink = new EncodedPacketSink(track);
    const first = await sink.getFirstPacket();
    check("first packet decodable", !!first && parseHapFrame(first.data).textures[0].formatName === "bc1");
    const stats = await track.computePacketStats(FRAMES);
    check(
      "fps from packets",
      Math.abs(stats.averagePacketRate - FPS) < 0.5,
      stats.averagePacketRate.toFixed(2)
    );
  } finally {
    input.dispose();
  }
}
async function main() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  testSnappy();
  testDxtCpu();
  testFrameRoundTrip();
  const ownMov = await testEncodeInterop();
  await testDecodeInterop();
  await testOwnFileDemux(ownMov);
  if (failures > 0) {
    console.error(`
${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll HAP probe checks passed.");
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
