import { RepositoryError, type RepositoryBackend } from '../contracts';
import { StreamHash } from '../segments/streamHash';
import { canonicalBytes, hashBytes, parseJson } from '../segments/canonical';

export const TRANSPORT_LIMITS = { chunkBytes: 256 * 1024, jsonBytes: 32 * 1024 * 1024, zipOutputBytes: 8 * 1024 * 1024, zipEntries: 100000 } as const;
export function safePath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '.' || part === '..') || /^[a-z]:/i.test(normalized) || /[\x00-\x1f]/.test(normalized)) throw new RepositoryError('corrupt', 'Unsafe transport path');
  return normalized;
}
export async function* readFileChunks(backend: Pick<RepositoryBackend, 'read' | 'stat'>, path: string, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const stat = await backend.stat(path);
  if (!stat) throw new RepositoryError('io', `Missing transport file: ${path}`);
  for (let offset = 0; offset < stat.length; offset += TRANSPORT_LIMITS.chunkBytes) {
    if (signal?.aborted) throw new RepositoryError('cancelled', 'Transport cancelled');
    const length = Math.min(TRANSPORT_LIMITS.chunkBytes, stat.length - offset);
    const bytes = await backend.read(path, offset, length, signal);
    if (bytes.length !== length) throw new RepositoryError('corrupt', 'Transport source truncated during read');
    yield bytes;
  }
  if ((await backend.stat(path))?.length !== stat.length) throw new RepositoryError('conflict', 'Transport source changed during read');
}
export async function fileDigest(backend: Pick<RepositoryBackend, 'read' | 'stat'>, path: string, signal?: AbortSignal): Promise<{ hash: string; length: number }> {
  const hash = new StreamHash(); let length = 0;
  for await (const chunk of readFileChunks(backend, path, signal)) { hash.update(chunk); length += chunk.length; }
  return { hash: hash.digest(), length };
}
export async function copyImmutable(source: RepositoryBackend, target: RepositoryBackend, path: string, expected?: { hash: string; length: number }, signal?: AbortSignal): Promise<void> {
  const identity = expected ?? await fileDigest(source, path, signal);
  const existing = await target.stat(path);
  if (!existing) {
    const hash = new StreamHash(); let length = 0;
    async function* chunks() {
      for await (const chunk of readFileChunks(source, path, signal)) { hash.update(chunk); length += chunk.length; yield chunk; }
      if (length !== identity.length || hash.digest() !== identity.hash) throw new RepositoryError('conflict', 'Source changed while copying');
    }
    try { await target.writeNew(path, chunks(), signal); }
    catch (error) { if (!await target.stat(path)) throw error; }
  }
  const actual = await fileDigest(target, path, signal);
  if (actual.hash !== identity.hash || actual.length !== identity.length) throw new RepositoryError('corrupt', `Immutable copy conflict: ${path}`);
}
export async function writeJson(backend: RepositoryBackend, path: string, value: unknown, signal?: AbortSignal): Promise<void> {
  const bytes = canonicalBytes(value);
  if (bytes.length > TRANSPORT_LIMITS.jsonBytes) throw new RepositoryError('budget', 'Transport JSON budget exceeded');
  async function* chunks() { yield bytes; }
  if (!await backend.stat(path)) await backend.writeNew(path, chunks(), signal);
  const actual = await backend.read(path, 0, bytes.length, signal);
  if ((await backend.stat(path))?.length !== bytes.length || await hashBytes(actual) !== await hashBytes(bytes)) throw new RepositoryError('conflict', 'Transport journal identity conflict');
}
export async function readJson<T>(backend: Pick<RepositoryBackend, 'stat' | 'read'>, path: string, budget = TRANSPORT_LIMITS.jsonBytes, signal?: AbortSignal): Promise<T> {
  const stat = await backend.stat(path);
  if (!stat || stat.length > budget) throw new RepositoryError(stat ? 'budget' : 'io', `Cannot read budgeted JSON: ${path}`);
  const bytes = new Uint8Array(stat.length);
  for (let offset = 0; offset < stat.length; offset += TRANSPORT_LIMITS.chunkBytes) {
    const length = Math.min(TRANSPORT_LIMITS.chunkBytes, stat.length - offset);
    const part = await backend.read(path, offset, length, signal);
    if (part.length !== length) throw new RepositoryError('corrupt', 'Truncated transport JSON');
    bytes.set(part, offset);
  }
  return parseJson<T>(bytes);
}
