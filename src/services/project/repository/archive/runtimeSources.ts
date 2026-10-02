import { useMediaStore } from '../../../../stores/mediaStore';
import type { RepositorySession } from '../RepositorySession';
import type { RepositoryRecord, EntityDTO, BlobReference } from '../contracts';
import { RepositoryError } from '../contracts';
import { assertSourceIdentity, type SourceIdentity } from '../domains/sourceIdentity';
import type { ArchiveSource } from './archiveManifest';

/** Pinned Files and complete digest matches can supply originals for historical exports. */
export function captureRuntimeArchiveSources(session: RepositorySession) {
  // Capture available byte handles once, then match selected immutable identities by full digest.
  const files = useMediaStore.getState().files.flatMap(media => media.file ? [media.file] : []);
  const originals = new Map<string, File>();
  async function* chunks(file: Blob) {
    for (let offset = 0; offset < file.size; offset += 256 * 1024) yield new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
  }
  return async function* resolve(record: RepositoryRecord): AsyncGenerator<ArchiveSource> {
    if (record.kind !== 'object') return;
    const entity = record.payload as unknown as EntityDTO;
    const value = entity.value && typeof entity.value === 'object' && !Array.isArray(entity.value) ? entity.value : {};
    let identity: SourceIdentity;
    if (entity.type === 'media-aggregate' && typeof value.id === 'string' && !value.liveInput) {
      identity = value.$sourceIdentity as unknown as SourceIdentity;
      if (!identity || identity.identityStatus !== 'verified') throw new RepositoryError('corrupt', `Original media ${value.id} has no complete historical byte identity`);
    } else if (entity.type === 'verified-source-identity' || entity.type === 'source-identity') identity = entity.value as unknown as SourceIdentity;
    else return;
    if (identity.identityStatus !== 'verified') throw new RepositoryError('corrupt', 'Required original has not been verified');
    const reference: BlobReference = { hash: identity.contentHash, length: identity.byteLength };
    if (record.blobs.some(blob => blob.hash === reference.hash && blob.length === reference.length)) return;
    const stored = await session.client.readBlob(reference);
    if (stored) {
      yield { sourceId: identity.contentHash, identity: reference, chunks: chunks(stored as File) }; return;
    }
    let file = originals.get(identity.contentHash);
    if (!file) for (const candidate of files) {
      if (candidate.size !== identity.byteLength) continue;
      try { await assertSourceIdentity(candidate, identity); file = candidate; originals.set(identity.contentHash, candidate); break; }
      catch (error) { if (error instanceof RepositoryError && error.code === 'corrupt') continue; throw error; }
    }
    if (!file) throw new RepositoryError('io', `Original source bytes ${identity.contentHash} are unavailable; choose linked export or reconnect the exact source version`);
    yield { sourceId: identity.contentHash, identity: reference, chunks: chunks(file) };
  };
}
