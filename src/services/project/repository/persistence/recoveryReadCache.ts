import { REPOSITORY_LIMITS, type RepositoryBackend } from '../contracts';

/** Recovery-scoped immutable reads; media bytes are never retained here. */
export function recoveryReadCache(backend: RepositoryBackend): RepositoryBackend {
  const bytes = new Map<string, Uint8Array>();
  const stats = new Map<string, { length: number }>();
  const pages = new Map<string, { paths: string[]; nextCursor: string | null }>();
  let retained = 0;
  const limitFor = (path: string): number => path.startsWith('.masterselects/commits/') && path.endsWith('.json')
    ? REPOSITORY_LIMITS.recordBytes : path.startsWith('.masterselects/segments/') && path.endsWith('.msseg') ? REPOSITORY_LIMITS.segmentBytes : 0;
  const stat = async (path: string) => {
    const known = stats.get(path);
    if (known) return known;
    const value = await backend.stat(path);
    if (value && limitFor(path) && value.length <= limitFor(path)) {
      stats.set(path, value);
      if (stats.size > 2048) stats.delete(stats.keys().next().value!);
    }
    return value;
  };
  const read: RepositoryBackend['read'] = async (path, offset = 0, length, signal) => {
    signal?.throwIfAborted();
    const limit = limitFor(path);
    if (!limit) return backend.read(path, offset, length, signal);
    let value = bytes.get(path);
    if (!value) {
      const info = await stat(path);
      if (!info || info.length > limit) return backend.read(path, offset, length, signal);
      value = await backend.read(path, 0, info.length, signal);
      if (value.length !== info.length) return backend.read(path, offset, length, signal);
      bytes.set(path, value); retained += value.length;
      while (retained > REPOSITORY_LIMITS.objectCacheBytes) {
        const oldest = bytes.keys().next().value!;
        retained -= bytes.get(oldest)!.length; bytes.delete(oldest);
      }
    } else { bytes.delete(path); bytes.set(path, value); }
    signal?.throwIfAborted();
    return value.slice(offset, length === undefined ? undefined : offset + length);
  };
  const list: RepositoryBackend['list'] = async (prefix, cursor, limit, signal) => {
    signal?.throwIfAborted();
    if (prefix !== '.masterselects/commits/') return backend.list(prefix, cursor, limit, signal);
    const key = `${cursor ?? ''}:${limit ?? ''}`;
    const known = pages.get(key);
    if (known) return { paths: [...known.paths], nextCursor: known.nextCursor };
    const page = await backend.list(prefix, cursor, limit, signal);
    pages.set(key, { paths: [...page.paths], nextCursor: page.nextCursor });
    if (pages.size > 32) pages.delete(pages.keys().next().value!);
    return page;
  };
  return new Proxy(backend, { get(target, property) {
    if (property === 'read') return read;
    if (property === 'stat') return stat;
    if (property === 'list') return list;
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
