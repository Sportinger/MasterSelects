// tools/hap-probe/generateHapSample.ts
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// src/services/hap/dxtEncodeCpu.ts
function blockDimensions(width, height) {
  return {
    blocksX: Math.max(1, Math.ceil(width / 4)),
    blocksY: Math.max(1, Math.ceil(height / 4))
  };
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

// src/services/hap/hapFrame.ts
var HAP_FORMAT_RGBA_DXT5 = 14;
var HAP_COMPRESSOR_NONE = 10;
var HAP_COMPRESSOR_SNAPPY = 11;
var HAP_COMPRESSOR_COMPLEX = 12;
var SECTION_DECODE_INSTRUCTIONS = 1;
var SECTION_CHUNK_COMPRESSORS = 2;
var SECTION_CHUNK_SIZES = 3;
var CHUNK_COMPRESSOR_NONE = 10;
var CHUNK_COMPRESSOR_SNAPPY = 11;
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
    this.buffer = new Uint8Array(new ArrayBuffer(initialCapacity));
    this.view = new DataView(this.buffer.buffer);
  }
  ensure(extra) {
    if (this.length + extra <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const next = new Uint8Array(new ArrayBuffer(capacity));
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
    const parts = [ftypBytes, mdatHeader.toBytes(), ...this.sampleBlobs];
    if (audio) {
      const pcmBytes = new Uint8Array(new ArrayBuffer(audio.samples.length * 2));
      pcmBytes.set(new Uint8Array(
        audio.samples.buffer,
        audio.samples.byteOffset,
        audio.samples.length * 2
      ));
      parts.push(pcmBytes);
    }
    parts.push(moovBytes);
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

// tools/hap-probe/generateHapSample.ts
var WIDTH = 1920;
var HEIGHT = 1080;
var FPS = 30;
var DURATION_SECONDS = 10;
var ROTATIONS = 4;
var BAR_COLOR = { r: 255, g: 140, b: 0 };
var BAR_HALF_LENGTH = Math.min(WIDTH, HEIGHT) * 0.42;
var BAR_HALF_WIDTH = 56;
var EDGE_AA = 2;
function renderFrame(rgba, timeSeconds) {
  const angle = 2 * Math.PI * ROTATIONS * (timeSeconds / DURATION_SECONDS);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const reach = BAR_HALF_LENGTH + BAR_HALF_WIDTH + EDGE_AA + 1;
  const reachSq = reach * reach;
  const outer = BAR_HALF_WIDTH + EDGE_AA;
  for (let y = 0; y < HEIGHT; y++) {
    const py = y - cy;
    for (let x = 0; x < WIDTH; x++) {
      const px = x - cx;
      const i = (y * WIDTH + x) * 4;
      rgba[i] = BAR_COLOR.r;
      rgba[i + 1] = BAR_COLOR.g;
      rgba[i + 2] = BAR_COLOR.b;
      if (px * px + py * py > reachSq) {
        rgba[i + 3] = 0;
        continue;
      }
      const u = px * dirX + py * dirY;
      const v = -px * dirY + py * dirX;
      const du = Math.max(0, Math.abs(u) - BAR_HALF_LENGTH);
      const distance = Math.sqrt(du * du + v * v);
      if (distance >= outer) {
        rgba[i + 3] = 0;
      } else if (distance <= BAR_HALF_WIDTH) {
        rgba[i + 3] = 255;
      } else {
        rgba[i + 3] = Math.round(255 * (1 - (distance - BAR_HALF_WIDTH) / EDGE_AA));
      }
    }
  }
}
async function main() {
  const totalFrames = DURATION_SECONDS * FPS;
  const writer = new HapMovWriter({
    videoFourCC: "Hap5",
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    depth: 32
  });
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  const startedAt = Date.now();
  for (let frame = 0; frame < totalFrames; frame++) {
    renderFrame(rgba, frame / FPS);
    const blocks = encodeTextureCpu("bc3", rgba, WIDTH, HEIGHT);
    writer.addVideoSample(buildHapFrame({
      formatNibble: HAP_FORMAT_RGBA_DXT5,
      texture: blocks,
      chunkCount: 4
    }));
    if ((frame + 1) % 30 === 0) {
      console.log(`${frame + 1}/${totalFrames} frames (${((Date.now() - startedAt) / 1e3).toFixed(1)}s)`);
    }
  }
  const blob = writer.finalize();
  const outPath = join(homedir(), "Desktop", "hap-alpha-rotating-bar.mov");
  writeFileSync(outPath, new Uint8Array(await blob.arrayBuffer()));
  console.log(`Wrote ${outPath} (${(blob.size / 1e6).toFixed(1)} MB, ${totalFrames} frames)`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
