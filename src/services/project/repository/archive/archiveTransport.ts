import type { CommitReference, RepositoryBackend, RepositoryDescriptor, RepositoryOwner } from '../contracts';
import { RepositoryError } from '../contracts';
import { recoverRepository } from '../persistence/recovery';
import { prepareArchive, readArchiveManifest } from './selectiveArchive';
import { extractZip, writeZip, type ArchiveSink } from './streamZip';
import { readFileChunks, safePath } from './streamIO';
import { StreamHash } from '../segments/streamHash';
import { fileDigest } from './streamIO';
import type { ArchiveOptions, RepositoryArchiveManifest } from './archiveManifest';

const exportedPath = (path: string) => path === 'project.msrepo.json' || path === 'archive-manifest.json'
  || /^\.masterselects\/(segments|artifacts|commits|views)\//.test(path);

export async function exportRepositoryArchive(source: RepositoryBackend, descriptor: RepositoryDescriptor, pin: CommitReference,
  staging: RepositoryBackend, owner: RepositoryOwner, options: ArchiveOptions, sink: ArchiveSink): Promise<RepositoryArchiveManifest> {
  const manifest = await prepareArchive(source, descriptor, pin, staging, owner, options);
  async function* entries() {
    let cursor: string | undefined;
    do {
      const page = await staging.list('', cursor, 128, options.signal);
      for (const path of page.paths) if (exportedPath(path)) yield { path, chunks: readFileChunks(staging, path, options.signal) };
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  await writeZip(entries(), sink, options.signal); return manifest;
}

/** ZIP restore consumes only authoritative archive paths and verifies the complete dependency closure. */
export async function restoreRepositoryArchive(chunks: AsyncIterable<Uint8Array>, staging: RepositoryBackend,
  owner: RepositoryOwner, signal?: AbortSignal): Promise<RepositoryArchiveManifest> {
  await owner.assertOwned();
  await extractZip(chunks, async entry => {
    const path = safePath(entry.path);
    if (!exportedPath(path)) throw new RepositoryError('corrupt', `Unexpected repository archive entry: ${path}`);
    const previous = await staging.stat(path);
    if (previous) {
      const hash = new StreamHash(); let length = 0;
      for await (const chunk of entry.chunks) { hash.update(chunk); length += chunk.length; }
      const existing = await fileDigest(staging, path, signal);
      if (existing.hash !== hash.digest() || existing.length !== length) throw new RepositoryError('conflict', 'Resumed archive restore belongs to different source bytes');
    } else await staging.writeNew(path, entry.chunks, signal);
  }, signal);
  const manifest = await readArchiveManifest(staging, signal);
  const recovery = await recoverRepository(staging, manifest.repository, signal);
  if (recovery.head?.hash !== manifest.targetCommit.hash || recovery.head.commitId !== manifest.targetCommit.commitId)
    throw new RepositoryError('corrupt', 'Archive did not restore its declared commit');
  return manifest;
}

export async function duplicateRepository(source: RepositoryBackend, descriptor: RepositoryDescriptor, pin: CommitReference,
  target: RepositoryBackend, owner: RepositoryOwner, options: Omit<ArchiveOptions, 'targetRepositoryId'>): Promise<RepositoryArchiveManifest> {
  return prepareArchive(source, descriptor, pin, target, owner, { ...options, targetRepositoryId: crypto.randomUUID() });
}
