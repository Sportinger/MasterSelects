import { Unzip, UnzipInflate, Zip, ZipPassThrough } from 'fflate';
import { RepositoryError } from '../contracts';
import { safePath, TRANSPORT_LIMITS } from './streamIO';
import { Logger } from '../../../logger';

const log = Logger.create('ProjectArchiveZip');

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

function concat(parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  return joined;
}

class EntryQueue implements AsyncIterable<Uint8Array> {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private ended = false;
  private released = false;
  private error: unknown;
  private wake: (() => void) | null = null;
  private drainWake: (() => void) | null = null;
  private readonly onProgress: () => void;
  constructor(onProgress: () => void) { this.onProgress = onProgress; }
  get buffered(): number { return this.bytes; }
  push(chunk: Uint8Array, final: boolean): void {
    // A consumer that returned early does not hold the archive stream back.
    if (this.released) return;
    this.bytes += chunk.length;
    if (this.bytes > TRANSPORT_LIMITS.zipOutputBytes) throw new RepositoryError('budget', 'ZIP decompression slice budget exceeded');
    if (chunk.length) this.chunks.push(chunk);
    this.ended ||= final; this.wake?.(); this.wake = null;
  }
  fail(error: unknown): void { this.error ??= error; this.wake?.(); this.wake = null; this.drainWake?.(); this.drainWake = null; }
  /** The consumer finished: drop unread bytes and release a waiting producer. */
  release(): void { this.released = true; this.chunks = []; this.bytes = 0; this.drainWake?.(); this.drainWake = null; }
  async drained(): Promise<void> { if (this.error) throw this.error; if (this.bytes) await new Promise<void>(resolve => { this.drainWake = resolve; }); if (this.error) throw this.error; }
  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      if (this.error) throw this.error;
      // Buffered 1KiB pushes leave as one chunk, so stores write few large blocks.
      const chunk = this.chunks.length > 1 ? concat(this.chunks.splice(0)) : this.chunks.shift();
      if (chunk) {
        yield chunk;
        this.bytes -= chunk.length; this.onProgress();
        if (!this.bytes) { this.drainWake?.(); this.drainWake = null; }
      } else if (this.ended) return;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}

export interface ExtractZipOptions {
  /** Fails the extraction when no entry consumes bytes for this long (default two minutes). */
  stallMs?: number;
}
const DEFAULT_STALL_MS = 120_000;

/**
 * Each compressed push is at most 1KiB. Once the entries buffer at least one
 * transport chunk (256KiB), the producer waits until every buffered entry has
 * drained before the next push. Entries are handed to
 * `consume` strictly one after another, in archive order: an entry whose bytes
 * are all buffered never waits behind a later entry that still needs input
 * (with concurrent consumers and a serialized backend, a later entry's write
 * could take the backend first and wait for bytes the producer would only push
 * after the earlier entry drained). A stall watchdog turns any remaining hang
 * into an error instead of a silent stop.
 */
export async function extractZip(source: AsyncIterable<Uint8Array>, consume: (entry: ArchiveEntry) => Promise<void>, signal?: AbortSignal, options: ExtractZipOptions = {}): Promise<void> {
  const stallMs = options.stallMs ?? DEFAULT_STALL_MS;
  const active = new Set<EntryQueue>(); const names = new Set<string>();
  let failure: unknown; let count = 0; let lastProgress = Date.now(); let currentPath = '';
  let consumers: Promise<void> = Promise.resolve(); let stall: RepositoryError | null = null;
  const progress = () => { lastProgress = Date.now(); };
  const fail = (error: unknown) => { failure ??= error; };
  const unzip = new Unzip(file => {
    if (file.name.endsWith('/')) return;
    const path = safePath(file.name);
    if (++count > TRANSPORT_LIMITS.zipEntries || names.has(path)) throw new RepositoryError('budget', 'Duplicate or excessive ZIP entries');
    names.add(path);
    if (file.compression !== 0 && file.compression !== 8) throw new RepositoryError('unsupported', 'Unsupported ZIP compression');
    const queue = new EntryQueue(progress); active.add(queue);
    consumers = consumers.then(async () => {
      if (failure) { queue.fail(failure); return; }
      currentPath = path; progress();
      await consume({ path, chunks: queue });
    }).catch(error => { fail(error); queue.fail(error); }).finally(() => { queue.release(); active.delete(queue); progress(); });
    file.ondata = (error, data, final) => {
      if (error) { fail(error); queue.fail(error); return; }
      try { queue.push(data, final); } catch (cause) { fail(cause); queue.fail(cause); file.terminate(); }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  /** Resolves with `work`, or rejects once no entry has made progress for `stallMs`. */
  const watch = async (work: Promise<unknown>, stage: string) => {
    progress();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_resolve, reject) => {
      const check = () => {
        const idle = Date.now() - lastProgress;
        if (idle < stallMs) { timer = setTimeout(check, stallMs - idle); return; }
        const error = stall = new RepositoryError('io', `Archive extraction stalled for ${Math.round(idle / 1000)} s while ${stage}${currentPath ? ` (entry ${currentPath})` : ''}`);
        log.error('Archive extraction stalled', { stage, entry: currentPath, entries: count, idleMs: idle });
        reject(error);
      };
      timer = setTimeout(check, stallMs);
    });
    try { await Promise.race([work, stalled]); } finally { clearTimeout(timer); }
  };
  try {
    for await (const bytes of source) {
      progress();
      for (let offset = 0; offset < bytes.length; offset += 1024) {
        if (signal?.aborted) throw new RepositoryError('cancelled', 'Archive import cancelled');
        unzip.push(bytes.subarray(offset, offset + 1024));
        const pending = [...active].filter(queue => queue.buffered);
        if (pending.reduce((total, queue) => total + queue.buffered, 0) >= TRANSPORT_LIMITS.chunkBytes) await watch(Promise.all(pending.map(queue => queue.drained())), 'waiting for archive entries to be stored');
        if (failure) throw failure;
      }
    }
    unzip.push(new Uint8Array(), true);
    await watch(consumers, 'storing the last archive entries');
    if (failure) throw failure;
  } catch (error) {
    fail(error);
    for (const queue of active) queue.fail(error);
    // A stalled consumer may never settle; other failures let consumers observe the error first.
    if (!stall) await watch(consumers, 'cancelling archive extraction').catch(() => {});
    throw error;
  }
}
