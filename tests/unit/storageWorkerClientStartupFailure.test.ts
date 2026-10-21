import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKER_LOAD_FAILURE_EVENT } from '../../src/runtime/workerLoadFailure';
import { StorageWorkerClient } from '../../src/services/project/repository/persistence/StorageWorkerClient';

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() { FakeWorker.last = this; }
  postMessage(): void {}
  terminate(): void {}
}

function startClient(): { client: StorageWorkerClient; worker: FakeWorker; reports: string[] } {
  vi.stubGlobal('Worker', FakeWorker);
  const reports: string[] = [];
  const listener = (event: Event) => reports.push(String((event as CustomEvent).detail));
  window.addEventListener(WORKER_LOAD_FAILURE_EVENT, listener);
  cleanups.push(() => window.removeEventListener(WORKER_LOAD_FAILURE_EVENT, listener));
  const client = new StorageWorkerClient();
  return { client, worker: FakeWorker.last!, reports };
}
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); });

describe('StorageWorkerClient startup failure', () => {
  it('reports a worker that fails before it ever answers as a possible stale deploy', async () => {
    const { client, worker, reports } = startClient();
    const pending = client.request({ type: 'close' } as never).catch((error: Error) => error);
    worker.onerror!({ message: '' });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('storage phase: startup');
    expect(await pending).toBeInstanceOf(Error);
  });

  it('does not report errors of a worker that already answered', () => {
    const { worker, reports } = startClient();
    worker.onmessage!({ data: { type: 'open-progress', sessionEpoch: 'other' } });
    worker.onerror!({ message: 'boom' });
    expect(reports).toEqual([]);
  });
});
