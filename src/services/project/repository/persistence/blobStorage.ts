import { RepositoryError, type BlobReference, type RepositoryBackend, type RepositoryOwner } from '../contracts';
import { StreamHash } from '../segments/streamHash';
import { hashBytes } from '../segments/canonical';

/** Artifacts and package entries are small: native SHA-256 is ~40x faster than the bounded stream hash. */
const NATIVE_HASH_BYTES = 64 * 1024 * 1024;

export function blobPath(hash: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw new RepositoryError('corrupt', 'Invalid blob hash');
  return `.masterselects/artifacts/${hash.slice(7)}.blob`;
}
export async function verifyBlob(backend: RepositoryBackend, reference: BlobReference, signal?: AbortSignal): Promise<void> {
  const stat = await backend.stat(blobPath(reference.hash));
  if (!stat || stat.length !== reference.length) throw new RepositoryError('corrupt', 'Missing or truncated blob');
  const small = reference.length <= NATIVE_HASH_BYTES;
  const hash = small ? null : new StreamHash(); const whole = small ? new Uint8Array(reference.length) : null;
  for (let offset = 0; offset < reference.length; offset += 256 * 1024) {
    const length = Math.min(256 * 1024, reference.length - offset);
    const bytes = await backend.read(blobPath(reference.hash), offset, length, signal);
    if (bytes.length !== length) throw new RepositoryError('corrupt', 'Truncated blob range');
    if (whole) whole.set(bytes, offset); else hash!.update(bytes);
  }
  if ((whole ? await hashBytes(whole) : hash!.digest()) !== reference.hash) throw new RepositoryError('corrupt', 'Blob content hash mismatch');
}
export async function storeBlob(backend: RepositoryBackend, owner: RepositoryOwner, reference: BlobReference, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void> {
  await owner.assertOwned();
  if (!Number.isSafeInteger(reference.length) || reference.length < 0) throw new RepositoryError('corrupt', 'Invalid blob length');
  const path = blobPath(reference.hash);
  if (await backend.stat(path)) { await verifyBlob(backend, reference, signal); return; }
  if (reference.length <= NATIVE_HASH_BYTES) return storeSmallBlob(backend, owner, reference, chunks, signal);
  const hash = new StreamHash(); let length = 0;
  async function* verified(): AsyncGenerator<Uint8Array> {
    for await (const chunk of chunks) {
      await owner.assertOwned();
      if (signal?.aborted) throw new RepositoryError('cancelled', 'Blob write cancelled');
      length += chunk.length;
      if (length > reference.length) throw new RepositoryError('corrupt', 'Blob exceeds declared length');
      hash.update(chunk); yield chunk;
    }
    if (length !== reference.length || hash.digest() !== reference.hash) throw new RepositoryError('corrupt', 'Blob stream identity mismatch');
  }
  try { await backend.writeNew(path, verified(), signal); }
  catch (cause) {
    try { await verifyBlob(backend, reference, signal); return; }
    catch { throw cause; }
  }
  await verifyBlob(backend, reference, signal);
}

/** Small blobs are verified before any byte is written, then read back once as durability proof. */
async function storeSmallBlob(backend: RepositoryBackend, owner: RepositoryOwner, reference: BlobReference, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void> {
  const bytes = new Uint8Array(reference.length); let length = 0;
  for await (const chunk of chunks) {
    await owner.assertOwned();
    if (signal?.aborted) throw new RepositoryError('cancelled', 'Blob write cancelled');
    if (length + chunk.length > reference.length) throw new RepositoryError('corrupt', 'Blob exceeds declared length');
    bytes.set(chunk, length); length += chunk.length;
  }
  if (length !== reference.length || await hashBytes(bytes) !== reference.hash) throw new RepositoryError('corrupt', 'Blob stream identity mismatch');
  const path = blobPath(reference.hash);
  async function* single(): AsyncGenerator<Uint8Array> { for (let offset = 0; offset < bytes.length; offset += 256 * 1024) yield bytes.subarray(offset, offset + 256 * 1024); }
  try { await backend.writeNew(path, single(), signal); }
  catch (cause) {
    try { await verifyBlob(backend, reference, signal); return; }
    catch { throw cause; }
  }
  await verifyBlob(backend, reference, signal);
}
