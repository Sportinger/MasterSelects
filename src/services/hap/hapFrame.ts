// HAP frame bitstream: section parsing and construction.
// A frame is one top-level section — either a texture section or a
// multiple-images container (HAP Q Alpha) holding one texture section per
// plane. Texture payloads are raw BC blocks, optionally Snappy-compressed,
// optionally chunked ("complex") for multithreaded decoders.
// Reference: Vidvox HAP specification (HapVideoDRAFT.md).

import {
  snappyCompress,
  snappyUncompress,
  snappyUncompressedLength,
} from './snappy';

// Low nibble of the section type byte: texture format.
export const HAP_FORMAT_RGB_DXT1 = 0xb;
export const HAP_FORMAT_RGBA_DXT5 = 0xe;
export const HAP_FORMAT_YCOCG_DXT5 = 0xf;
export const HAP_FORMAT_A_RGTC1 = 0x1;

// High nibble of the section type byte: second-stage compressor.
export const HAP_COMPRESSOR_NONE = 0xa;
export const HAP_COMPRESSOR_SNAPPY = 0xb;
export const HAP_COMPRESSOR_COMPLEX = 0xc;

// Whole-byte section types.
const SECTION_DECODE_INSTRUCTIONS = 0x01;
const SECTION_CHUNK_COMPRESSORS = 0x02;
const SECTION_CHUNK_SIZES = 0x03;
const SECTION_CHUNK_OFFSETS = 0x04;
const SECTION_MULTIPLE_IMAGES = 0x0d;

// Chunk compressor table values.
const CHUNK_COMPRESSOR_NONE = 0x0a;
const CHUNK_COMPRESSOR_SNAPPY = 0x0b;

export type HapTextureFormatNibble =
  | typeof HAP_FORMAT_RGB_DXT1
  | typeof HAP_FORMAT_RGBA_DXT5
  | typeof HAP_FORMAT_YCOCG_DXT5
  | typeof HAP_FORMAT_A_RGTC1;

export type HapTextureName = 'bc1' | 'bc3' | 'ycocg-bc3' | 'bc4-alpha';

export function hapTextureFormatName(nibble: number): HapTextureName | undefined {
  switch (nibble) {
    case HAP_FORMAT_RGB_DXT1: return 'bc1';
    case HAP_FORMAT_RGBA_DXT5: return 'bc3';
    case HAP_FORMAT_YCOCG_DXT5: return 'ycocg-bc3';
    case HAP_FORMAT_A_RGTC1: return 'bc4-alpha';
    default: return undefined;
  }
}

export interface HapFrameTexture {
  formatNibble: HapTextureFormatNibble;
  formatName: HapTextureName;
  /** Raw BC block data after second-stage decompression. */
  data: Uint8Array;
}

export interface HapParsedFrame {
  textures: HapFrameTexture[];
}

interface Section {
  type: number;
  /** Payload bounds within the frame buffer. */
  start: number;
  end: number;
}

function readSection(frame: Uint8Array, offset: number, limit: number): Section {
  if (offset + 4 > limit) throw new Error('HAP frame: truncated section header');
  let size = frame[offset] | (frame[offset + 1] << 8) | (frame[offset + 2] << 16);
  const type = frame[offset + 3];
  let headerSize = 4;
  if (size === 0) {
    if (offset + 8 > limit) throw new Error('HAP frame: truncated extended section header');
    size = (
      frame[offset + 4]
      | (frame[offset + 5] << 8)
      | (frame[offset + 6] << 16)
      | (frame[offset + 7] << 24)
    ) >>> 0;
    headerSize = 8;
  }
  const start = offset + headerSize;
  const end = start + size;
  if (end > limit) throw new Error(`HAP frame: section overruns data (${end} > ${limit})`);
  return { type, start, end };
}

function decodeChunkedPayload(frame: Uint8Array, section: Section): Uint8Array {
  const instructions = readSection(frame, section.start, section.end);
  if (instructions.type !== SECTION_DECODE_INSTRUCTIONS) {
    throw new Error(`HAP frame: expected decode instructions, got 0x${instructions.type.toString(16)}`);
  }

  let compressors: Uint8Array | null = null;
  let sizes: Uint8Array | null = null;
  let offsets: Uint8Array | null = null;
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
    throw new Error('HAP frame: chunked payload lacks compressor or size table');
  }
  const chunkCount = compressors.length;
  if (sizes.length !== chunkCount * 4) {
    throw new Error('HAP frame: chunk size table length mismatch');
  }
  if (offsets && offsets.length !== chunkCount * 4) {
    throw new Error('HAP frame: chunk offset table length mismatch');
  }

  const dataStart = instructions.end;
  const parts: Uint8Array[] = [];
  let totalLength = 0;
  let runningOffset = 0;
  for (let i = 0; i < chunkCount; i++) {
    const storedSize = (
      sizes[i * 4]
      | (sizes[i * 4 + 1] << 8)
      | (sizes[i * 4 + 2] << 16)
      | (sizes[i * 4 + 3] << 24)
    ) >>> 0;
    const chunkOffset = offsets
      ? ((
        offsets[i * 4]
        | (offsets[i * 4 + 1] << 8)
        | (offsets[i * 4 + 2] << 16)
        | (offsets[i * 4 + 3] << 24)
      ) >>> 0)
      : runningOffset;
    const chunkStart = dataStart + chunkOffset;
    const chunkEnd = chunkStart + storedSize;
    if (chunkEnd > section.end) throw new Error('HAP frame: chunk overruns section');
    const stored = frame.subarray(chunkStart, chunkEnd);

    const compressor = compressors[i];
    let chunk: Uint8Array;
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

function decodeTextureSection(frame: Uint8Array, section: Section): HapFrameTexture {
  const compressor = (section.type >>> 4) & 0xf;
  const formatNibble = section.type & 0xf;
  const formatName = hapTextureFormatName(formatNibble);
  if (!formatName) {
    throw new Error(`HAP frame: unsupported texture format 0x${formatNibble.toString(16)}`);
  }

  let data: Uint8Array;
  if (compressor === HAP_COMPRESSOR_NONE) {
    data = frame.subarray(section.start, section.end);
  } else if (compressor === HAP_COMPRESSOR_SNAPPY) {
    data = snappyUncompress(frame.subarray(section.start, section.end));
  } else if (compressor === HAP_COMPRESSOR_COMPLEX) {
    data = decodeChunkedPayload(frame, section);
  } else {
    throw new Error(`HAP frame: unsupported compressor 0x${compressor.toString(16)}`);
  }
  return { formatNibble: formatNibble as HapTextureFormatNibble, formatName, data };
}

/** Parse one HAP video sample into its texture planes. */
export function parseHapFrame(frame: Uint8Array): HapParsedFrame {
  const top = readSection(frame, 0, frame.length);
  if (top.type === SECTION_MULTIPLE_IMAGES) {
    const textures: HapFrameTexture[] = [];
    let cursor = top.start;
    while (cursor < top.end) {
      const inner = readSection(frame, cursor, top.end);
      textures.push(decodeTextureSection(frame, inner));
      cursor = inner.end;
    }
    if (textures.length === 0) throw new Error('HAP frame: empty multiple-images section');
    return { textures };
  }
  return { textures: [decodeTextureSection(frame, top)] };
}

function sectionHeaderBytes(size: number): number {
  return size < 0xffffff ? 4 : 8;
}

function writeSectionHeader(out: Uint8Array, offset: number, size: number, type: number): number {
  if (size < 0xffffff) {
    out[offset] = size & 0xff;
    out[offset + 1] = (size >>> 8) & 0xff;
    out[offset + 2] = (size >>> 16) & 0xff;
    out[offset + 3] = type;
    return offset + 4;
  }
  out[offset] = 0;
  out[offset + 1] = 0;
  out[offset + 2] = 0;
  out[offset + 3] = type;
  out[offset + 4] = size & 0xff;
  out[offset + 5] = (size >>> 8) & 0xff;
  out[offset + 6] = (size >>> 16) & 0xff;
  out[offset + 7] = (size >>> 24) & 0xff;
  return offset + 8;
}

export interface BuildHapFrameOptions {
  formatNibble: HapTextureFormatNibble;
  /** Raw BC block data. */
  texture: Uint8Array;
  /**
   * Number of independently decompressable chunks. Values above 1 emit the
   * chunked "complex" layout so players can decode one frame on several
   * threads. Clamped to the texture size.
   */
  chunkCount?: number;
}

/** Serialize raw BC texture data into one HAP video sample. */
export function buildHapFrame(options: BuildHapFrameOptions): Uint8Array {
  const { formatNibble, texture } = options;
  const requestedChunks = Math.max(1, Math.floor(options.chunkCount ?? 1));
  // A chunk below 64 KiB gains nothing; never emit more chunks than data.
  const maxUseful = Math.max(1, Math.floor(texture.length / 65536));
  const chunkCount = Math.min(64, requestedChunks, maxUseful);

  if (chunkCount <= 1) {
    const compressed = snappyCompress(texture);
    const useSnappy = compressed.length < texture.length;
    const payload = useSnappy ? compressed : texture;
    const type = ((useSnappy ? HAP_COMPRESSOR_SNAPPY : HAP_COMPRESSOR_NONE) << 4) | formatNibble;
    const headerBytes = sectionHeaderBytes(payload.length);
    const out = new Uint8Array(headerBytes + payload.length);
    const dataOffset = writeSectionHeader(out, 0, payload.length, type);
    out.set(payload, dataOffset);
    return out;
  }

  const baseSize = Math.ceil(texture.length / chunkCount);
  const chunks: { stored: Uint8Array; compressor: number }[] = [];
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
  const instructionsPayloadSize =
    sectionHeaderBytes(compressorTableSize) + compressorTableSize
    + sectionHeaderBytes(sizeTableSize) + sizeTableSize;
  const chunkDataSize = chunks.reduce((sum, chunk) => sum + chunk.stored.length, 0);
  const topPayloadSize =
    sectionHeaderBytes(instructionsPayloadSize) + instructionsPayloadSize + chunkDataSize;
  const type = (HAP_COMPRESSOR_COMPLEX << 4) | formatNibble;

  const out = new Uint8Array(sectionHeaderBytes(topPayloadSize) + topPayloadSize);
  let cursor = writeSectionHeader(out, 0, topPayloadSize, type);
  cursor = writeSectionHeader(out, cursor, instructionsPayloadSize, SECTION_DECODE_INSTRUCTIONS);
  cursor = writeSectionHeader(out, cursor, compressorTableSize, SECTION_CHUNK_COMPRESSORS);
  for (const chunk of chunks) {
    out[cursor++] = chunk.compressor;
  }
  cursor = writeSectionHeader(out, cursor, sizeTableSize, SECTION_CHUNK_SIZES);
  for (const chunk of chunks) {
    out[cursor++] = chunk.stored.length & 0xff;
    out[cursor++] = (chunk.stored.length >>> 8) & 0xff;
    out[cursor++] = (chunk.stored.length >>> 16) & 0xff;
    out[cursor++] = (chunk.stored.length >>> 24) & 0xff;
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

/** Total decompressed texture byte length announced by a frame without decoding chunk data. */
export function peekHapFrameTextureBytes(frame: Uint8Array): number {
  const top = readSection(frame, 0, frame.length);
  if (top.type === SECTION_MULTIPLE_IMAGES) {
    let total = 0;
    let cursor = top.start;
    while (cursor < top.end) {
      const inner = readSection(frame, cursor, top.end);
      total += peekTextureSectionBytes(frame, inner);
      cursor = inner.end;
    }
    return total;
  }
  return peekTextureSectionBytes(frame, top);
}

function peekTextureSectionBytes(frame: Uint8Array, section: Section): number {
  const compressor = (section.type >>> 4) & 0xf;
  if (compressor === HAP_COMPRESSOR_NONE) return section.end - section.start;
  if (compressor === HAP_COMPRESSOR_SNAPPY) {
    return snappyUncompressedLength(frame.subarray(section.start, section.end));
  }
  // Chunked payloads would need the tables; a full parse stays cheap enough.
  return decodeChunkedPayload(frame, section).length;
}
