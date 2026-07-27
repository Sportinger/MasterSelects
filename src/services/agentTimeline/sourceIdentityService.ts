import {
  SOURCE_IDENTITY_SCHEMA_VERSION,
  type SourceIdentity,
  type SourceIdentityMetadata,
  type SourceIdentityStrategy,
} from '../../types/agentTimeline/sourceIdentity';

export interface SourceIdentityProgress {
  strategy: SourceIdentityStrategy;
  bytesRead: number;
  totalBytes: number;
  fraction: number;
}

export interface SourceIdentityOptions {
  /** Defaults to a cheap deterministic fingerprint over five 256 KiB samples. */
  strategy?: SourceIdentityStrategy;
  /** Full-stream read size; defaults to 1 MiB. Sampled v1 chunks are fixed at 256 KiB. */
  chunkSizeBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SourceIdentityProgress) => void;
}

const DEFAULT_CHUNK_SIZE_BYTES = 1024 * 1024;
const SAMPLED_CHUNK_SIZE_BYTES = 256 * 1024;
const SAMPLED_CHUNK_COUNT = 5;
const encoder = new TextEncoder();

/** An AbortError that is available in both browsers and non-DOM test runners. */
function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('Source identity creation was aborted.', 'AbortError');
  const error = new Error('Source identity creation was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function validateChunkSize(chunkSizeBytes: number | undefined): number {
  const value = chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('chunkSizeBytes must be a positive safe integer.');
  }
  return value;
}

function writeUint64(hasher: Sha256, value: number): void {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(value), false);
  hasher.update(bytes);
}

function writeText(hasher: Sha256, value: string): void {
  const bytes = encoder.encode(value);
  writeUint64(hasher, bytes.byteLength);
  hasher.update(bytes);
}

function writeHeader(hasher: Sha256, metadata: SourceIdentityMetadata, strategy: SourceIdentityStrategy): void {
  writeText(hasher, SOURCE_IDENTITY_SCHEMA_VERSION);
  writeText(hasher, 'source-identity');
  writeText(hasher, strategy);
  writeUint64(hasher, metadata.size);
  writeText(hasher, metadata.mediaType);
}

function sampleOffsets(size: number, chunkSize: number): number[] {
  if (size === 0) return [];
  const readableSize = Math.min(size, chunkSize);
  const lastOffset = size - readableSize;
  const offsets = new Set<number>();
  for (let index = 0; index < SAMPLED_CHUNK_COUNT; index += 1) {
    offsets.add(Math.floor((lastOffset * index) / (SAMPLED_CHUNK_COUNT - 1)));
  }
  return [...offsets].toSorted((left, right) => left - right);
}

function reportProgress(
  callback: SourceIdentityOptions['onProgress'],
  strategy: SourceIdentityStrategy,
  bytesRead: number,
  totalBytes: number,
): void {
  callback?.({
    strategy,
    bytesRead,
    totalBytes,
    fraction: totalBytes === 0 ? 1 : Math.min(1, bytesRead / totalBytes),
  } satisfies SourceIdentityProgress);
}

async function readAndHash(
  source: Blob,
  start: number,
  end: number,
  hasher: Sha256,
  signal: AbortSignal | undefined,
): Promise<number> {
  throwIfAborted(signal);
  const buffer = await readBlobRange(source.slice(start, end));
  throwIfAborted(signal);
  const bytes = new Uint8Array(buffer);
  hasher.update(bytes);
  return bytes.byteLength;
}

/** Reads only an already-bounded Blob slice, including older test/web views. */
async function readBlobRange(blob: Blob): Promise<ArrayBuffer> {
  const withArrayBuffer = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof withArrayBuffer.arrayBuffer === 'function') return withArrayBuffer.arrayBuffer();
  if (typeof FileReader !== 'undefined') {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read source identity chunk.'));
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error('Source identity chunk did not contain binary data.'));
      };
      reader.readAsArrayBuffer(blob);
    });
  }
  return new Response(blob).arrayBuffer();
}

async function hashSampledChunks(
  source: Blob,
  hasher: Sha256,
  signal: AbortSignal | undefined,
  progress: SourceIdentityOptions['onProgress'],
): Promise<void> {
  // Sampling layout is part of the v1 strategy, not a caller preference. A
  // different operational read size must never produce a different identity.
  const offsets = sampleOffsets(source.size, SAMPLED_CHUNK_SIZE_BYTES);
  const sampledChunkSize = SAMPLED_CHUNK_SIZE_BYTES;
  const totalBytes = offsets.reduce((sum, offset) => sum + Math.min(sampledChunkSize, source.size - offset), 0);
  let bytesRead = 0;
  reportProgress(progress, 'sampled-chunks', bytesRead, totalBytes);

  for (const offset of offsets) {
    const end = Math.min(source.size, offset + sampledChunkSize);
    // The location and length are hashed so identical chunks at different
    // positions cannot be mistaken for the same sample sequence.
    writeUint64(hasher, offset);
    writeUint64(hasher, end - offset);
    bytesRead += await readAndHash(source, offset, end, hasher, signal);
    reportProgress(progress, 'sampled-chunks', bytesRead, totalBytes);
  }
}

async function hashFullStream(
  source: Blob,
  hasher: Sha256,
  chunkSize: number,
  signal: AbortSignal | undefined,
  progress: SourceIdentityOptions['onProgress'],
): Promise<void> {
  let bytesRead = 0;
  reportProgress(progress, 'full-stream', bytesRead, source.size);
  for (let offset = 0; offset < source.size; offset += chunkSize) {
    const end = Math.min(source.size, offset + chunkSize);
    bytesRead += await readAndHash(source, offset, end, hasher, signal);
    reportProgress(progress, 'full-stream', bytesRead, source.size);
  }
}

/**
 * Creates a versioned source key with bounded memory. Full hashes are fed to
 * SHA-256 incrementally; this deliberately never calls `source.arrayBuffer()`.
 */
export async function createSourceIdentity(source: Blob, options: SourceIdentityOptions = {}): Promise<SourceIdentity> {
  const strategy = options.strategy ?? 'sampled-chunks';
  const chunkSize = validateChunkSize(options.chunkSizeBytes);
  const metadata: SourceIdentityMetadata = { size: source.size, mediaType: source.type };
  const hasher = new Sha256();
  throwIfAborted(options.signal);
  writeHeader(hasher, metadata, strategy);

  if (strategy === 'full-stream') {
    await hashFullStream(source, hasher, chunkSize, options.signal, options.onProgress);
  } else {
    await hashSampledChunks(source, hasher, options.signal, options.onProgress);
  }
  throwIfAborted(options.signal);

  return {
    type: 'source-identity',
    version: SOURCE_IDENTITY_SCHEMA_VERSION,
    strategy,
    hashAlgorithm: 'sha-256',
    hash: hasher.digestHex(),
    metadata,
  };
}

/**
 * Small incremental SHA-256 implementation. WebCrypto has no incremental
 * digest API, so using it would require retaining every full-file chunk.
 */
class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private blockLength = 0;
  private byteLength = 0;
  private finished = false;

  update(input: Uint8Array): void {
    if (this.finished) throw new Error('Cannot update a finalized SHA-256 digest.');
    this.byteLength += input.byteLength;
    let offset = 0;
    if (this.blockLength > 0) {
      const count = Math.min(64 - this.blockLength, input.byteLength);
      this.block.set(input.subarray(0, count), this.blockLength);
      this.blockLength += count;
      offset += count;
      if (this.blockLength === 64) {
        this.compress(this.block);
        this.blockLength = 0;
      }
    }
    while (offset + 64 <= input.byteLength) {
      this.compress(input.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < input.byteLength) {
      this.block.set(input.subarray(offset), 0);
      this.blockLength = input.byteLength - offset;
    }
  }

  digestHex(): string {
    if (!this.finished) this.finish();
    return Array.from(this.state, word => word.toString(16).padStart(8, '0')).join('');
  }

  private finish(): void {
    const bitLength = BigInt(this.byteLength) * 8n;
    this.block[this.blockLength] = 0x80;
    this.blockLength += 1;
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength);
      this.compress(this.block);
      this.blockLength = 0;
    }
    this.block.fill(0, this.blockLength, 56);
    const view = new DataView(this.block.buffer);
    view.setBigUint64(56, bitLength, false);
    this.compress(this.block);
    this.finished = true;
  }

  private compress(block: Uint8Array): void {
    const words = this.words;
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      words[index] = ((block[offset] << 24) | (block[offset + 1] << 16) | (block[offset + 2] << 8) | block[offset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const s0 = ((left >>> 7) | (left << 25)) ^ ((left >>> 18) | (left << 14)) ^ (left >>> 3);
      const s1 = ((right >>> 17) | (right << 15)) ^ ((right >>> 19) | (right << 13)) ^ (right >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < 64; index += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
