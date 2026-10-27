import { REPOSITORY_LIMITS } from '../contracts';

/**
 * Session caches of one directory backend (File System Access folder, OPFS or its IndexedDB fallback).
 *
 * Why: on Android a project folder is a SAF document provider and every handle call is an IPC round trip
 * of 20-100+ ms. Resolving a file handle, taking a File snapshot and reading it are three such round trips,
 * and the repository format reads the same few immutable files many times (one header and one frame read
 * per record), so opening an empty project cost ~180 strictly sequential calls.
 *
 * Safety argument, per cache:
 * - File handles are runtime references to a NAME in a directory, not to file contents. Every read still
 *   takes a fresh File snapshot through the handle, so a cached handle never serves stale bytes. A handle
 *   that went stale (the file was removed and re-created elsewhere) is dropped and resolved once more.
 * - Contents of write-once paths: `directoryBackend.write` refuses to replace a non-empty segment, commit
 *   or descriptor file, and `removeUnpublished` cannot delete them, so once such a file is non-empty its
 *   bytes are final for every writer of this format. Serving them again from memory is exactly what a disk
 *   read would return. Empty files (an interrupted write that a retry may still finish) are never cached.
 *   Readers keep verifying every record and segment hash against the reference they hold, so a damaged
 *   file is still reported, only without paying the round trips again.
 * - File snapshots of write-once paths: a File from getFile() stays readable while the file is unchanged,
 *   and a non-empty write-once file never changes (see above), so a later stat or read can use it without
 *   asking the provider again. Chrome rejects reading a snapshot of a file that did change; that error
 *   drops the snapshot and the read is repeated with a fresh one.
 * - Contents of owned slots (this workspace's view slots, the startup cache slots): cached only from this
 *   backend's own completed write and served only while it still holds the writer locks, i.e. while no
 *   other same-origin writer can replace them. Every replace drops the cached copy before it starts.
 *   Each entry carries the writer epoch it was written under and is served only to that same epoch;
 *   release() drops all of them, because the next owner (possibly another backend) may rewrite the slots.
 * Entries are bounded (LRU by bytes); nothing here is durable or shared between backends.
 */
export const CACHEABLE_FILE_BYTES = 4 * 1024 * 1024;
const CONTENT_BUDGET = REPOSITORY_LIMITS.objectCacheBytes;
const HANDLE_LIMIT = 1024;

/** Paths `directoryBackend.write` creates exactly once and never replaces or removes. */
export function isWriteOncePath(path: string): boolean {
  return path === 'project.msrepo.json' || /^\.masterselects\/(segments\/[^/]+\.msseg|commits\/[^/]+\.json)$/.test(path);
}
/** Replaceable slots that only the current writer of the location rewrites. */
export function isOwnedSlotPath(path: string): boolean {
  return /^\.masterselects\/views\/[^/]+\/[^/]+\/[ab]\.json$/.test(path) || /^\.masterselects\/cache\/startup\/[ab]\.json$/.test(path);
}

export interface CachedContent {
  readonly bytes: Uint8Array; readonly modifiedTime: number;
  /** Owned slots only: the ownership epoch whose own write produced these bytes. */
  readonly writerEpoch?: string;
}

export class DirectoryFileCache {
  private readonly handles = new Map<string, Promise<FileSystemFileHandle>>();
  private readonly snapshots = new Map<string, File>();
  private readonly contents = new Map<string, CachedContent>();
  private contentBytes = 0;

  hasHandle(path: string): boolean { return this.handles.has(path); }
  /** Resolves a file handle once per session; failed lookups are not remembered (a later write may create the file). */
  handle(path: string, resolve: () => Promise<FileSystemFileHandle>): Promise<FileSystemFileHandle> {
    const known = this.handles.get(path);
    if (known) return known;
    const pending = resolve();
    this.setPending(path, pending);
    void pending.catch(() => { if (this.handles.get(path) === pending) this.handles.delete(path); });
    return pending;
  }
  setHandle(path: string, handle: FileSystemFileHandle): void { this.setPending(path, Promise.resolve(handle)); }
  forgetHandle(path: string): void { this.handles.delete(path); }
  private setPending(path: string, pending: Promise<FileSystemFileHandle>): void {
    this.handles.delete(path); this.handles.set(path, pending);
    if (this.handles.size > HANDLE_LIMIT) this.handles.delete(this.handles.keys().next().value!);
  }

  snapshot(path: string): File | undefined { return this.snapshots.get(path); }
  rememberSnapshot(path: string, file: File): void {
    if (!file.size || !isWriteOncePath(path)) return;
    this.snapshots.delete(path); this.snapshots.set(path, file);
    if (this.snapshots.size > HANDLE_LIMIT) this.snapshots.delete(this.snapshots.keys().next().value!);
  }
  content(path: string): CachedContent | undefined {
    const hit = this.contents.get(path);
    if (hit) { this.contents.delete(path); this.contents.set(path, hit); }
    return hit;
  }
  remember(path: string, bytes: Uint8Array, modifiedTime: number, writerEpoch?: string): void {
    if (!bytes.length || bytes.length > CACHEABLE_FILE_BYTES || !(isWriteOncePath(path) || isOwnedSlotPath(path))) return;
    this.forgetContent(path);
    // An owned slot without the epoch of the write that produced it could never be served safely.
    if (!isWriteOncePath(path) && !writerEpoch) return;
    this.contents.set(path, { bytes, modifiedTime, writerEpoch }); this.contentBytes += bytes.length;
    while (this.contentBytes > CONTENT_BUDGET) this.forgetContent(this.contents.keys().next().value!);
  }
  forgetContent(path: string): void {
    const hit = this.contents.get(path);
    if (hit) { this.contentBytes -= hit.bytes.length; this.contents.delete(path); }
  }
  forgetSnapshot(path: string): void { this.snapshots.delete(path); }
  /** Drops every cached owned-slot copy (on release of the writer locks). */
  forgetOwnedSlots(): void { for (const path of [...this.contents.keys()]) if (isOwnedSlotPath(path)) this.forgetContent(path); }
  forget(path: string): void { this.forgetHandle(path); this.forgetSnapshot(path); this.forgetContent(path); }
}

/** Collects a write's chunks for the content cache, giving up beyond the cacheable size. */
export class WrittenBytes {
  private parts: Uint8Array[] | null;
  private size = 0;
  constructor(collect: boolean) { this.parts = collect ? [] : null; }
  get length(): number { return this.size; }
  add(chunk: Uint8Array): void {
    this.size += chunk.byteLength;
    if (!this.parts) return;
    if (this.size > CACHEABLE_FILE_BYTES) { this.parts = null; return; }
    // Copy: the caller may reuse its buffer after the write resolved.
    this.parts.push(chunk.slice());
  }
  bytes(): Uint8Array | null {
    if (!this.parts) return null;
    if (this.parts.length === 1) return this.parts[0]!;
    const bytes = new Uint8Array(this.size); let at = 0;
    for (const part of this.parts) { bytes.set(part, at); at += part.length; }
    return bytes;
  }
}
