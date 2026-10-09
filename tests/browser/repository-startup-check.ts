import { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import { newRepositoryDescriptor } from '../../src/services/project/repository/lifecycle/RepositoryLifecycle';
const result: Record<string, unknown> = {}, path = 'startup-check-' + crypto.randomUUID();
const options = { descriptor: newRepositoryDescriptor(), location: { kind: 'opfs' as const, path }, workspaceId: 'fixture',
  activation: { canActivate: () => true, activate: async () => {} } };
let session: RepositorySession | null = null;
try {
  session = await RepositorySession.open(options);
  const count = 120; let previous: string | null = null;
  for (let i = 1; i <= count; i++) {
    const revisionId = `r${i}`;
    await session.storage.publishRevision({ revisionId, transactionId: revisionId, parentRevisionId: previous,
      label: 'Fixture ' + i, source: 'test', createdAt: i,
      changes: [{ entityKey: 'value', before: i > 1 ? { type: 'fixture', schemaVersion: 1, value: { number: i - 1, payload: 'x'.repeat(32768) }, references: [], blobs: [] } : null,
        after: { type: 'fixture', schemaVersion: 1, value: { number: i, payload: 'x'.repeat(32768) }, references: [], blobs: [] } }] }, 'fixture', {}, i);
    previous = revisionId;
  }
  // Exercise the exact save boundary used by the editor, including the worker's cache write.
  const saveStart = performance.now(); await session.client.request({ type: 'view-flush', views: {} });
  const saveMs = performance.now() - saveStart;
  const root = await navigator.storage.getDirectory(), project = await root.getDirectoryHandle(path);
  const metadata = await project.getDirectoryHandle('.masterselects'), cache = await (await metadata.getDirectoryHandle('cache')).getDirectoryHandle('startup');
  const cacheBytes = (await (await cache.getFileHandle('a.json')).getFile()).size;
  await session.close(); const openStart = performance.now(); session = await RepositorySession.open(options);
  const openMs = performance.now() - openStart;
  if ((session.coordinator.getProjection().entities.get('value')?.value as { number: number }).number !== count) throw new Error('Latest state changed');
  const old = await session.storage.loadProjection('r1', new AbortController().signal);
  if ((old.get('value')?.value as { number: number }).number !== 1) throw new Error('Old history is inaccessible');
  const token = session.coordinator.begin('Edit after cached reopen');
  session.coordinator.write(token, 'value', { type: 'fixture', schemaVersion: 1, value: { number: 121 }, references: [], blobs: [] });
  await session.coordinator.flush(session.coordinator.commit(token).receipt);
  await session.close(); session = await RepositorySession.open(options);
  if ((session.coordinator.getProjection().entities.get('value')?.value as { number: number }).number !== 121) throw new Error('New edit lost on cached reopen');
  Object.assign(result, { success: true, revisions: count, cacheBytes, saveMs, openMs, oldHistoryReadable: true, subsequentEditPreserved: true });
} catch (error) { Object.assign(result, { success: false, error: String(error), stack: error instanceof Error ? error.stack : null }); }
finally {
  await session?.close().catch(() => {});
  await (await navigator.storage.getDirectory()).removeEntry(path, { recursive: true }).catch(() => {});
}
document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2);
const report = new URLSearchParams(location.search).get('report');
if (report) await fetch(report, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
