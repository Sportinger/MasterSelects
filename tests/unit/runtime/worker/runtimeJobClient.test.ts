import { describe, expect, it } from 'vitest';
import {
  RuntimeJobClient,
  RuntimeJobClientError,
  STANDARD_RUNTIME_WORKER_HANDLERS,
  WorkerRuntimeHost,
  type RuntimeWorkerInboundMessage,
  type RuntimeWorkerOutboundMessage,
  type RuntimeWorkerTransport,
} from '../../../../src/runtime/worker';

class InMemoryRuntimeWorkerTransport implements RuntimeWorkerTransport {
  readonly postedTransferLists: Transferable[][] = [];
  private readonly listeners = new Set<(event: MessageEvent<RuntimeWorkerOutboundMessage>) => void>();
  private readonly host = new WorkerRuntimeHost({
    handlers: STANDARD_RUNTIME_WORKER_HANDLERS,
    now: () => '2026-05-24T00:00:00.000Z',
    postMessage: (message, transfer = []) => {
      this.lastWorkerTransferList = transfer;
      queueMicrotask(() => {
        const event = { data: message } as MessageEvent<RuntimeWorkerOutboundMessage>;
        this.listeners.forEach((listener) => listener(event));
      });
    },
  });

  lastWorkerTransferList: Transferable[] = [];

  postMessage(message: RuntimeWorkerInboundMessage, transfer: Transferable[] = []): void {
    this.postedTransferLists.push(transfer);
    this.host.handleMessage(message);
  }

  addEventListener(
    _type: 'message',
    listener: (event: MessageEvent<RuntimeWorkerOutboundMessage>) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: 'message',
    listener: (event: MessageEvent<RuntimeWorkerOutboundMessage>) => void,
  ): void {
    this.listeners.delete(listener);
  }
}

describe('RuntimeJobClient', () => {
  it('posts transferables, streams events, and resolves completed output', async () => {
    const transport = new InMemoryRuntimeWorkerTransport();
    const client = new RuntimeJobClient(transport);
    const bytes = new Uint8Array([4, 5, 6]);
    const eventTypes: string[] = [];

    const handle = client.runJob<{ bytes: Uint8Array }, { bytes: Uint8Array }>({
      jobId: 'client-echo',
      providerId: 'runtime.probe',
      handlerId: 'runtime.echo',
      input: { bytes },
    }, {
      onEvent: (event) => {
        eventTypes.push(event.type);
      },
    });

    const result = await handle.promise;

    expect(transport.postedTransferLists[0]).toContain(bytes.buffer);
    expect(transport.lastWorkerTransferList).toContain(bytes.buffer);
    expect(result.output.bytes).toBe(bytes);
    expect(result.logs[0]).toMatchObject({
      level: 'debug',
      message: 'Echo runtime job started',
    });
    expect(eventTypes).toContain('runtime.job.queued');
    expect(eventTypes).toContain('runtime.job.completed');

    client.dispose();
  });

  it('rejects cancelled jobs with a typed client error', async () => {
    const transport = new InMemoryRuntimeWorkerTransport();
    const client = new RuntimeJobClient(transport);
    const controller = new AbortController();

    const handle = client.runJob({
      jobId: 'client-cancel',
      providerId: 'runtime.probe',
      handlerId: 'runtime.hash.sha256',
      input: { bytes: new TextEncoder().encode('cancel me') },
    }, {
      signal: controller.signal,
    });

    controller.abort('stop');

    await expect(handle.promise).rejects.toMatchObject({
      name: 'RuntimeJobCancelledError',
      status: 'cancelled',
      jobId: 'client-cancel',
    } satisfies Partial<RuntimeJobClientError>);

    client.dispose();
  });

  it('honors AbortSignal instances that are already aborted before enqueue', async () => {
    const transport = new InMemoryRuntimeWorkerTransport();
    const client = new RuntimeJobClient(transport);
    const controller = new AbortController();
    controller.abort('pre-cancel');

    const handle = client.runJob({
      jobId: 'client-pre-cancel',
      providerId: 'runtime.probe',
      handlerId: 'runtime.hash.sha256',
      input: { bytes: new TextEncoder().encode('cancel me before enqueue') },
    }, {
      signal: controller.signal,
    });

    await expect(handle.promise).rejects.toMatchObject({
      name: 'RuntimeJobCancelledError',
      status: 'cancelled',
      jobId: 'client-pre-cancel',
    } satisfies Partial<RuntimeJobClientError>);

    client.dispose();
  });
});
