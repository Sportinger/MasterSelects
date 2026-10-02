import { RepositoryError, type RepositoryBackend, type RepositoryOwner, type CommitReference } from '../contracts';
import { acquireBrowserOwner } from './browserOwner';

export function repositoryPath(path: string): string[] {
  const parts = path.split('/');
  if (!path || parts.some(part => !part || part === '.' || part === '..' || /[\\:\0]/.test(part))) throw new RepositoryError('permission', 'Invalid repository path');
  return parts;
}
export function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new RepositoryError('cancelled', 'Repository I/O cancelled'); }
function translate(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  const name = error instanceof Error ? error.name : '';
  throw new RepositoryError(name === 'QuotaExceededError' ? 'quota' : name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : 'io', error instanceof Error ? error.message : String(error), { cause: error });
}

export function directoryBackend(root: FileSystemDirectoryHandle, locationId: string, hasWritePermission = true): RepositoryBackend {
  let owner: RepositoryOwner | null = null;
  let queue = Promise.resolve();
  // Commit files are immutable once written: each is read and hashed once, not on every publication.
  const commitSummaries = new Map<string, { commitId: string; lastOperation: number; hash: string } | null>();
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
  const writable = hasWritePermission && Boolean(navigator.locks) && !locationId.startsWith('fsa-readonly:');
  async function parent(path: string, create = false) {
    const parts = repositoryPath(path); const name = parts.pop()!; let directory = root;
    let prefix = '';
    for (const part of parts) {
      prefix += `${part}/`;
      let pending = directories.get(prefix);
      if (!pending) {
        pending = directory.getDirectoryHandle(part, { create });
        directories.set(prefix, pending);
        const key = prefix;
        void pending.catch(() => { if (directories.get(key) === pending) directories.delete(key); });
        if (directories.size > 256) directories.delete(directories.keys().next().value!);
      }
      directory = await pending;
    }
    return { directory, name };
  }
  async function write(path: string, chunks: AsyncIterable<Uint8Array>, replace: boolean, signal?: AbortSignal, expectedPrevious?: CommitReference | null) {
    repositoryPath(path);
    if (path !== 'project.msrepo.json' && path !== 'archive-manifest.json' && !/^\.masterselects\/(segments|commits|artifacts|artifact-manifests|views|imports|transport|backup-sources)\//.test(path)) throw new RepositoryError('permission', 'Repository writes cannot mutate original source paths');
    const task = queue.then(async () => {
      try {
        if (!writable || !owner) throw new RepositoryError('ownership', 'Repository is read-only');
        await owner.assertOwned(); checkAbort(signal);
        if (expectedPrevious !== undefined) {
          let cursor: string | undefined; let latest: CommitReference | null = null; let sequence = -1;
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
                try {
                  const manifest = JSON.parse(new TextDecoder().decode(bytes));
                  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
                  summary = manifest.format === 'masterselects-commit' && Number.isSafeInteger(manifest.lastOperation)
                    ? { commitId: manifest.commitId, lastOperation: manifest.lastOperation, hash: 'sha256:' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') } : null;
                } catch { summary = null; }
                commitSummaries.set(commitPath, summary);
              }
              if (!summary || summary.lastOperation < expectedSequence) continue;
              if (summary.lastOperation > sequence) { sequence = summary.lastOperation; latest = { commitId: summary.commitId, hash: summary.hash }; }
              else if (summary.lastOperation === sequence && latest?.hash !== summary.hash) throw new RepositoryError('conflict', 'Diverging committed repository heads');
            }
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          if (latest?.commitId !== expectedPrevious?.commitId || latest?.hash !== expectedPrevious?.hash) throw new RepositoryError('conflict', 'Repository head changed before publication');
        }
        if (replace && !/^\.masterselects\/views\/[^/]+\/[^/]+\/[ab]\.json$/.test(path)) throw new RepositoryError('permission', 'Only inactive view slots may be replaced');
        const { directory, name } = await parent(path, true);
        let existing = false;
        try { await directory.getFileHandle(name); existing = true; } catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
        if (existing && !replace) throw new RepositoryError('conflict', `Immutable file already exists: ${path}`);
        const file = await directory.getFileHandle(name, { create: true });
        const stream = await file.createWritable({ keepExistingData: false });
        try {
          for await (const chunk of chunks) {
            checkAbort(signal); await owner.assertOwned();
            for (let offset = 0; offset < chunk.byteLength; offset += 256 * 1024) await stream.write(chunk.slice(offset, offset + 256 * 1024));
          }
          checkAbort(signal); await owner.assertOwned(); await stream.close();
        } catch (error) { await stream.abort().catch(() => {}); if (!existing) await directory.removeEntry(name).catch(() => {}); throw error; }
      } catch (error) { translate(error); }
    });
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
      const wrapped = { writerEpoch: acquired.writerEpoch, assertOwned: () => acquired.assertOwned(), async release() { await queue; await acquired.release(); if (owner === wrapped) owner = null; } };
      owner = wrapped; return wrapped;
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
      async function walk(directory: FileSystemDirectoryHandle, base: string): Promise<void> {
        for await (const [name, handle] of (directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
          checkAbort(signal); const path = base + name;
          if (handle.kind === 'directory') { if (prefix.startsWith(path + '/') || path.startsWith(prefix)) await walk(handle as FileSystemDirectoryHandle, path + '/'); }
          else if (path.startsWith(prefix) && path > after) {
            if (snapshot) {
              snapshotBytes += path.length * 2 + 64;
              snapshot.push(path);
              if (snapshotBytes > listingBudget || snapshot.length > 32768) {
                selected.push(...snapshot.toSorted().slice(0, limit + 1)); snapshot = null;
              }
            } else select(path);
          }
        }
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
      try { const { directory, name } = await parent(path); const file = await (await directory.getFileHandle(name)).getFile();
        const size = length ?? Math.max(0, file.size - offset); if (size > 4 * 1024 * 1024) throw new RepositoryError('budget', 'Use bounded range reads for large files');
        const bytes = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()); checkAbort(signal); return bytes;
      } catch (error) { translate(error); }
    },
    async stat(path) { try { const { directory, name } = await parent(path); return { length: (await (await directory.getFileHandle(name)).getFile()).size }; } catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; translate(error); } },
    async readBlob(path, signal) { checkAbort(signal); try { const { directory, name } = await parent(path); const file = await (await directory.getFileHandle(name)).getFile(); checkAbort(signal); return file; } catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; translate(error); } },
    writeNew: (path, chunks, signal) => write(path, chunks, false, signal),
    replaceViewSlot: (path, chunks, signal) => write(path, chunks, true, signal),
    async publishCommit(path, bytes, previous, expectedOwner, signal) {
      if (owner !== expectedOwner) throw new RepositoryError('ownership', 'Publication owner mismatch');
      if (!/^\.masterselects\/commits\/[^/]+\.json$/.test(path)) throw new RepositoryError('permission', 'Invalid commit publication path');
      await write(path, (async function* () { yield bytes; })(), false, signal, previous);
    },
    async removeUnpublished(path) { if (!/^\.masterselects\/(artifacts|artifact-manifests)\//.test(path)) throw new RepositoryError('permission', 'Published segments, commits and source originals cannot be removed'); await queue; if (!owner) throw new RepositoryError('ownership', 'Repository is read-only'); await owner.assertOwned(); const { directory, name } = await parent(path); await directory.removeEntry(name); },
  };
  return backend;
}
