import { afterEach, expect, it, vi } from 'vitest';
import { StorageWorkerClient } from '../../src/services/project/repository/persistence/StorageWorkerClient';

class WorkerFixture {
  static latest: WorkerFixture;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { WorkerFixture.latest = this; }
}
afterEach(() => vi.unstubAllGlobals());
it('distinguishes a failed worker startup, rejects pending work and releases it on close', async () => {
  vi.stubGlobal('Worker', WorkerFixture);
  const client = new StorageWorkerClient();
  const changed = vi.fn(); client.subscribeFailure(changed);
  const request = client.request({ type: 'open' } as never);
  const failure = expect(request).rejects.toThrow('storage phase: startup; operations: open');
  WorkerFixture.latest.onerror!({ message: '' }); await failure;
  expect(changed).toHaveBeenCalledOnce();
  await expect(client.request({ type: 'query', options: { limit: 1 } })).rejects.toBe(client.error);
  await client.close().catch(() => {});
  expect(WorkerFixture.latest.terminate).toHaveBeenCalledOnce();
});
it('reports a writer failure after opening using only operation names', async () => {
  vi.stubGlobal('Worker', WorkerFixture);
  const client = new StorageWorkerClient(); const worker = WorkerFixture.latest;
  const opened = client.request({ type: 'open' } as never);
  const first = worker.postMessage.mock.calls[0][0];
  worker.onmessage!({ data: { sessionEpoch: first.sessionEpoch, requestId: first.requestId, ok: true, data: {} } });
  await opened;
  const pending = client.request({ type: 'publish', batch: { batchId: 'PRIVATE_PROJECT_NAME' } } as never);
  const failure = expect(pending).rejects.toThrow('storage phase: ready; operations: publish');
  worker.onerror!({ message: 'Storage stopped' }); await failure;
  expect(client.error?.message).not.toContain('PRIVATE_PROJECT_NAME');
  await client.close().catch(() => {});
});
