import { Unzip, UnzipInflate, Zip, ZipPassThrough } from 'fflate';
import { RepositoryError } from '../contracts';
import { safePath, TRANSPORT_LIMITS } from './streamIO';

export interface ArchiveEntry { path: string; chunks: AsyncIterable<Uint8Array>; length?: number; }
const CLASSIC_ZIP_LIMIT = 0xffffffff;
export function assertClassicZipBounds(size: number, offset: number, directoryBytes: number, entries: number): void {
  if (![size, offset, directoryBytes, entries].every(Number.isSafeInteger) || size < 0 || offset < 0 || directoryBytes < 0 || entries < 0 || size >= CLASSIC_ZIP_LIMIT || offset + directoryBytes + 22 >= CLASSIC_ZIP_LIMIT || entries >= 0xffff)
    throw new RepositoryError('budget', 'Archive exceeds classic ZIP limits; ZIP64 is not supported');
}
export type ArchiveSink = (chunk: Uint8Array) => Promise<void>;

/** Serial stored entries avoid worker queues and compression buffer duplication. */
export async function writeZip(entries: AsyncIterable<ArchiveEntry>, sink: ArchiveSink, signal?: AbortSignal): Promise<void> {
  let totalBytes = 0; let directoryBytes = 0;
  let output: Uint8Array[] = []; let outputBytes = 0; let failure: unknown; let finished = false; let count = 0;
  const zip = new Zip((error, data, final) => {
    if (error) { failure = error; return; }
    totalBytes += data.length;
    if (totalBytes >= CLASSIC_ZIP_LIMIT) { failure = new RepositoryError('budget', 'Archive exceeds classic ZIP offset limit'); return; }
    outputBytes += data.length;
    if (outputBytes > TRANSPORT_LIMITS.zipOutputBytes) { failure = new RepositoryError('budget', 'ZIP output slice exceeded transport budget'); return; }
    output.push(data); finished ||= final;
  });
  const drain = async () => {
    if (failure) throw failure;
    for (const chunk of output) await sink(chunk);
    output = []; outputBytes = 0;
  };
  try {
    for await (const entry of entries) {
      if (++count > TRANSPORT_LIMITS.zipEntries) throw new RepositoryError('budget', 'ZIP directory entry budget exceeded');
      const path = safePath(entry.path); const nameBytes = new TextEncoder().encode(path).length;
      if (nameBytes > 0xffff) throw new RepositoryError('budget', 'ZIP filename exceeds classic ZIP limit');
      directoryBytes += 46 + nameBytes;
      assertClassicZipBounds(entry.length ?? 0, totalBytes + 30 + nameBytes + 16 + (entry.length ?? 0), directoryBytes, count);
      let entryBytes = 0;
      const file = new ZipPassThrough(path); zip.add(file); await drain();
      for await (const source of entry.chunks) {
        if (signal?.aborted) throw new RepositoryError('cancelled', 'Archive export cancelled');
        entryBytes += source.length;
        assertClassicZipBounds(entryBytes, totalBytes + source.length + 16, directoryBytes, count);
        for (let offset = 0; offset < source.length; offset += TRANSPORT_LIMITS.chunkBytes) {
          file.push(source.subarray(offset, offset + TRANSPORT_LIMITS.chunkBytes)); await drain();
        }
      }
      file.push(new Uint8Array(), true); await drain();
    }
    zip.end(); await drain();
    if (!finished) throw new RepositoryError('corrupt', 'Archive stream did not finish');
  } finally { zip.terminate(); }
}

class EntryQueue implements AsyncIterable<Uint8Array> {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private ended = false;
  private error: unknown;
  private wake: (() => void) | null = null;
  private drainWake: (() => void) | null = null;
  push(chunk: Uint8Array, final: boolean): void {
    this.bytes += chunk.length;
    if (this.bytes > TRANSPORT_LIMITS.zipOutputBytes) throw new RepositoryError('budget', 'ZIP decompression slice budget exceeded');
    if (chunk.length) this.chunks.push(chunk);
    this.ended ||= final; this.wake?.(); this.wake = null;
  }
  fail(error: unknown): void { this.error = error; this.wake?.(); this.drainWake?.(); }
  async drained(): Promise<void> { if (this.error) throw this.error; if (this.bytes) await new Promise<void>(resolve => { this.drainWake = resolve; }); if (this.error) throw this.error; }
  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      if (this.error) throw this.error;
      const chunk = this.chunks.shift();
      if (chunk) {
        yield chunk;
        this.bytes -= chunk.length;
        if (!this.bytes) { this.drainWake?.(); this.drainWake = null; }
      } else if (this.ended) return;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}

/** Each compressed push is at most 1KiB; consumers drain before the next push. */
export async function extractZip(source: AsyncIterable<Uint8Array>, consume: (entry: ArchiveEntry) => Promise<void>, signal?: AbortSignal): Promise<void> {
  const active = new Set<EntryQueue>(); const jobs = new Set<Promise<void>>(); const names = new Set<string>();
  let failure: unknown; let count = 0;
  const unzip = new Unzip(file => {
    if (file.name.endsWith('/')) return;
    const path = safePath(file.name);
    if (++count > TRANSPORT_LIMITS.zipEntries || names.has(path)) throw new RepositoryError('budget', 'Duplicate or excessive ZIP entries');
    names.add(path);
    if (file.compression !== 0 && file.compression !== 8) throw new RepositoryError('unsupported', 'Unsupported ZIP compression');
    const queue = new EntryQueue(); active.add(queue);
    const job = consume({ path, chunks: queue }).catch(error => { failure = error; queue.fail(error); }).finally(() => { active.delete(queue); jobs.delete(job); });
    jobs.add(job);
    file.ondata = (error, data, final) => {
      if (error) { failure = error; queue.fail(error); return; }
      try { queue.push(data, final); } catch (cause) { failure = cause; queue.fail(cause); file.terminate(); }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for await (const bytes of source) for (let offset = 0; offset < bytes.length; offset += 1024) {
      if (signal?.aborted) throw new RepositoryError('cancelled', 'Archive import cancelled');
      unzip.push(bytes.subarray(offset, offset + 1024));
      await Promise.all([...active].map(queue => queue.drained()));
      if (failure) throw failure;
    }
    unzip.push(new Uint8Array(), true);
    await Promise.all([...jobs]);
    if (failure) throw failure;
  } catch (error) { for (const queue of active) queue.fail(error); await Promise.all([...jobs]); throw error; }
}
