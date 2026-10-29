// Which project media copies the project storage worker wrote in this session. A media copy used to
// re-read and re-hash the same blob up to four times right after writing it (after the write, when its
// manifest was saved, when the copy was opened as a file, when the import switched to it); on a phone that
// was most of an 8 s import. A media copy this worker wrote (hash checked on the exact bytes written, length
// confirmed on disk) is afterwards only checked for presence and length.
// Scope: only blobs passed to remember() (blob-store-file with confirm 'length', i.e. Raw media copies).
// Every other blob, proxies, thumbnails, transcripts and blobs of desktop folder projects included, is
// fully verified on every check as before. Deliberate trade-off for media copies, same as the directory
// backend's for segments: byte-level damage after the write is caught by the next session's full check.
import { RepositoryError, type BlobReference, type RepositoryBackend } from '../contracts';
import { blobPath } from './blobStorage';

type FullVerify = (backend: RepositoryBackend, reference: BlobReference, signal?: AbortSignal) => Promise<void>;

/** Bounded so a long session with many artifacts does not grow it without limit. */
const MAX_REMEMBERED = 4096;

export interface SessionBlobVerification {
  verify(backend: RepositoryBackend, reference: BlobReference, signal?: AbortSignal): Promise<void>;
  remember(backend: RepositoryBackend, reference: BlobReference): void;
  /** True when `reference` is a remembered media copy of `backend` (tests and diagnostics). */
  isProven(reference: BlobReference, backend: RepositoryBackend): boolean;
}

const key = (reference: BlobReference) => `${reference.hash}:${reference.length}`;

export function createSessionBlobVerification(fullVerify: FullVerify): SessionBlobVerification {
  const proven = new WeakMap<RepositoryBackend, Set<string>>();
  const setFor = (backend: RepositoryBackend) => {
    let set = proven.get(backend);
    if (!set) { set = new Set(); proven.set(backend, set); }
    return set;
  };
  const add = (backend: RepositoryBackend, reference: BlobReference) => {
    const set = setFor(backend);
    set.add(key(reference));
    if (set.size > MAX_REMEMBERED) set.delete(set.values().next().value!);
  };
  return {
    async verify(backend, reference, signal) {
      if (proven.get(backend)?.has(key(reference))) {
        const stat = await backend.stat(blobPath(reference.hash));
        if (stat && stat.length === reference.length) return;
        proven.get(backend)?.delete(key(reference));
        throw new RepositoryError('corrupt', 'Missing or truncated blob');
      }
      await fullVerify(backend, reference, signal);
    },
    remember(backend, reference) {
      add(backend, reference);
    },
    isProven(reference, backend) {
      return proven.get(backend)?.has(key(reference)) ?? false;
    },
  };
}
