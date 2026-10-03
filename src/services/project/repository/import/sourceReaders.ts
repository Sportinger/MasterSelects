import { RepositoryError } from '../contracts';
import type { ReadOnlyProjectSource } from './legacySource';
import { safePath } from '../archive/streamIO';

/** Repository storage of an in-place conversion; never part of the legacy source. */
const REPOSITORY_FOLDER = '.masterselects';
/**
 * These readers never request write permission, create folders, or use active project state.
 * A listing from the first page walks the folder once and later pages read that sorted snapshot,
 * so old projects with tens of thousands of proxy frames list in one pass instead of one per page.
 */
export function directorySource(root: FileSystemDirectoryHandle, sourceId: string, locationId: string): ReadOnlyProjectSource {
  const snapshots = new Map<string, string[]>();
  async function walk(prefix: string, signal?: AbortSignal): Promise<string[]> {
    const paths: string[] = [];
    async function visit(directory: FileSystemDirectoryHandle, base: string): Promise<void> {
      for await (const [name, handle] of (directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
        signal?.throwIfAborted(); const path = base + name;
        if (handle.kind === 'directory') {
          if (base || name !== REPOSITORY_FOLDER) await visit(handle as FileSystemDirectoryHandle, path + '/');
        } else if (path.startsWith(prefix)) paths.push(path);
      }
    }
    await visit(root, ''); return paths.toSorted();
  }
  async function file(path: string): Promise<File | null> {
    const parts = safePath(path).split('/'); let directory = root;
    try {
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      return await (await directory.getFileHandle(parts[parts.length - 1])).getFile();
    } catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error; }
  }
  return {
    sourceId, locationId,
    async stat(path) { const value = await file(path); return value ? { length: value.size } : null; },
    async read(path, offset = 0, length, signal) {
      signal?.throwIfAborted(); const value = await file(path);
      if (!value) throw new RepositoryError('io', `Missing legacy source file: ${path}`);
      return new Uint8Array(await value.slice(offset, length === undefined ? undefined : offset + length).arrayBuffer());
    },
    async list(prefix, cursor, limit = 128, signal) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024) throw new RepositoryError('budget', 'Invalid source page size');
      // A first page always walks afresh, so each complete listing still observes source changes.
      let all = cursor ? snapshots.get(prefix) : undefined;
      if (!all) { all = await walk(prefix, signal); snapshots.set(prefix, all); }
      let start = 0;
      if (cursor) { let high = all.length; while (start < high) { const middle = (start + high) >> 1; if (all[middle] <= cursor) start = middle + 1; else high = middle; } }
      const paths = all.slice(start, start + limit); const more = start + limit < all.length;
      if (!more) snapshots.delete(prefix);
      return { paths, nextCursor: more ? paths[paths.length - 1] : null };
    },
  };
}

export interface NativeSourceReader {
  stat(path: string): Promise<{ length: number } | null>;
  read(path: string, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  list(root: string, prefix: string, cursor: string | undefined, limit: number, signal?: AbortSignal): Promise<{ paths: string[]; nextCursor: string | null }>;
}
export function nativeSource(root: string, sourceId: string, reader: NativeSourceReader): ReadOnlyProjectSource {
  const normalized = root.replaceAll('\\', '/').replace(/\/$/, '');
  const path = (relative: string) => normalized + '/' + safePath(relative);
  return { sourceId, locationId: 'native:' + normalized,
    stat: relative => reader.stat(path(relative)),
    async read(relative, offset = 0, length, signal) {
      const size = await reader.stat(path(relative)); if (!size) throw new RepositoryError('io', 'Missing native legacy source');
      return reader.read(path(relative), offset, length ?? size.length - offset, signal);
    },
    list: (prefix, cursor, limit = 128, signal) => reader.list(normalized, prefix, cursor, limit, signal),
  };
}
