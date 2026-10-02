import type { CommitReference, RepositoryBackend, RepositoryDescriptor } from '../contracts';
import { RepositoryError } from '../contracts';
import { readCommit, commitPath } from '../persistence/publication';
import { readJson } from './streamIO';
import type { WorkspaceSelection } from './archiveManifest';

export interface CompletedBackup { prefix: string; commit: CommitReference; workspace: WorkspaceSelection[]; }
/** Completion receipts, not partially mirrored newer commits, define restore points. */
export async function findCompletedBackup(backend: RepositoryBackend, descriptor: RepositoryDescriptor): Promise<CompletedBackup | null> {
  let cursor: string | undefined; let chosen: CompletedBackup | null = null; let sequence = -1;
  do {
    const page = await backend.list('.masterselects/transport/backup-', cursor, 128);
    for (const path of page.paths) {
      if (!/^\.masterselects\/transport\/backup-[^/]+\/complete\.json$/.test(path)) continue;
      const receipt = await readJson<{ format: string; formatVersion: number; repositoryId: string; commit: CommitReference; workspace: WorkspaceSelection[] }>(backend, path, 1024 * 1024);
      if (receipt.format !== 'masterselects-backup' || receipt.formatVersion !== 1 || receipt.repositoryId !== descriptor.repositoryId) throw new RepositoryError('corrupt', 'Invalid backup completion provenance');
      const confirmed = await readCommit(backend, commitPath(receipt.commit.commitId));
      if (confirmed.reference.hash !== receipt.commit.hash) throw new RepositoryError('corrupt', 'Backup completion hash differs from its commit');
      if (confirmed.commit.lastOperation >= sequence) {
        if (chosen && confirmed.commit.lastOperation === sequence && chosen.commit.hash !== receipt.commit.hash) throw new RepositoryError('conflict', 'Conflicting backup completion points');
        sequence = confirmed.commit.lastOperation;
        chosen = { prefix: path.slice(0, -'/complete.json'.length), commit: receipt.commit, workspace: receipt.workspace };
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return chosen;
}
/** Only workspace reads redirect; immutable record reads retain the pinned backup repository. */
export function completedBackupSource(backend: RepositoryBackend, completion: CompletedBackup): RepositoryBackend {
  const pathFor = (path: string) => path.startsWith('.masterselects/views/') ? `${completion.prefix}/views/${path}` : path;
  return { locationId: backend.locationId, capabilities: backend.capabilities,
    acquireOwner: (id, signal) => backend.acquireOwner(id, signal),
    list: (prefix, cursor, limit, signal) => backend.list(prefix, cursor, limit, signal),
    stat: path => backend.stat(pathFor(path)),
    read: (path, offset, length, signal) => backend.read(pathFor(path), offset, length, signal),
    writeNew: (path, chunks, signal) => backend.writeNew(path, chunks, signal),
    replaceViewSlot: (path, chunks, signal) => backend.replaceViewSlot(path, chunks, signal),
    removeUnpublished: path => backend.removeUnpublished(path),
  };
}
