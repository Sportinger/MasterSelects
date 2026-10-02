import { RepositoryError, type CommitReference, type RepositoryBackend, type RepositoryDescriptor, type RepositoryOwner } from '../contracts';
import { segmentRecords, segmentPath } from '../segments/recordSegment';
import { blobPath, storeBlob } from '../persistence/blobStorage';
import { commitPath, readCommit } from '../persistence/publication';
import { recoverRepository } from '../persistence/recovery';
import { pinnedCommits } from './selectiveArchive';
import { copyImmutable, readJson, writeJson } from './streamIO';
import { freezeViews } from './frozenViews';
import type { ArchiveOptions, WorkspaceSelection } from './archiveManifest';

export interface BackupOptions { views: WorkspaceSelection[]; media?: 'linked' | 'self-contained'; resolveSources?: ArchiveOptions['resolveSources']; signal?: AbortSignal; }
/** Every backup commit is published after its dependencies; target is independently recoverable. */
export async function backupRepository(source: RepositoryBackend, descriptor: RepositoryDescriptor, pin: CommitReference, target: RepositoryBackend, owner: RepositoryOwner, options: BackupOptions): Promise<CommitReference> {
  if (source.locationId === target.locationId) throw new RepositoryError('conflict', 'Backup requires an independent target');
  await owner.assertOwned();
  const existingDescriptor = await target.stat('project.msrepo.json') ? await readJson<RepositoryDescriptor>(target, 'project.msrepo.json', 4096, options.signal) : null;
  if (existingDescriptor && (existingDescriptor.repositoryId !== descriptor.repositoryId || existingDescriptor.lineageId !== descriptor.lineageId)) throw new RepositoryError('conflict', 'Backup target belongs to another repository');
  await writeJson(target, 'project.msrepo.json', descriptor, options.signal);
  const prefix = `.masterselects/transport/backup-${crypto.randomUUID()}`;
  // Freeze chosen source slots now, preserving the last successful backup until completion.
  for (const view of options.views) {
    const temporary = snapshotBackend(target, `${prefix}/views`);
    await freezeViews(source, temporary, descriptor.repositoryId, descriptor.repositoryId, [view], options.signal);
  }
  if (options.media === 'self-contained' && !options.resolveSources) throw new RepositoryError('unsupported', 'Independent media backup requires an explicit source resolver');
  let sourceCount = 0;
  let count = 0;
  for await (const commit of pinnedCommits(source, pin, options.signal)) await writeJson(target, `${prefix}/commits/${count++}.json`, { commitId: commit.commitId }, options.signal);
  let expectedPrevious: CommitReference | null = null;
  for (let i = count - 1; i >= 0; i--) {
    await owner.assertOwned();
    const id = await readJson<{ commitId: string }>(target, `${prefix}/commits/${i}.json`, 4096, options.signal);
    const item = await readCommit(source, commitPath(id.commitId), options.signal);
    for (const segment of item.commit.segments) {
      await copyImmutable(source, target, segmentPath(segment.segmentId), segment, options.signal);
      for await (const entry of segmentRecords(source, segment, options.signal)) {
        for (const blob of entry.record.blobs) await copyImmutable(source, target, blobPath(blob.hash), blob, options.signal);
        if (options.media === 'self-contained' && entry.record.kind === 'object') for await (const external of options.resolveSources!(entry.record)) {
          await storeBlob(target, owner, external.identity, external.chunks, options.signal);
          const path = `.masterselects/backup-sources/${external.identity.hash.slice(7)}/${encodeURIComponent(external.sourceId)}.json`;
          await writeJson(target, path, { sourceId: external.sourceId, identity: external.identity }, options.signal); sourceCount++;
        }
      }
    }
    const path = commitPath(item.commit.commitId);
    if (!await target.stat(path)) {
      const stat = await source.stat(path); if (!stat) throw new RepositoryError('corrupt', 'Backup commit disappeared');
      const bytes = await source.read(path, 0, stat.length, options.signal);
      if (target.publishCommit) await target.publishCommit(path, bytes, expectedPrevious, owner, options.signal);
      else await copyImmutable(source, target, path, { hash: item.reference.hash, length: stat.length }, options.signal);
    }
    const copied = await readCommit(target, path, options.signal);
    if (copied.reference.hash !== item.reference.hash) throw new RepositoryError('corrupt', 'Backup manifest differs from pinned source');
    expectedPrevious = item.reference;
  }
  const recovered = await recoverRepository(target, descriptor, options.signal);
  if (recovered.head?.hash !== pin.hash) throw new RepositoryError('conflict', 'Backup target has a conflicting or newer head');
  for (const view of options.views) {
    const path = `.masterselects/views/${encodeURIComponent(view.workspaceId)}/${encodeURIComponent(view.viewKey)}/a.json`;
    const snapshot = `${prefix}/views/${path}`;
    const record = await readJson(target, snapshot, 1024 * 1024, options.signal);
    // View replacement is intentionally restricted to the two legal slots.
    const encoded = new TextEncoder().encode(JSON.stringify(record));
    await target.replaceViewSlot(path, (async function* () { yield encoded; })(), options.signal);
    await target.replaceViewSlot(path.replace(/a\.json$/, 'b.json'), (async function* () { yield encoded; })(), options.signal);
  }
  await writeJson(target, `${prefix}/complete.json`, { format: 'masterselects-backup', formatVersion: 1, repositoryId: descriptor.repositoryId, commit: pin, workspace: options.views, media: options.media ?? 'linked', sourceCount }, options.signal);
  return pin;
}

function snapshotBackend(backend: RepositoryBackend, prefix: string): RepositoryBackend {
  return { locationId: backend.locationId, capabilities: backend.capabilities,
    acquireOwner: (id, signal) => backend.acquireOwner(id, signal),
    list: (path, cursor, limit, signal) => backend.list(`${prefix}/${path}`, cursor, limit, signal),
    replaceViewSlot: (path, chunks, signal) => backend.replaceViewSlot(`${prefix}/${path}`, chunks, signal),
    removeUnpublished: path => backend.removeUnpublished(`${prefix}/${path}`),
    stat: path => backend.stat(`${prefix}/${path}`),
    read: (path, offset, length, signal) => backend.read(`${prefix}/${path}`, offset, length, signal),
    writeNew: (path, chunks, signal) => backend.writeNew(`${prefix}/${path}`, chunks, signal),
  };
}
