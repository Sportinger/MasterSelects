import { RepositoryError } from '../contracts';
import type { ReadOnlyProjectSource } from './legacySource';
import { safePath } from '../archive/streamIO';

/** These readers never request write permission, create folders, or use active project state. */
export function directorySource(root: FileSystemDirectoryHandle, sourceId: string, locationId: string): ReadOnlyProjectSource {
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
      let selected: string[] = [];
      async function walk(directory: FileSystemDirectoryHandle, base: string): Promise<void> {
        for await (const [name, handle] of (directory as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
          signal?.throwIfAborted(); const path = base + name;
          if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, path + '/');
          else if (path.startsWith(prefix) && (!cursor || path > cursor)) {
            selected.push(path); selected = selected.toSorted(); if (selected.length > limit + 1) selected.pop();
          }
        }
      }
      await walk(root, ''); const more = selected.length > limit; const paths = selected.slice(0, limit);
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
