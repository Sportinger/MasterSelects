import { RepositoryError, type RepositoryBackend, type RepositoryOwner, type CommitReference } from '../contracts';
import type { RepositoryCommand, OkResponse, DirEntry } from '../../../nativeHelper/protocol';
import { acquireBrowserOwner } from './browserOwner';
import { checkAbort, repositoryPath } from './directoryBackend';
export interface NativeRepositoryClient {
  repositoryCommand(command: Omit<RepositoryCommand, 'id'>): Promise<OkResponse>;
  readRepositoryBlob?(path: string, signal?: AbortSignal): Promise<Blob | null>;
  listDir?(path: string): Promise<DirEntry[]>;
  getDownloadedFile?(path: string): Promise<ArrayBuffer | null>;
}
const CHUNK = 256 * 1024;
function encode(bytes: Uint8Array): string { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); }
function decode(text: string): Uint8Array { return Uint8Array.from(atob(text), character => character.charCodeAt(0)); }
export async function createNativeRepositoryBackend(rootPath: string, client: NativeRepositoryClient): Promise<RepositoryBackend> {
  let supported = false; let canonical = rootPath; let owner: RepositoryOwner | null = null; let lease = ''; let queue = Promise.resolve();
  async function rpc(command: Omit<RepositoryCommand, 'cmd' | 'id' | 'root'>) {
    try { return await client.repositoryCommand({ ...command, cmd: 'repository', root: canonical }); }
    catch (error) { throw new RepositoryError('io', error instanceof Error ? error.message : String(error), { cause: error }); }
  }
  try { const info = await rpc({ action: 'info' }); supported = info.repository_protocol === 1 && info.durability === 'fsync'; if (typeof info.canonical_root === 'string') canonical = info.canonical_root; } catch { /* Older helpers do not acquire a writer. */ }
  const locationId = `native:${canonical}`;
  const writable = supported && Boolean(navigator.locks);
  const legacyPath = (path: string) => `${canonical.replace(/[\\/]$/, '')}/${repositoryPath(path).join('/')}`;
  async function stat(path: string): Promise<{ length: number } | null> {
    repositoryPath(path);
    if (supported) { const response = await rpc({ action: 'stat', path }); return typeof response.length === 'number' ? { length: response.length } : null; }
    if (!client.listDir) throw new RepositoryError('unsupported', 'Older native helper has no repository reader');
    const parts = repositoryPath(path); const name = parts.pop()!;
    const entry = (await client.listDir(parts.length ? legacyPath(parts.join('/')) : canonical)).find(item => item.name === name && item.kind === 'file');
    return entry ? { length: entry.size } : null;
  }
  async function write(path: string, chunks: AsyncIterable<Uint8Array>, replace: boolean, signal?: AbortSignal, previous?: CommitReference | null) {
    repositoryPath(path);
    const task = queue.then(async () => {
      if (!owner || !writable) throw new RepositoryError('ownership', 'Native repository is read-only');
      checkAbort(signal); await owner.assertOwned();
      const response = await rpc({ action: 'begin', path, lease, replace });
      const upload = String(response.upload); let offset = 0;
      try {
        for await (const chunk of chunks) {
          for (let start = 0; start < chunk.byteLength; start += CHUNK) {
            checkAbort(signal); await owner.assertOwned(); const part = chunk.subarray(start, start + CHUNK);
            const written = await rpc({ action: 'chunk', lease, upload, offset, data: encode(part) });
            offset += part.byteLength;
            if (written.offset !== offset) throw new RepositoryError('io', 'Native chunk acknowledgement mismatch');
          }
        }
        checkAbort(signal); await owner.assertOwned();
        const result = await rpc({ action: 'finish', lease, upload, publish: previous !== undefined, expected_previous: previous });
        if (result.completed !== true || result.durability !== 'fsync') throw new RepositoryError('io', 'Native helper did not confirm durable completion');
      } catch (error) { await rpc({ action: 'abort', lease, upload }).catch(() => {}); throw error; }
    });
    queue = task.catch(() => {}); return task;
  }
  return {
    locationId, capabilities: { rangeReads: supported, immutableWrites: writable, replaceViewSlots: writable, ownership: writable, durability: 'fsync' },
    async acquireOwner(repositoryId, signal) {
      if (!writable) return null; if (owner) throw new RepositoryError('ownership', 'Native backend already owns repository');
      const browser = await acquireBrowserOwner(locationId, repositoryId, signal); if (!browser) return null;
      try {
        const acquired = await rpc({ action: 'acquire' });
        if (typeof acquired.lease !== 'string') { await browser.release(); return null; }
        lease = acquired.lease;
        const wrapped: RepositoryOwner = { writerEpoch: browser.writerEpoch, async assertOwned() { await browser.assertOwned(); const state = await rpc({ action: 'assert', lease }); if (state.owned !== true) throw new RepositoryError('ownership', 'Native OS lease lost'); }, async release() { try { await queue; await rpc({ action: 'release', lease }); } finally { await browser.release(); if (owner === wrapped) { owner = null; lease = ''; } } } };
        owner = wrapped; return wrapped;
      } catch (error) { await browser.release(); throw error; }
    },
    async list(prefix, cursor = '', limit = 128, signal) {
      checkAbort(signal); if (!supported) throw new RepositoryError('unsupported', 'Older helper cannot provide bounded repository listing');
      const response = await rpc({ action: 'list', path: prefix, cursor, limit: Math.min(1024, Math.max(1, limit)) }); checkAbort(signal);
      return { paths: response.paths as string[], nextCursor: response.nextCursor as string | null };
    },
    async read(path, offset = 0, length, signal) {
      repositoryPath(path); checkAbort(signal);
      if (!Number.isSafeInteger(offset) || offset < 0 || (length !== undefined && (!Number.isSafeInteger(length) || length < 0))) throw new RepositoryError('budget', 'Invalid native read range');
      const metadataLength = length === undefined ? (await stat(path))?.length : undefined;
      const size = length ?? (metadataLength === undefined ? undefined : Math.max(0, metadataLength - offset));
      if (size === undefined || size === null) throw new RepositoryError('io', 'Repository file missing');
      if (size > 4 * 1024 * 1024) throw new RepositoryError('budget', 'Native reads require bounded ranges');
      if (!supported) {
        const metadata = await stat(path); if (!metadata || metadata.length > 4 * 1024 * 1024 || !client.getDownloadedFile) throw new RepositoryError('unsupported', 'Old helper cannot read large repository files');
        const bytes = await client.getDownloadedFile(legacyPath(path)); if (!bytes) throw new RepositoryError('io', 'Native read failed'); checkAbort(signal); return new Uint8Array(bytes.slice(offset, offset + size));
      }
      const bytes = new Uint8Array(size); let used = 0;
      while (used < size) { checkAbort(signal); const response = await rpc({ action: 'read', path, offset: offset + used, length: Math.min(CHUNK, size - used) }); const part = decode(String(response.data)); bytes.set(part, used); used += part.length; if (part.length < Math.min(CHUNK, size - used + part.length)) break; }
      checkAbort(signal); return used === bytes.length ? bytes : bytes.slice(0, used);
    },
    stat,
    readBlob: client.readRepositoryBlob ? (path, signal) => client.readRepositoryBlob!(legacyPath(path), signal) : undefined,
    writeNew: (path, chunks, signal) => write(path, chunks, false, signal),
    replaceViewSlot: (path, chunks, signal) => write(path, chunks, true, signal),
    async publishCommit(path, bytes, previous, expectedOwner, signal) { if (owner !== expectedOwner) throw new RepositoryError('ownership', 'Commit owner mismatch'); await write(path, (async function* () { yield bytes; })(), false, signal, previous); },
    async removeUnpublished(path) { if (!/^\.masterselects\/(artifacts|artifact-manifests)\//.test(path)) throw new RepositoryError('permission', 'Published segments, commits and source originals cannot be removed'); await queue; if (!owner) throw new RepositoryError('ownership', 'Native repository is read-only'); await owner.assertOwned(); await rpc({ action: 'remove', path, lease }); },
  };
}
