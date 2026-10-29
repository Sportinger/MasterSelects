// Reading a Blob/File that is copied into project storage: one bounded read loop with large slices and one
// content hash. Used by the project storage worker, which receives the picked File itself (a File is
// structured-cloned as a reference to the same bytes, not copied), so a media copy never moves its bytes
// through the main thread in small acknowledged messages.
import { RepositoryError } from '../contracts';
import { StreamHash } from '../segments/streamHash';

/** Slice size for file copies: few storage calls per file, bounded memory for multi-GB originals. */
export const BLOB_FILE_CHUNK_BYTES = 4 * 1024 * 1024;
/**
 * Up to this size the whole file is hashed with native SHA-256 in one call (one temporary buffer of the
 * file's size, inside the storage worker). Larger files keep the streaming hash, which never holds more
 * than one slice: a multi-GB phone recording must not need a multi-GB ArrayBuffer.
 */
export const NATIVE_FILE_HASH_BYTES = 128 * 1024 * 1024;

function hex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RepositoryError('cancelled', 'Blob read cancelled');
}

/** Told the total bytes read so far after each slice (progress of a long copy; see the storage worker). */
export type BlobReadProgress = (bytesRead: number) => void;

/** Reads `blob` front to back in `chunkBytes` slices; never materializes the whole file. */
export async function* readBlobChunks(blob: Blob, signal?: AbortSignal, chunkBytes = BLOB_FILE_CHUNK_BYTES, onRead?: BlobReadProgress): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    checkAbort(signal);
    const bytes = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + chunkBytes)).arrayBuffer());
    if (bytes.byteLength !== Math.min(chunkBytes, blob.size - offset)) throw new RepositoryError('io', 'The file changed or became unreadable while it was copied');
    onRead?.(offset + bytes.byteLength);
    yield bytes;
  }
}

/** Full SHA-256 of a Blob as 'sha256:<hex>': native for files up to `nativeLimit`, streamed above. */
export async function hashBlobContent(blob: Blob, signal?: AbortSignal, nativeLimit = NATIVE_FILE_HASH_BYTES, onRead?: BlobReadProgress): Promise<string> {
  if (blob.size <= nativeLimit && globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    checkAbort(signal);
    onRead?.(blob.size);
    return `sha256:${hex(digest)}`;
  }
  const hash = new StreamHash();
  for await (const chunk of readBlobChunks(blob, signal, BLOB_FILE_CHUNK_BYTES, onRead)) hash.update(chunk);
  checkAbort(signal);
  return hash.digest();
}

/**
 * Wraps `report` so it runs at most once per `intervalMs` (the first call always runs). A multi-GB copy
 * reads hundreds of slices; the tab only needs a few progress messages per second.
 */
export function throttleBlobReadProgress(report: BlobReadProgress, intervalMs = 250, now: () => number = Date.now): BlobReadProgress {
  let last = -Infinity;
  return (bytesRead) => {
    const time = now();
    if (time - last < intervalMs) return;
    last = time;
    report(bytesRead);
  };
}

/**
 * Whole-file jobs of the storage worker (blob-hash, blob-store-file) that may run at once: the same budget
 * as source hashing. Each job can hold one buffer of up to NATIVE_FILE_HASH_BYTES (hash) or 64 MB (store),
 * and phone imports start one background copy per file while the next file imports.
 */
export const MAX_CONCURRENT_FILE_JOBS = 2;

export interface FileJobLimiter {
  run<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** Jobs running and waiting (tests and diagnostics). */
  readonly load: { active: number; waiting: number };
}

/** A FIFO slot queue: a job beyond the limit waits for a free slot (it is not rejected); an aborted waiter leaves the queue. */
export function createFileJobLimiter(limit = MAX_CONCURRENT_FILE_JOBS): FileJobLimiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const index = waiting.indexOf(take);
      if (index >= 0) waiting.splice(index, 1);
      reject(new RepositoryError('cancelled', 'Blob job cancelled while waiting for a slot'));
    };
    // The releasing job hands its slot over: `active` stays the same.
    const take = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
    waiting.push(take);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  return {
    async run(job, signal) {
      checkAbort(signal);
      if (active < limit) active++; else await acquire(signal);
      try {
        checkAbort(signal);
        return await job();
      } finally {
        const next = waiting.shift();
        if (next) next(); else active--;
      }
    },
    get load() { return { active, waiting: waiting.length }; },
  };
}
