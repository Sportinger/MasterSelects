import { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import { newRepositoryDescriptor } from '../../src/services/project/repository/lifecycle/RepositoryLifecycle';
import { readNavigationPreferences } from '../../src/services/project/repository/persistence/navigationPreferences';
import type { NavigationPayload, RepositoryRecord } from '../../src/services/project/repository/contracts';

const result: Record<string, unknown> = {};
const path = `repository-navigation-check-${crypto.randomUUID()}`;
const descriptor = newRepositoryDescriptor();
const options = { descriptor, location: { kind: 'opfs' as const, path }, workspaceId: 'check',
  activation: { canActivate: () => true, activate: async () => {} } };
let session: RepositorySession | null = null;
try {
  const start = performance.now();
  const redo = Object.fromEntries(Array.from({ length: 14000 }, () => [crypto.randomUUID(), crypto.randomUUID()]));
  session = await RepositorySession.open(options);
  await session.storage.publishRevision({ revisionId: 'r0', transactionId: 'initial', parentRevisionId: null, label: 'Regression', source: 'test', createdAt: 0,
    changes: [{ entityKey: 'value', before: null, after: { type: 'fixture', schemaVersion: 1, value: 'preserved', references: [], blobs: [] } }] }, 'check', redo, 1);
  await session.close(); session = await RepositorySession.open(options);
  const record = await session.client.request<RepositoryRecord>({ type: 'record', reference: session.opening.recovery.heads['navigation:check'] });
  const decoded = await readNavigationPreferences(record.payload as unknown as NavigationPayload,
    reference => session!.client.request<RepositoryRecord>({ type: 'record', reference }));
  if (Object.keys(decoded).length !== 14000 || Object.entries(redo).some(([key, value]) => decoded[key] !== value)) throw new Error('Redo choices changed during reopen');
  if (session.coordinator.getProjection().entities.get('value')?.value !== 'preserved') throw new Error('Content changed during reopen');
  const token = session.coordinator.begin('Save after reopen');
  session.coordinator.write(token, 'value', { type: 'fixture', schemaVersion: 1, value: 'edited', references: [], blobs: [] });
  await session.coordinator.flush(session.coordinator.commit(token).receipt);
  await session.close(); session = await RepositorySession.open(options);
  if (session.coordinator.getProjection().entities.get('value')?.value !== 'edited') throw new Error('Subsequent save failed');
  Object.assign(result, { success: true, choices: 14000, reopenAndSave: true, elapsedMs: performance.now() - start });
} catch (error) { Object.assign(result, { success: false, error: String(error), stack: error instanceof Error ? error.stack : null }); }
finally {
  await session?.close().catch(() => {});
  await (await navigator.storage.getDirectory()).removeEntry(path, { recursive: true }).catch(() => {});
}
document.querySelector('#result')!.textContent = JSON.stringify(result, null, 2);
const report = new URLSearchParams(location.search).get('report');
if (report) await fetch(report, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
