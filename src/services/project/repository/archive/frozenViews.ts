import { REPOSITORY_LIMITS, RepositoryError, type JsonValue, type RepositoryBackend } from '../contracts';
import { canonicalBytes, hashBytes } from '../segments/canonical';
import { oneChunk } from '../persistence/publication';
import { readJson } from './streamIO';
import type { WorkspaceSelection } from './archiveManifest';

interface Slot { format: 'masterselects-view'; schemaVersion: 1; repositoryId: string; workspaceId: string; viewKey: string; sequence: number; value: JsonValue; checksum: string; }
export async function freezeViews(source: RepositoryBackend, target: RepositoryBackend, sourceRepositoryId: string, targetRepositoryId: string, selection: WorkspaceSelection[], signal?: AbortSignal): Promise<void> {
  for (const view of selection) {
    const base = `.masterselects/views/${encodeURIComponent(view.workspaceId)}/${encodeURIComponent(view.viewKey)}/`;
    let latest: Slot | null = null;
    for (const slot of ['a', 'b']) {
      try {
        const record = await readJson<Slot>(source, `${base}${slot}.json`, REPOSITORY_LIMITS.recordBytes, signal);
        const { checksum, ...body } = record;
        if (record.format !== 'masterselects-view' || record.schemaVersion !== 1 || record.repositoryId !== sourceRepositoryId || record.workspaceId !== view.workspaceId || record.viewKey !== view.viewKey || !Number.isSafeInteger(record.sequence) || record.sequence < 0 || await hashBytes(canonicalBytes(body)) !== checksum) continue;
        if (latest && latest.sequence === record.sequence && latest.checksum !== checksum) throw new RepositoryError('conflict', 'Conflicting confirmed workspace slots');
        if (!latest || record.sequence > latest.sequence) latest = record;
      } catch (error) { if (error instanceof RepositoryError && error.code === 'conflict' || signal?.aborted) throw error; }
    }
    if (!latest) throw new RepositoryError('corrupt', `No confirmed workspace slot for ${view.viewKey}`);
    const { checksum: _checksum, ...body } = latest;
    const rewritten = { ...body, repositoryId: targetRepositoryId };
    const bytes = canonicalBytes({ ...rewritten, checksum: await hashBytes(canonicalBytes(rewritten)) });
    await target.writeNew(`${base}a.json`, oneChunk(bytes), signal);
  }
}
