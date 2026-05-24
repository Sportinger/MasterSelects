import { describe, expect, it } from 'vitest';
import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  STANDARD_RUNTIME_WORKER_HANDLERS,
  WorkerRuntimeHost,
  type RuntimeJobHandler,
  type RuntimeWorkerOutboundMessage,
} from '../../../../src/runtime/worker';

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await wait();
  }
  throw new Error('Timed out waiting for runtime worker event');
}

async function waitForTerminal(events: RuntimeWorkerOutboundMessage[]): Promise<RuntimeWorkerOutboundMessage> {
  await waitFor(() => events.some((event) => (
    event.type === 'runtime.job.completed' ||
    event.type === 'runtime.job.failed' ||
    event.type === 'runtime.job.cancelled'
  )));
  const terminal = events.find((event) => (
    event.type === 'runtime.job.completed' ||
    event.type === 'runtime.job.failed' ||
    event.type === 'runtime.job.cancelled'
  ));
  if (!terminal) {
    throw new Error('Runtime job did not produce a terminal event');
  }
  return terminal;
}

function createHost(handlers = STANDARD_RUNTIME_WORKER_HANDLERS) {
  const events: RuntimeWorkerOutboundMessage[] = [];
  const transferLists: Transferable[][] = [];
  const host = new WorkerRuntimeHost({
    handlers,
    now: () => '2026-05-24T00:00:00.000Z',
    postMessage: (message, transfer = []) => {
      events.push(message);
      transferLists.push(transfer);
    },
  });
  return { host, events, transferLists };
}

describe('WorkerRuntimeHost', () => {
  it('runs real byte handlers with queued, running, progress, log, and completed events', async () => {
    const { host, events } = createHost();
    const bytes = new TextEncoder().encode('hello');

    host.handleMessage({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.start',
      job: {
        jobId: 'job-hash',
        providerId: 'runtime.probe',
        handlerId: 'runtime.hash.sha256',
        input: { bytes },
      },
    });

    const terminal = await waitForTerminal(events);

    expect(events.map((event) => event.type)).toEqual([
      'runtime.job.queued',
      'runtime.job.running',
      'runtime.job.log',
      'runtime.job.progress',
      'runtime.job.progress',
      'runtime.job.progress',
      'runtime.job.completed',
    ]);

    expect(terminal).toMatchObject({
      status: 'completed',
      output: {
        algorithm: 'SHA-256',
        hash: 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        byteLength: 5,
      },
    });
  });

  it('returns transferables from handler output', async () => {
    const { host, events, transferLists } = createHost();
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    host.handleMessage({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.start',
      job: {
        jobId: 'job-echo',
        providerId: 'runtime.probe',
        handlerId: 'runtime.echo',
        input: { bytes },
      },
    });

    await waitFor(() => events.some((event) => event.type === 'runtime.job.completed'));
    const completedIndex = events.findIndex((event) => event.type === 'runtime.job.completed');

    expect(transferLists[completedIndex]).toContain(bytes);
    expect(events[completedIndex]).toMatchObject({
      status: 'completed',
      output: { bytes },
    });
  });

  it('reports CSV diagnostics and parsed metadata from real bytes', async () => {
    const { host, events } = createHost();
    const bytes = new TextEncoder().encode('name,score\nAda,10\nLinus,12\n');

    host.handleMessage({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.start',
      job: {
        jobId: 'job-csv',
        providerId: 'runtime.probe',
        handlerId: 'runtime.csv.inspect',
        input: { bytes },
      },
    });

    const terminal = await waitForTerminal(events);

    expect(terminal).toMatchObject({
      output: {
        delimiter: ',',
        hasHeader: true,
        columnCount: 2,
        rowCount: 2,
        columns: ['name', 'score'],
        sampleRows: [
          ['Ada', '10'],
          ['Linus', '12'],
        ],
      },
    });
  });

  it('cancels running jobs through AbortController and suppresses completion', async () => {
    const slowHandler: RuntimeJobHandler<{ ticks: number }, string> = async (input, context) => {
      for (let tick = 0; tick < input.ticks; tick += 1) {
        await wait(1);
        if (context.signal.aborted) {
          throw new DOMException('Runtime job cancelled', 'AbortError');
        }
        context.progress((tick + 1) / input.ticks);
      }
      return { output: 'done' };
    };
    const { host, events } = createHost([
      { handlerId: 'runtime.slow', handler: slowHandler },
    ]);

    host.handleMessage({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.start',
      job: {
        jobId: 'job-cancel',
        providerId: 'runtime.probe',
        handlerId: 'runtime.slow',
        input: { ticks: 10 },
      },
    });

    await waitFor(() => events.some((event) => event.type === 'runtime.job.running'));
    host.handleMessage({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.cancel',
      jobId: 'job-cancel',
      reason: 'test cancellation',
    });
    await wait(20);

    expect(events.some((event) => event.type === 'runtime.job.cancelled')).toBe(true);
    expect(events.some((event) => event.type === 'runtime.job.completed')).toBe(false);
  });

  it('fails closed for unknown handlers', async () => {
    const { host, events } = createHost([]);

    host.handleMessage({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.start',
      job: {
        jobId: 'job-missing',
        providerId: 'runtime.probe',
        handlerId: 'runtime.missing',
        input: {},
      },
    });

    await waitFor(() => events.some((event) => event.type === 'runtime.job.failed'));
    expect(events.map((event) => event.type)).toEqual([
      'runtime.job.queued',
      'runtime.job.failed',
    ]);
  });
});
