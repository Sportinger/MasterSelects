// The directory/file handle surface that project storage uses on OPFS, served
// from a plain entry store instead. When a browser refuses OPFS (WebKit's
// "unknown transient reason" in Private Browsing, in-app browsers or on a
// nearly full device), the same repository backend, scratch recovery and
// archive export run on these handles over IndexedDB.
//
// Files are written sequentially in bounded chunks and become visible only
// when the writable stream closes, matching OPFS swap-on-close semantics.

export const FALLBACK_CHUNK_BYTES = 4 * 1024 * 1024;
const FILE_CACHE_BYTES = 128 * 1024 * 1024;

export interface FallbackEntry {
  path: string;
  parent: string;
  name: string;
  kind: 'file' | 'directory';
  size: number;
  lastModified: number;
  contentId: string | null;
}

/** Persistence used by the handles; every method is atomic on its own. */
export interface FallbackEntryStore {
  get(path: string): Promise<FallbackEntry | undefined>;
  children(parent: string): Promise<FallbackEntry[]>;
  /** Adds the entry when its path is free and returns whatever entry holds the path afterwards. */
  ensure(entry: FallbackEntry): Promise<FallbackEntry>;
  /** Removes the entry, its descendants and all of their content. */
  remove(path: string): Promise<void>;
  putChunk(contentId: string, index: number, bytes: ArrayBuffer): Promise<void>;
  readChunks(contentId: string): Promise<ArrayBuffer[]>;
  /** Points a file at new content and drops its previous content. */
  commit(path: string, contentId: string, size: number, lastModified: number): Promise<void>;
  discard(contentId: string): Promise<void>;
}

type WriteInput = BufferSource | Blob | string;
type WriteParams = { type: 'write'; data: WriteInput; position?: number } | { type: 'seek' | 'truncate'; position?: number; size?: number };

export function fallbackNotFound(path: string): DOMException {
  return new DOMException(`${path || 'Entry'} was not found in browser storage`, 'NotFoundError');
}

function childPath(parent: string, name: string): string {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new TypeError(`Invalid browser storage entry name: ${String(name)}`);
  }
  return parent ? `${parent}/${name}` : name;
}

/** Content is immutable per content id, so a read cache can never return stale bytes. */
class FileContentCache {
  private readonly files = new Map<string, File>();
  private bytes = 0;
  get(contentId: string): File | undefined {
    const file = this.files.get(contentId);
    if (file) { this.files.delete(contentId); this.files.set(contentId, file); }
    return file;
  }
  set(contentId: string, file: File): void {
    this.files.set(contentId, file); this.bytes += file.size;
    // The most recent file always stays: ranged reads of one large file must not reload it per range.
    while (this.bytes > FILE_CACHE_BYTES && this.files.size > 1) {
      const [oldest, evicted] = this.files.entries().next().value!;
      this.files.delete(oldest); this.bytes -= evicted.size;
    }
  }
}

class FallbackHandle {
  readonly store: FallbackEntryStore;
  readonly cache: FileContentCache;
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'directory';
  constructor(store: FallbackEntryStore, cache: FileContentCache, path: string, name: string, kind: 'file' | 'directory') {
    this.store = store; this.cache = cache; this.path = path; this.name = name; this.kind = kind;
  }
  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof FallbackHandle && other.store === this.store && other.path === this.path && other.kind === this.kind;
  }
  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
}

class FallbackDirectoryHandle extends FallbackHandle {
  constructor(store: FallbackEntryStore, cache: FileContentCache, path: string, name: string) {
    super(store, cache, path, name, 'directory');
  }
  getDirectoryHandle(name: string, options?: { create?: boolean }) { return this.child(name, 'directory', options?.create === true); }
  getFileHandle(name: string, options?: { create?: boolean }) { return this.child(name, 'file', options?.create === true); }
  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const path = childPath(this.path, name);
    const entry = await this.store.get(path);
    if (!entry) throw fallbackNotFound(path);
    if (entry.kind === 'directory' && !options?.recursive && (await this.store.children(path)).length) {
      throw new DOMException(`${path} is not empty`, 'InvalidModificationError');
    }
    await this.store.remove(path);
  }
  async *entries(): AsyncGenerator<[string, FallbackDirectoryHandle | FallbackFileHandle]> {
    if (this.path && !await this.store.get(this.path)) throw fallbackNotFound(this.path);
    for (const entry of await this.store.children(this.path)) yield [entry.name, this.handleFor(entry)];
  }
  async *keys(): AsyncGenerator<string> { for await (const [name] of this.entries()) yield name; }
  async *values(): AsyncGenerator<FallbackDirectoryHandle | FallbackFileHandle> { for await (const [, handle] of this.entries()) yield handle; }
  [Symbol.asyncIterator]() { return this.entries(); }
  async resolve(possibleDescendant: unknown): Promise<string[] | null> {
    if (!(possibleDescendant instanceof FallbackHandle) || possibleDescendant.store !== this.store) return null;
    if (possibleDescendant.path === this.path) return [];
    const prefix = this.path ? `${this.path}/` : '';
    return possibleDescendant.path.startsWith(prefix) ? possibleDescendant.path.slice(prefix.length).split('/') : null;
  }
  private handleFor(entry: FallbackEntry) {
    return entry.kind === 'directory'
      ? new FallbackDirectoryHandle(this.store, this.cache, entry.path, entry.name)
      : new FallbackFileHandle(this.store, this.cache, entry.path, entry.name);
  }
  private async child(name: string, kind: 'file' | 'directory', create: boolean) {
    const path = childPath(this.path, name);
    let entry = await this.store.get(path);
    if (!entry) {
      if (!create) throw fallbackNotFound(path);
      entry = await this.store.ensure({ path, parent: this.path, name, kind, size: 0, lastModified: Date.now(), contentId: null });
    }
    if (entry.kind !== kind) throw new DOMException(`${path} is not a ${kind}`, 'TypeMismatchError');
    return this.handleFor(entry);
  }
}

class FallbackFileHandle extends FallbackHandle {
  constructor(store: FallbackEntryStore, cache: FileContentCache, path: string, name: string) {
    super(store, cache, path, name, 'file');
  }
  async getFile(): Promise<File> {
    const entry = await this.store.get(this.path);
    if (!entry || entry.kind !== 'file') throw fallbackNotFound(this.path);
    if (!entry.contentId) return new File([], this.name, { lastModified: entry.lastModified });
    const cached = this.cache.get(entry.contentId);
    if (cached) return cached;
    const file = new File(await this.store.readChunks(entry.contentId), this.name, { lastModified: entry.lastModified });
    if (file.size !== entry.size) throw new DOMException(`${this.path} is incomplete in browser storage`, 'NotReadableError');
    this.cache.set(entry.contentId, file);
    return file;
  }
  async createWritable(options?: { keepExistingData?: boolean }): Promise<FallbackWritable> {
    const writable = new FallbackWritable(this.store, this.path);
    if (options?.keepExistingData) await writable.write(await this.getFile());
    else if (!await this.store.get(this.path)) throw fallbackNotFound(this.path);
    return writable;
  }
}

/** Sequential writable stream; seeking or truncating is reported, never silently ignored. */
class FallbackWritable {
  private readonly contentId = crypto.randomUUID();
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private chunkIndex = 0;
  private size = 0;
  private state: 'open' | 'closed' | 'aborted' = 'open';
  private readonly store: FallbackEntryStore;
  private readonly path: string;
  constructor(store: FallbackEntryStore, path: string) { this.store = store; this.path = path; }

  async write(input: WriteInput | WriteParams): Promise<void> {
    this.assertOpen();
    let data: WriteInput = input as WriteInput;
    if (typeof input === 'object' && input !== null && 'type' in input && !(input instanceof Blob)) {
      if (input.type !== 'write' || (input.position !== undefined && input.position !== this.size)) {
        throw new DOMException('Fallback browser storage writes files sequentially', 'NotSupportedError');
      }
      data = input.data;
    }
    try {
      if (typeof data === 'string') await this.append(new TextEncoder().encode(data));
      else if (data instanceof Blob) {
        for (let offset = 0; offset < data.size; offset += FALLBACK_CHUNK_BYTES) {
          await this.append(new Uint8Array(await data.slice(offset, offset + FALLBACK_CHUNK_BYTES).arrayBuffer()));
        }
      } else if (ArrayBuffer.isView(data)) await this.append(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
      else if (data instanceof ArrayBuffer) await this.append(new Uint8Array(data.slice(0)));
      else throw new TypeError('Unsupported data written to browser storage');
    } catch (error) { await this.abort(); throw error; }
  }
  async seek(): Promise<void> { throw new DOMException('Fallback browser storage writes files sequentially', 'NotSupportedError'); }
  async truncate(): Promise<void> { throw new DOMException('Fallback browser storage writes files sequentially', 'NotSupportedError'); }
  async close(): Promise<void> {
    this.assertOpen();
    try {
      if (this.pendingBytes) await this.flush();
      await this.store.commit(this.path, this.contentId, this.size, Date.now());
      this.state = 'closed';
    } catch (error) { await this.abort(); throw error; }
  }
  async abort(_reason?: unknown): Promise<void> {
    if (this.state !== 'open') return;
    this.state = 'aborted'; this.pending = []; this.pendingBytes = 0;
    await this.store.discard(this.contentId);
  }
  private assertOpen(): void {
    if (this.state !== 'open') throw new TypeError(`Browser storage stream for ${this.path} is ${this.state}`);
  }
  private async append(bytes: Uint8Array): Promise<void> {
    this.pending.push(bytes); this.pendingBytes += bytes.byteLength; this.size += bytes.byteLength;
    while (this.pendingBytes >= FALLBACK_CHUNK_BYTES) await this.flush();
  }
  /** Stores up to one chunk of the buffered bytes, keeping write memory bounded. */
  private async flush(): Promise<void> {
    const length = Math.min(this.pendingBytes, FALLBACK_CHUNK_BYTES);
    const chunk = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const head = this.pending[0];
      const take = Math.min(head.byteLength, length - filled);
      chunk.set(head.subarray(0, take), filled); filled += take;
      if (take === head.byteLength) this.pending.shift(); else this.pending[0] = head.subarray(take);
    }
    this.pendingBytes -= length;
    await this.store.putChunk(this.contentId, this.chunkIndex++, chunk.buffer);
  }
}

/** A root directory with the FileSystemDirectoryHandle surface project storage relies on. */
export function createFallbackDirectoryRoot(store: FallbackEntryStore): FileSystemDirectoryHandle {
  return new FallbackDirectoryHandle(store, new FileContentCache(), '', '') as unknown as FileSystemDirectoryHandle;
}

/** True for any handle served by the fallback store (root or descendant). */
export function isFallbackStorageHandle(handle: unknown): boolean {
  return handle instanceof FallbackHandle;
}
