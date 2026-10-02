import { StreamHash } from '../segments/streamHash';
import { RepositoryError } from '../contracts';

export type SourceIdentity =
  | { identityStatus: 'unverified'; fastFingerprint?: string; byteLength: number }
  | { identityStatus: 'verified'; algorithm: 'sha256'; contentHash: string; byteLength: number; fastFingerprint?: string };

/** Full original-byte identity; the legacy 2 MiB fingerprint stays a cache hint. */
export async function verifySourceIdentity(source: Blob, fastFingerprint?: string, signal?: AbortSignal): Promise<SourceIdentity> {
  const hash = new StreamHash();
  for (let offset = 0; offset < source.size; offset += 256 * 1024) {
    if (signal?.aborted) throw new RepositoryError('cancelled', 'Source verification cancelled');
    const bytes = new Uint8Array(await source.slice(offset, offset + 256 * 1024).arrayBuffer());
    hash.update(bytes);
  }
  return { identityStatus: 'verified', algorithm: 'sha256', contentHash: hash.digest(), byteLength: source.size,
    ...(fastFingerprint ? { fastFingerprint } : {}) };
}

export async function assertSourceIdentity(source: Blob, identity: SourceIdentity, signal?: AbortSignal): Promise<void> {
  if (identity.identityStatus !== 'verified') throw new RepositoryError('corrupt', 'Historical original bytes have not been verified');
  if (source.size !== identity.byteLength) throw new RepositoryError('corrupt', 'Historical original file size changed');
  const actual = await verifySourceIdentity(source, identity.fastFingerprint, signal);
  if (actual.identityStatus !== 'verified' || actual.contentHash !== identity.contentHash) throw new RepositoryError('corrupt', 'Historical original file content changed; relink as a new source version');
}
