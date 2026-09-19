// Raw Snappy block-format compression (the second-stage compressor used by
// HAP frames). Implements the standard element stream: little-endian varint
// preamble with the uncompressed length, then literal/copy elements.
// Pure TypeScript, no runtime handles — safe for main thread and workers.

const MAX_HASH_TABLE_BITS = 14;
const HASH_MULTIPLIER = 0x1e35a7bd;
// Reference snappy never emits matches whose 4-byte tail could read past the
// block, so compression works on 64 KiB windows with this input margin.
const INPUT_MARGIN = 15;
const BLOCK_SIZE = 65536;

/** Worst-case compressed size for `sourceLength` input bytes. */
export function snappyMaxCompressedLength(sourceLength: number): number {
  return 32 + sourceLength + Math.floor(sourceLength / 6);
}

function writeVarint(out: Uint8Array, offset: number, value: number): number {
  let v = value >>> 0;
  while (v >= 0x80) {
    out[offset++] = (v & 0x7f) | 0x80;
    v >>>= 7;
  }
  out[offset++] = v;
  return offset;
}

function readVarint(data: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    if (offset >= data.length) throw new Error('Snappy: truncated length varint');
    const byte = data[offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, offset };
    shift += 7;
  }
  throw new Error('Snappy: length varint too long');
}

function load32(data: Uint8Array, offset: number): number {
  return (
    data[offset]
    | (data[offset + 1] << 8)
    | (data[offset + 2] << 16)
    | (data[offset + 3] << 24)
  ) >>> 0;
}

function hash32(value: number, shift: number): number {
  return (Math.imul(value, HASH_MULTIPLIER) >>> shift) >>> 0;
}

function emitLiteral(
  src: Uint8Array,
  start: number,
  length: number,
  out: Uint8Array,
  op: number,
): number {
  const n = length - 1;
  if (n < 60) {
    out[op++] = n << 2;
  } else if (n < 0x100) {
    out[op++] = 60 << 2;
    out[op++] = n;
  } else {
    out[op++] = 61 << 2;
    out[op++] = n & 0xff;
    out[op++] = (n >>> 8) & 0xff;
  }
  out.set(src.subarray(start, start + length), op);
  return op + length;
}

function emitCopyElement(out: Uint8Array, op: number, offset: number, length: number): number {
  if (length <= 11 && offset <= 2047) {
    out[op++] = 1 | ((length - 4) << 2) | ((offset >>> 8) << 5);
    out[op++] = offset & 0xff;
  } else {
    out[op++] = 2 | ((length - 1) << 2);
    out[op++] = offset & 0xff;
    out[op++] = (offset >>> 8) & 0xff;
  }
  return op;
}

function emitCopy(out: Uint8Array, op: number, offset: number, length: number): number {
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

function compressBlock(
  src: Uint8Array,
  blockStart: number,
  blockEnd: number,
  table: Int32Array,
  out: Uint8Array,
  opStart: number,
): number {
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
      // Find a 4-byte match, accelerating through incompressible regions.
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

      // Extend the match as far as the block allows.
      let matched = 4;
      while (ip + matched < blockEnd && src[ip + matched] === src[candidate + matched]) {
        matched++;
      }
      op = emitCopy(out, op, ip - candidate, matched);
      ip += matched;
      nextEmit = ip;
      if (ip > ipLimit) break;
      // Seed the table so the next iteration can match right after the copy.
      table[hash32(load32(src, ip - 1), shift)] = ip - 1 - blockStart;
      ip -= 1;
    }
  }

  if (nextEmit < blockEnd) {
    op = emitLiteral(src, nextEmit, blockEnd - nextEmit, out, op);
  }
  return op;
}

/** Compress `source` into raw Snappy block format. */
export function snappyCompress(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(snappyMaxCompressedLength(source.length));
  let op = writeVarint(out, 0, source.length);
  const table = new Int32Array(1 << MAX_HASH_TABLE_BITS);
  for (let start = 0; start < source.length; start += BLOCK_SIZE) {
    const end = Math.min(start + BLOCK_SIZE, source.length);
    op = compressBlock(source, start, end, table, out, op);
  }
  if (source.length === 0) {
    // op already holds the zero-length varint; nothing else to emit.
  }
  return out.slice(0, op);
}

/** Uncompressed length announced by a raw Snappy block. */
export function snappyUncompressedLength(compressed: Uint8Array): number {
  return readVarint(compressed, 0).value;
}

/**
 * Decompress raw Snappy block data. When `target` is provided it must be
 * exactly the announced uncompressed length.
 */
export function snappyUncompress(compressed: Uint8Array, target?: Uint8Array): Uint8Array {
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
      let length = (tag >>> 2) + 1;
      if (length > 60) {
        const extraBytes = length - 60;
        if (ip + extraBytes > ipEnd) throw new Error('Snappy: truncated literal length');
        length = 0;
        for (let i = 0; i < extraBytes; i++) {
          length |= compressed[ip + i] << (8 * i);
        }
        length = (length >>> 0) + 1;
        ip += extraBytes;
      }
      if (ip + length > ipEnd) throw new Error('Snappy: literal overruns input');
      if (op + length > out.length) throw new Error('Snappy: literal overruns output');
      out.set(compressed.subarray(ip, ip + length), op);
      ip += length;
      op += length;
      continue;
    }

    let length: number;
    let offset: number;
    if (elementType === 1) {
      if (ip >= ipEnd) throw new Error('Snappy: truncated copy element');
      length = 4 + ((tag >>> 2) & 0x7);
      offset = ((tag >>> 5) << 8) | compressed[ip++];
    } else if (elementType === 2) {
      if (ip + 2 > ipEnd) throw new Error('Snappy: truncated copy element');
      length = (tag >>> 2) + 1;
      offset = compressed[ip] | (compressed[ip + 1] << 8);
      ip += 2;
    } else {
      if (ip + 4 > ipEnd) throw new Error('Snappy: truncated copy element');
      length = (tag >>> 2) + 1;
      offset = (
        compressed[ip]
        | (compressed[ip + 1] << 8)
        | (compressed[ip + 2] << 16)
        | (compressed[ip + 3] << 24)
      ) >>> 0;
      ip += 4;
    }

    if (offset === 0 || offset > op) throw new Error('Snappy: copy offset out of range');
    if (op + length > out.length) throw new Error('Snappy: copy overruns output');
    const from = op - offset;
    // Copies may overlap their own output; byte-wise copy preserves semantics.
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
