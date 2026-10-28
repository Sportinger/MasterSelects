import { RepositoryError, toRepositoryError, type RepositoryBackend, type RepositoryOwner, type CommitReference } from '../contracts';
import { acquireBrowserOwner } from './browserOwner';
import { CACHEABLE_FILE_BYTES, DirectoryFileCache, WrittenBytes, isOwnedSlotPath, isWriteOncePath, type CachedContent } from './directoryFileCache';
import { Logger } from '../../../logger';

const log = Logger.create('RepositoryDirectoryBackend');
const COMMIT_PATH = /^\.masterselects\/commits\/[^/]+\.json$/;
type CommitSummary = { commitId: string; lastOperation: number; hash: string };
async function summarizeCommit(bytes: Uint8Array): Promise<CommitSummary | null> {
  try {
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    if (manifest?.format !== 'masterselects-commit' || !Number.isSafeInteger(manifest.lastOperation)) return null;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
    return { commitId: manifest.commitId, lastOperation: manifest.lastOperation, hash: 'sha256:' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') };
  } catch { return null; }
}

export function supportsRepositoryWritableStreams(): boolean {
  return typeof FileSystemFileHandle !== 'undefined'
    && typeof FileSystemFileHandle.prototype.createWritable === 'function';
}

export function repositoryPath(path: string): string[] {
  const parts = path.split('/');
  if (!path || parts.some(part => !part || part === '.' || part === '..' || /[\\:\0]/.test(part))) throw new RepositoryError('permission', 'Invalid repository path');
  return parts;
}
export function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new RepositoryError('cancelled', 'Repository I/O cancelled'); }
function translate(error: unknown): never { throw toRepositoryError(error); }
const isNotFound = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';

export function directoryBackend(root: FileSystemDirectoryHandle, locationId: string, hasWritePermission = true, writableStreams = supportsRepositoryWritableStreams()): RepositoryBackend {
  let owner: RepositoryOwner | null = null;
  let releasing = false;
  let queue = Promise.resolve();
  // Commit files are immutable once written: each is read and hashed once, not on every publication.
  // Only final files are summarized here: an empty (torn) file is never cached, see the head check.
  const commitSummaries = new Map<string, CommitSummary | null>();
  // Commit paths whose write failed in this session after the file may have been created. If the cleanup
  // failed too (a paused SAF folder fails both), what is left is this session's own torn write.
  const failedCommitWrites = new Set<string>();
  const reportedForeignEmptyCommits = new Set<string>();
  // Runtime handles only. Hundreds of history files share the same two directories.
  const directories = new Map<string, Promise<FileSystemDirectoryHandle>>();
  // A cursor continues one fresh directory discovery, rather than scanning every
  // physical entry again for each page. New discoveries always consult the disk.
  const listings = new Map<string, { prefix: string; paths: string[]; bytes: number; expires: number }>();
  const listingBudget = 4 * 1024 * 1024;
  let listingBytes = 0;
  const forgetListing = (id: string) => {
    const listing = listings.get(id);
    if (listing) { listingBytes -= listing.bytes; listings.delete(id); }
  };
  // Handles and final file contents for this session; directoryFileCache.ts documents why each is safe.
  const files = new DirectoryFileCache();
  // Slot replaces (view and startup cache slots) run beside the content queue, see write().
  const slotWrites = new Set<Promise<void>>();
  const writable = hasWritePermission && writableStreams
    && Boolean(navigator.locks) && !locationId.startsWith('fsa-readonly:');
  function lookup(directory: FileSystemDirectoryHandle, part: string, prefix: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const pending = directory.getDirectoryHandle(part, { create });
    directories.set(prefix, pending);
    void pending.catch(() => { if (directories.get(prefix) === pending) directories.delete(prefix); });
    if (directories.size > 1024) directories.delete(directories.keys().next().value!);
    return pending;
  }
  async function parent(path: string, create = false) {
    const parts = repositoryPath(path); const name = parts.pop()!; let directory = root;
    let prefix = '';
    for (const part of parts) {
      prefix += `${part}/`;
      const pending = directories.get(prefix);
      if (!pending) { directory = await lookup(directory, part, prefix, create); continue; }
      try { directory = await pending; }
      catch (error) {
        // A reader's in-flight lookup (create: false) of a folder that does not exist yet must not fail a
        // concurrent writer: on slow disks a view slot or artifact manifest write raced a stat of the same
        // new folder and reported "A requested file or directory could not be found" for a write.
        if (!create || !isNotFound(error)) throw error;
        directory = await lookup(directory, part, prefix, true);
      }
    }
    return { directory, name };
  }
  function fileHandle(path: string): Promise<FileSystemFileHandle> {
    return files.handle(path, async () => { const { directory, name } = await parent(path); return directory.getFileHandle(name); });
  }
  /** A File snapshot through the session handle. A stale cached handle is resolved once more. */
  async function freshSnapshot(path: string): Promise<File> {
    const cached = files.hasHandle(path);
    let file: File;
    try { file = await (await fileHandle(path)).getFile(); }
    catch (error) {
      files.forgetHandle(path);
      if (!cached || !isNotFound(error)) throw error;
      file = await (await fileHandle(path)).getFile();
    }
    files.rememberSnapshot(path, file);
    return file;
  }
  const snapshot = (path: string): Promise<File> => {
    const known = files.snapshot(path);
    return known ? Promise.resolve(known) : freshSnapshot(path);
  };
  /** Reads through a (possibly remembered) snapshot; a remembered one that cannot be read is replaced once. */
  async function withSnapshot<T>(path: string, consume: (file: File) => Promise<T>): Promise<T> {
    const known = files.snapshot(path);
    if (!known) return consume(await freshSnapshot(path));
    try { return await consume(known); }
    catch (error) {
      if (error instanceof RepositoryError) throw error;
      files.forgetSnapshot(path);
      return consume(await freshSnapshot(path));
    }
  }
  /**
   * Final contents only: write-once files always, owned slots only while this backend still holds the writer
   * locks AND only when the bytes were cached under the current ownership epoch. After a release another
   * owner may have rewritten the slot, so a re-acquired owner never sees bytes from an earlier epoch.
   */
  async function cachedContent(path: string): Promise<CachedContent | undefined> {
    const hit = files.content(path);
    if (!hit || isWriteOncePath(path)) return hit;
    if (!owner || hit.writerEpoch !== owner.writerEpoch) { files.forgetContent(path); return undefined; }
    try { await owner.assertOwned(); return hit; } catch { files.forgetContent(path); return undefined; }
  }
  /**
   * This session's own failed commit write that can never become a valid commit: empty (created, then the
   * write failed before any byte landed and its cleanup failed as well), or written but not parseable.
   * Such a file is not referenced by any valid chain: a successor is only written after its predecessor was
   * published and verified. It is ignored for head selection and removed under the held writer locks
   * (inside the serialized write queue, so no write of ours is in flight on it). Failing removal is logged
   * and retried at the next head check; it never blocks a save.
   */
  /**
   * An empty commit file this session did not create is never deleted: it may be a commit another device is
   * still syncing in (a 0-byte placeholder of a Drive/Dropbox/SAF provider) or one another origin is writing
   * right now; navigator.locks only exclude writers of this origin. Deleting it could sync back and destroy
   * that commit. It is only skipped for head selection (recovery skips it too) and logged once per session.
   */
  function noteForeignEmptyCommit(commitPath: string): void {
    if (reportedForeignEmptyCommits.has(commitPath)) return;
    reportedForeignEmptyCommits.add(commitPath);
    log.info(`Empty commit file not written by this session ignored and left in place: ${commitPath}`);
  }
  async function removeTornCommit(commitPath: string, size: number): Promise<boolean> {
    files.forget(commitPath); commitSummaries.delete(commitPath);
    try {
      const { directory, name } = await parent(commitPath);
      await directory.removeEntry(name);
    } catch (error) {
      if (!isNotFound(error)) {
        log.warn(`Interrupted commit file ignored; removing it failed and is retried at the next save: ${commitPath} (${size} bytes)`, error);
        return false;
      }
    }
    failedCommitWrites.delete(commitPath);
    log.info(`Removed interrupted commit file: ${commitPath} (${size} bytes)`);
    return true;
  }
  async function write(path: string, chunks: AsyncIterable<Uint8Array>, replace: boolean, signal?: AbortSignal, expectedPrevious?: CommitReference | null) {
    repositoryPath(path);
    if (path !== 'project.msrepo.json' && path !== 'archive-manifest.json' && !/^\.masterselects\/cache\/startup\/[ab]\.json$/.test(path) && !/^\.masterselects\/(segments|commits|artifacts|artifact-manifests|views|imports|transport|backup-sources)\//.test(path)) throw new RepositoryError('permission', 'Repository writes cannot mutate original source paths');
    // Once release() has begun no new write may start: release waits only for writes started before it.
    if (releasing) throw new RepositoryError('ownership', 'Repository writer is being released');
    const removeAfterFailedWrite = async (directory: FileSystemDirectoryHandle, name: string) => {
      try { await directory.removeEntry(name); }
      catch { if (COMMIT_PATH.test(path)) failedCommitWrites.add(path); }
    };
    const run = async () => {
      try {
        if (!writable || !owner) throw new RepositoryError('ownership', 'Repository is read-only');
        const writer = owner;
        await writer.assertOwned(); checkAbort(signal);
        // Set by the commit head check below when its listing proves the commit file does not exist yet.
        let listedAbsent = false;
        if (expectedPrevious !== undefined) {
          let cursor: string | undefined; let latest: CommitReference | null = null; let sequence = -1;
          let listedSelf = false;
          let expectedSequence = -1;
          if (expectedPrevious) {
            const bytes = await backend.read(`.masterselects/commits/${expectedPrevious.commitId}.json`, 0, undefined, signal);
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
            const hash = 'sha256:' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
            if (hash !== expectedPrevious.hash) throw new RepositoryError('corrupt', 'Expected predecessor descriptor changed');
            expectedSequence = JSON.parse(new TextDecoder().decode(bytes)).lastOperation;
          }
          do {
            const page = await backend.list('.masterselects/commits/', cursor, 128, signal);
            for (const commitPath of page.paths) {
              let summary = commitSummaries.get(commitPath);
              if (summary === undefined) {
                const bytes = await backend.read(commitPath, 0, undefined, signal);
                summary = bytes.length ? await summarizeCommit(bytes) : null;
                const ownTorn = failedCommitWrites.has(commitPath) && (!bytes.length || !summary);
                if (!bytes.length || ownTorn) {
                  // Torn or still-arriving: never cached (a retry or a sync may still finish this path) and never
                  // a head candidate. Only this session's own failed writes are removed. Our own empty target is
                  // left in place: the write below finishes it.
                  const removed = commitPath === path && !bytes.length ? false
                    : ownTorn ? await removeTornCommit(commitPath, bytes.length)
                    : (noteForeignEmptyCommit(commitPath), false);
                  if (commitPath === path && !removed) listedSelf = true;
                  continue;
                }
                commitSummaries.set(commitPath, summary);
              }
              if (commitPath === path) listedSelf = true;
              if (!summary || summary.lastOperation < expectedSequence) continue;
              if (summary.lastOperation > sequence) { sequence = summary.lastOperation; latest = { commitId: summary.commitId, hash: summary.hash }; }
              else if (summary.lastOperation === sequence && latest?.hash !== summary.hash) throw new RepositoryError('conflict', 'Diverging committed repository heads');
            }
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          if (latest?.commitId !== expectedPrevious?.commitId || latest?.hash !== expectedPrevious?.hash) throw new RepositoryError('conflict', 'Repository head changed before publication');
          listedAbsent = !listedSelf;
        }
        if (replace && !/^\.masterselects\/views\/[^/]+\/[^/]+\/[ab]\.json$/.test(path) && !/^\.masterselects\/cache\/startup\/[ab]\.json$/.test(path)) throw new RepositoryError('permission', 'Only inactive view or startup cache slots may be replaced');
        const { directory, name } = await parent(path, true);
        // A slot replace drops its cached copy before the old bytes can be overwritten.
        if (replace) files.forgetContent(path);
        let existing = false;
        let file: FileSystemFileHandle;
        if (replace) {
          // Slots are rewritten in place: one lookup (none once this session resolved it). Only a missing slot
          // is created, and only a slot created here is removed again when the write fails, as before.
          try { file = await fileHandle(path); existing = true; }
          catch (error) {
            if (!isNotFound(error)) throw error;
            file = await directory.getFileHandle(name, { create: true }); files.setHandle(path, file);
          }
        } else {
          // create:true never truncates an existing file, so the immutability check below still sees its bytes.
          // An empty immutable file is the leftover of a write that was interrupted after the file was
          // created (e.g. the browser paused folder access, so its cleanup failed too). Immutable records
          // are never empty, and an empty blob rewritten empty is identical: finish that write instead of
          // failing every retry with a conflict.
          file = await directory.getFileHandle(name, { create: true });
          // A commit whose name the head check's listing just did not contain (inside this serialized queue,
          // under the location lock, with a fresh random commit ID) cannot exist: skip the size probe.
          // Anything listed, and every other immutable file, keeps the probe.
          existing = !listedAbsent && (await file.getFile()).size > 0;
          if (existing) throw new RepositoryError('conflict', `Immutable file already exists: ${path}`);
          files.setHandle(path, file);
        }
        let stream: FileSystemWritableFileStream;
        try {
          if (typeof file.createWritable !== 'function') throw new RepositoryError('unsupported', 'This browser cannot write project files. Update your browser before editing.');
          stream = await file.createWritable({ keepExistingData: false });
        } catch (error) {
          files.forgetHandle(path);
          if (!existing) await removeAfterFailedWrite(directory, name);
          throw error;
        }
        const written = new WrittenBytes(isWriteOncePath(path) || isOwnedSlotPath(path));
        try {
          for await (const chunk of chunks) {
            checkAbort(signal); await writer.assertOwned();
            written.add(chunk);
            for (let offset = 0; offset < chunk.byteLength; offset += 256 * 1024) await stream.write(chunk.slice(offset, offset + 256 * 1024));
          }
          checkAbort(signal); await writer.assertOwned(); await stream.close();
        } catch (error) { files.forgetHandle(path); await stream.abort().catch(() => {}); if (!existing) await removeAfterFailedWrite(directory, name); throw error; }
        // Completion check on the same handle (one call) instead of the callers' read-back of every byte:
        // close() resolved, so the browser has moved the complete swap file into place ('stream-close'
        // durability); a provider that stored a different length is caught here. Byte-level damage is still
        // caught where it matters: recovery hashes every segment against its commit and every commit against
        // its successor before it becomes a head, and the commit pointer is always written last.
        // Deliberate trade-off, keep it: a confirmed save is not read back from disk in this session. The
        // session's own read-backs (verifyWritten, the predecessor re-hash) are served from the bytes that
        // were sent; the bytes on disk are re-verified by recovery on the next open (full recovery hashes
        // them; with a startup cache, damage surfaces as a 'corrupt' record read instead).
        const stored = await file.getFile();
        if (stored.size !== written.length) {
          if (COMMIT_PATH.test(path)) failedCommitWrites.add(path);
          throw new RepositoryError('corrupt', `Write did not complete: ${path}`);
        }
        if (COMMIT_PATH.test(path)) { commitSummaries.delete(path); failedCommitWrites.delete(path); }
        const bytes = written.bytes();
        if (bytes) files.remember(path, bytes, stored.lastModified, writer.writerEpoch);
      } catch (error) { translate(error); }
    };
    if (replace) {
      // Slot replaces do not wait behind content writes and may run concurrently with each other: they touch
      // only their own slot file, never a segment, commit or the head check, and every caller already orders
      // the writes it depends on (the view store writes the project shape after its parts, the startup
      // cache is serialized with publications). Ownership is still asserted per write and per chunk, and
      // release() waits for them like for the queue. This lets a save write its changed view keys in parallel.
      const task = run();
      slotWrites.add(task);
      void task.catch(() => {}).finally(() => slotWrites.delete(task));
      await task; return;
    }
    const task = queue.then(run);
    queue = task.catch(() => {}); await task;
  }
  const backend: RepositoryBackend = {
    locationId,
    capabilities: { rangeReads: true, immutableWrites: writable, replaceViewSlots: writable, ownership: writable, durability: 'stream-close' },
    async acquireOwner(repositoryId, signal) {
      if (!writable) return null;
      if (owner) throw new RepositoryError('ownership', 'This backend already owns a repository');
      const acquired = await acquireBrowserOwner(locationId, repositoryId, signal);
      if (!acquired) return null;
      releasing = false;
      const wrapped = {
        writerEpoch: acquired.writerEpoch, assertOwned: () => acquired.assertOwned(),
        async release() {
          // Refuse new writes first (synchronously, see write()), then wait for every write started before:
          // the content queue and the slot replaces running beside it. Only then are the locks dropped.
          releasing = true;
          await queue; await Promise.allSettled([...slotWrites]);
          // Owned-slot bytes belong to this ownership epoch; another owner may rewrite the slots next.
          files.forgetOwnedSlots();
          await acquired.release(); if (owner === wrapped) { owner = null; releasing = false; }
        },
      };
      owner = wrapped; return wrapped;
    },
    async prepareDirectories(prefixes, create) {
      // A hint only: resolves the folders a session is about to use concurrently instead of one lookup per
      // operation later. Creating needs the held writer (folders are what the first write would create
      // anyway). Failures are ignored here and surface, unchanged, at the operation that needs the folder.
      const make = create && writable && owner !== null;
      await Promise.all(prefixes.map(prefix => parent(`${prefix}listing`, make).catch(() => {})));
    },
    async list(prefix, cursor = '', limit = 128, signal) {
      checkAbort(signal); limit = Math.min(1024, Math.max(1, limit));
      if (prefix && !prefix.endsWith('/')) repositoryPath(prefix); else if (prefix) repositoryPath(prefix.slice(0, -1));
      const now = Date.now();
      for (const [id, listing] of listings) if (listing.expires <= now) forgetListing(id);
      let after = cursor;
      let continuedId: string | undefined;
      if (cursor.startsWith('directory-page:')) {
        try {
          const parsed = JSON.parse(cursor.slice('directory-page:'.length)) as unknown;
          if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some(value => typeof value !== 'string')) throw new Error();
          [continuedId, after] = parsed as [string, string];
          repositoryPath(after);
          if (!after.startsWith(prefix)) throw new Error();
        } catch { throw new RepositoryError('budget', 'Invalid directory listing cursor'); }
      }
      const pageFrom = (id: string, paths: string[]) => {
        const start = after ? paths.findIndex(path => path > after) : 0;
        const selected = start < 0 ? [] : paths.slice(start, start + limit);
        const hasMore = start >= 0 && start + limit < paths.length;
        if (!hasMore) forgetListing(id);
        return { paths: selected, nextCursor: hasMore ? `directory-page:${JSON.stringify([id, selected.at(-1)!])}` : null };
      };
      const continued = continuedId ? listings.get(continuedId) : undefined;
      if (continued && continued.prefix === prefix) return pageFrom(continuedId!, continued.paths);
      // Evicted/expired cursors can still continue by their last path. Very large
      // directories use the original bounded page selection instead of growing memory.
      const selected: string[] = [];
      let snapshot: string[] | null = [];
      let snapshotBytes = 0;
      const select = (path: string) => {
        const index = selected.findIndex(item => item > path);
        selected.splice(index === -1 ? selected.length : index, 0, path);
        if (selected.length > limit + 1) selected.pop();
      };
      // Sibling folders are listed concurrently (a few at a time): each entries() is a provider round trip,
      // and a view listing walks one folder per view key. Collection below is order-independent (paths are
      // sorted or inserted in order), so the result is identical to a sequential walk.
      async function walk(directory: FileSystemDirectoryHandle, base: string): Promise<void> {
        const folders: Array<[FileSystemDirectoryHandle, string]> = [];
        for await (const [name, handle] of (directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
          checkAbort(signal); const path = base + name;
          // The listing already holds every handle it walks: remember repository ones, so the reads that
          // usually follow a listing (commit manifests, view slots) skip their lookups. Handles are runtime
          // references only (see directoryFileCache.ts); a stale one is resolved again on use.
          const seed = path.startsWith('.masterselects/');
          if (handle.kind === 'directory') {
            if (seed && !directories.has(path + '/') && typeof (handle as FileSystemDirectoryHandle).getDirectoryHandle === 'function') {
              directories.set(path + '/', Promise.resolve(handle as FileSystemDirectoryHandle));
              if (directories.size > 1024) directories.delete(directories.keys().next().value!);
            }
            if (prefix.startsWith(path + '/') || path.startsWith(prefix)) folders.push([handle as FileSystemDirectoryHandle, path + '/']);
          } else if (seed && !files.hasHandle(path) && typeof (handle as FileSystemFileHandle).getFile === 'function') files.setHandle(path, handle as FileSystemFileHandle);
          if (handle.kind === 'directory') continue;
          if (path.startsWith(prefix) && path > after) {
            if (snapshot) {
              snapshotBytes += path.length * 2 + 64;
              snapshot.push(path);
              if (snapshotBytes > listingBudget || snapshot.length > 32768) {
                selected.push(...snapshot.toSorted().slice(0, limit + 1)); snapshot = null;
              }
            } else select(path);
          }
        }
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(8, folders.length) }, async () => {
          while (next < folders.length) { const [folder, path] = folders[next++]!; await walk(folder, path); }
        }));
      }
      try {
        const slash = prefix.lastIndexOf('/');
        if (slash < 0) await walk(root, '');
        else {
          const base = prefix.slice(0, slash + 1);
          let directory: FileSystemDirectoryHandle;
          try { directory = (await parent(`${base}listing`)).directory; }
          catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return { paths: [], nextCursor: null }; throw error; }
          await walk(directory, base);
        }
      } catch (error) { translate(error); }
      checkAbort(signal);
      if (snapshot) {
        const paths = snapshot.toSorted();
        if (paths.length <= limit) return { paths, nextCursor: null };
        while (listings.size >= 4 || listingBytes + snapshotBytes > listingBudget) forgetListing(listings.keys().next().value!);
        const id = crypto.randomUUID();
        listings.set(id, { prefix, paths, bytes: snapshotBytes, expires: now + 60_000 });
        listingBytes += snapshotBytes;
        return pageFrom(id, paths);
      }
      const hasMore = selected.length > limit; if (hasMore) selected.pop();
      return { paths: selected, nextCursor: hasMore ? selected.at(-1)! : null };
    },
    async read(path, offset = 0, length, signal) {
      checkAbort(signal);
      if (!Number.isSafeInteger(offset) || offset < 0 || (length !== undefined && (!Number.isSafeInteger(length) || length < 0))) throw new RepositoryError('budget', 'Invalid read range');
      const sizeOf = (fileSize: number) => {
        const size = length ?? Math.max(0, fileSize - offset);
        if (size > 4 * 1024 * 1024) throw new RepositoryError('budget', 'Use bounded range reads for large files');
        return size;
      };
      const hit = await cachedContent(path);
      if (hit) { const size = sizeOf(hit.bytes.length); checkAbort(signal); return hit.bytes.slice(offset, offset + size); }
      try {
        return await withSnapshot(path, async file => {
          const size = sizeOf(file.size);
          if (isWriteOncePath(path) && file.size > 0 && file.size <= CACHEABLE_FILE_BYTES) {
            // Final bytes: one read of the whole (bounded) file serves every later header, frame and stat.
            const whole = new Uint8Array(await file.arrayBuffer()); checkAbort(signal);
            if (whole.length === file.size) files.remember(path, whole, file.lastModified);
            return whole.slice(offset, offset + size);
          }
          const bytes = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()); checkAbort(signal); return bytes;
        });
      } catch (error) { translate(error); }
    },
    async stat(path) {
      const hit = await cachedContent(path);
      if (hit) return { length: hit.bytes.length, modifiedTime: hit.modifiedTime };
      try { const file = await snapshot(path); return { length: file.size, modifiedTime: file.lastModified }; }
      catch (error) { if (isNotFound(error)) return null; translate(error); }
    },
    async readBlob(path, signal) { checkAbort(signal); try { const file = await snapshot(path); checkAbort(signal); return file; } catch (error) { if (isNotFound(error)) return null; translate(error); } },
    writeNew: (path, chunks, signal) => write(path, chunks, false, signal),
    replaceViewSlot: (path, chunks, signal) => write(path, chunks, true, signal),
    async publishCommit(path, bytes, previous, expectedOwner, signal) {
      if (owner !== expectedOwner) throw new RepositoryError('ownership', 'Publication owner mismatch');
      if (!/^\.masterselects\/commits\/[^/]+\.json$/.test(path)) throw new RepositoryError('permission', 'Invalid commit publication path');
      await write(path, (async function* () { yield bytes; })(), false, signal, previous);
    },
    async removeUnpublished(path) { if (!/^\.masterselects\/(artifacts|artifact-manifests)\//.test(path)) throw new RepositoryError('permission', 'Published segments, commits and source originals cannot be removed'); if (releasing) throw new RepositoryError('ownership', 'Repository writer is being released'); await queue; if (!owner) throw new RepositoryError('ownership', 'Repository is read-only'); await owner.assertOwned(); const { directory, name } = await parent(path); files.forget(path); await directory.removeEntry(name); },
  };
  return backend;
}
