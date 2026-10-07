import { Logger } from '../../../logger';
import type { RepositoryBackend, RepositoryDescriptor, RepositoryMetadataIndex, RepositoryOwner, SegmentDescriptor } from '../contracts';
import { canonicalBytes, hashBytes } from '../segments/canonical';
import { commitPath, readCommit } from './publication';
import type { RecoveryProofs, RecoveryResult } from './recovery';

const log = Logger.create('RepositoryStartupCache');
const LIMIT = 16 * 1024 * 1024;
const FILE_LIMIT = 50000;
export const startupCachePath = (slot: 'a' | 'b') => `.masterselects/cache/startup/${slot}.json`;
type Version = [path: string, length: number, modifiedTime: number];
interface Snapshot {
  version: 1; repositoryId: string; locationId: string;
  recovery: RecoveryResult; files: Version[]; segments: SegmentDescriptor[]; blobs: string[];
}
export interface StartupSeed { recovery: RecoveryResult; proofs: RecoveryProofs; knownCommits: Set<string> }
const marker = (slot: 'a' | 'b') => `startup-cache-v1:${slot}`;
async function readBytes(backend: RepositoryBackend, path: string, length: number, signal?: AbortSignal): Promise<Uint8Array> {
  const bytes = new Uint8Array(length);
  for (let at = 0; at < length; at += 256 * 1024) {
    const count = Math.min(256 * 1024, length - at), chunk = await backend.read(path, at, count, signal);
    if (chunk.length !== count) throw new Error('Truncated startup cache');
    bytes.set(chunk, at);
  }
  return bytes;
}
async function paths(backend: RepositoryBackend, prefix: string, signal?: AbortSignal): Promise<string[]> {
  const result: string[] = []; let cursor: string | undefined;
  do {
    const page = await backend.list(prefix, cursor, 256, signal); result.push(...page.paths);
    if (result.length > FILE_LIMIT) throw new Error('Startup cache file budget exceeded');
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return result;
}
async function parallel<T>(items: T[], visit: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
    while (next < items.length) await visit(items[next++]);
  }));
}
/** A browser-local attestation of a compact disk snapshot, never an alternative project authority.
 * Immutable history file size/mtime must still match; current records retain SHA-256 checks on read.
 * A changed/missing file, lost local attestation, or an older-history fork falls back to full recovery.
 */
export async function readStartupCache(backend: RepositoryBackend, descriptor: RepositoryDescriptor,
  index: RepositoryMetadataIndex, signal?: AbortSignal): Promise<StartupSeed | null> {
  const candidates: Snapshot[] = [];
  for (const slot of ['a', 'b'] as const) {
    try {
      const proof = await index.getMetadata(marker(slot));
      if (!proof || typeof proof !== 'object' || Array.isArray(proof) || typeof proof.hash !== 'string') continue;
      const path = startupCachePath(slot), info = await backend.stat(path);
      if (!info || info.length > LIMIT) continue;
      const bytes = await readBytes(backend, path, info.length, signal);
      if (await hashBytes(bytes) !== proof.hash) continue;
      const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
      if (snapshot.version !== 1 || snapshot.repositoryId !== descriptor.repositoryId || snapshot.locationId !== backend.locationId
        || !snapshot.recovery.head || !Array.isArray(snapshot.files) || snapshot.files.length > FILE_LIMIT) continue;
      candidates.push(snapshot);
    } catch (error) { if (signal?.aborted) throw error; }
  }
  for (const snapshot of candidates.toSorted((a,b) => b.recovery.operationSequence - a.recovery.operationSequence)) {
    try {
      await parallel(snapshot.files, async ([path,length,modifiedTime]) => {
        signal?.throwIfAborted(); const current = await backend.stat(path);
        if (!current || current.length !== length || current.modifiedTime !== modifiedTime) throw new Error('History file changed');
      });
      const knownCommits = new Set(snapshot.files.map(file => file[0]).filter(path => path.startsWith('.masterselects/commits/')));
      const current = await paths(backend, '.masterselects/commits/', signal);
      const head = snapshot.recovery.head!;
      const pinned = await readCommit(backend, commitPath(head.commitId), signal);
      if (pinned.reference.hash !== head.hash) continue;
      const additions = current.filter(path => !knownCommits.has(path));
      const knownIds = new Set([...knownCommits].map(path => path.slice(path.lastIndexOf('/') + 1, -5)));
      // A new descendant is recoverable from the seed. A fork at older ancestry needs full recovery.
      for (const path of additions) {
        const extra = await readCommit(backend, path, signal), previous = extra.commit.previous;
        if (!previous || knownIds.has(previous.commitId) && (previous.commitId !== head.commitId || previous.hash !== head.hash)) throw new Error('History fork requires full recovery');
      }
      log.info('Using saved startup cache', { operationSequence: snapshot.recovery.operationSequence, newPublications: additions.length });
      return { recovery: snapshot.recovery, knownCommits, proofs: {
        segments: new Map(snapshot.segments.map(segment => [segment.segmentId, segment])), blobs: new Set(snapshot.blobs), records: new Set(),
      } };
    } catch (error) { if (signal?.aborted) throw error; log.debug('Startup cache no longer matches; validating complete history', error); }
  }
  return null;
}

/** Caller serializes this with publications, so files and the confirmed head describe one instant. */
export async function writeStartupCache(backend: RepositoryBackend, descriptor: RepositoryDescriptor, owner: RepositoryOwner,
  index: RepositoryMetadataIndex, recovery: RecoveryResult, proofs: RecoveryProofs, signal?: AbortSignal): Promise<boolean> {
  if (!recovery.head) return false;
  await owner.assertOwned();
  const headInfo = await backend.stat(commitPath(recovery.head.commitId));
  // Backends without modification identities use the full recovery path.
  if (!headInfo || !Number.isFinite(headInfo.modifiedTime)) return false;
  const files: Version[] = [];
  for (const prefix of ['.masterselects/commits/', '.masterselects/segments/', '.masterselects/artifacts/']) {
    const names = await paths(backend, prefix, signal);
    await parallel(names, async path => {
      signal?.throwIfAborted(); const info = await backend.stat(path);
      if (!info || !Number.isFinite(info.modifiedTime)) throw new Error('Missing immutable file identity');
      files.push([path, info.length, info.modifiedTime!]);
    });
  }
  if (files.length > FILE_LIMIT) return false;
  const snapshot: Snapshot = { version: 1, repositoryId: descriptor.repositoryId, locationId: backend.locationId,
    recovery, files: files.toSorted((a,b) => a[0].localeCompare(b[0])), segments: [...proofs.segments.values()], blobs: [...proofs.blobs] };
  const bytes = canonicalBytes(snapshot); if (bytes.length > LIMIT) return false;
  const slots = await Promise.all((['a','b'] as const).map(async slot => ({ slot, proof: await index.getMetadata(marker(slot)) })));
  const sequence = (p: typeof slots[number]['proof']) => p && typeof p === 'object' && !Array.isArray(p) && typeof p.sequence === 'number' ? p.sequence : -1;
  const slot = sequence(slots[0].proof) <= sequence(slots[1].proof) ? 'a' : 'b';
  await owner.assertOwned();
  await backend.replaceViewSlot(startupCachePath(slot), (async function* () { yield bytes; })(), signal);
  const stored = await readBytes(backend, startupCachePath(slot), bytes.length, signal), hash = await hashBytes(bytes);
  if (stored.length !== bytes.length || await hashBytes(stored) !== hash) throw new Error('Startup cache write did not complete');
  // Written last. A cache copied from another folder/browser or edited on disk has no matching local proof.
  await index.putMetadata(marker(slot), { hash, sequence: recovery.operationSequence });
  log.info('Saved startup cache', { bytes: bytes.length, operationSequence: recovery.operationSequence });
  return true;
}
