// Range-read abstraction so the MXF parser runs on File (browser) and on
// in-memory bytes (tests) with identical code paths.

import { readBlobAsArrayBuffer } from '../../../importers/fileIdentity';

export interface MxfByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function createFileByteSource(file: Blob): MxfByteSource {
  return {
    size: file.size,
    async read(offset, length) {
      const start = Math.max(0, offset);
      const end = Math.min(file.size, start + Math.max(0, length));
      if (end <= start) return new Uint8Array(0);
      return new Uint8Array(await readBlobAsArrayBuffer(file.slice(start, end)));
    },
  };
}

export function createMemoryByteSource(bytes: Uint8Array): MxfByteSource {
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      const start = Math.max(0, offset);
      return bytes.subarray(start, Math.min(bytes.byteLength, start + Math.max(0, length)));
    },
  };
}

/**
 * Wraps a source with a sliding read window so the many small sequential KLV
 * header reads become few range requests.
 */
export function createCachedByteSource(inner: MxfByteSource, windowSize = 256 * 1024): MxfByteSource {
  let windowStart = 0;
  let windowBytes: Uint8Array = new Uint8Array(0);
  return {
    size: inner.size,
    async read(offset, length) {
      const start = Math.max(0, offset);
      const end = Math.min(inner.size, start + Math.max(0, length));
      if (end <= start) return new Uint8Array(0);
      if (start >= windowStart && end <= windowStart + windowBytes.length) {
        return windowBytes.subarray(start - windowStart, end - windowStart);
      }
      if (end - start >= windowSize) return inner.read(start, end - start);
      const readEnd = Math.min(inner.size, start + windowSize);
      windowBytes = await inner.read(start, readEnd - start);
      windowStart = start;
      return windowBytes.subarray(0, Math.min(end - start, windowBytes.length));
    },
  };
}
