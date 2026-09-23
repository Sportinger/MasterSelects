import { expect, it, vi } from 'vitest';
import { InspectorGraphQueue, type InspectorGraphWorker } from '../../src/services/operators/inspectorGraphQueue';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

function setup() {
  const worker: InspectorGraphWorker = { postMessage: vi.fn(), onmessage: null, onerror: null, terminate: vi.fn() };
  return { worker, queue: new InspectorGraphQueue(() => worker) };
}
const input = { type: 'invert', params: {} };
const graph = { domain: 'image', schemaVersion: 1, nodes: [], edges: [] } as EffectOperatorGraph;

it('shares one job between inspector consumers and reuses completed metadata', () => {
  const { worker, queue } = setup();
  const a = vi.fn(), b = vi.fn();
  const closeA = queue.subscribe('revision', input, a);
  queue.subscribe('revision', { ...input, params: { amount: .5 } }, b);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  worker.onmessage!({ data: { id: 1, graph, durationMs: 12 } } as MessageEvent);
  expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
  closeA(); queue.subscribe('revision', input, vi.fn());
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  expect(queue.read('revision').graph).toBe(graph);
});

it('drops obsolete queued revisions and never applies a late result to the new selection', () => {
  const { worker, queue } = setup();
  const first = vi.fn(), latest = vi.fn();
  const close = queue.subscribe('first', input, first);
  const obsolete = queue.subscribe('obsolete', input, vi.fn());
  obsolete(); close();
  queue.subscribe('latest', input, latest);
  worker.onmessage!({ data: { id: 1, graph } } as MessageEvent);
  expect(first).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  expect(worker.postMessage).toHaveBeenLastCalledWith({ id: 3, input });
  worker.onmessage!({ data: { id: 1, error: 'stale' } } as MessageEvent);
  expect(queue.read('latest').error).toBeUndefined();
  worker.onmessage!({ data: { id: 3, graph } } as MessageEvent);
  expect(latest).toHaveBeenCalledTimes(1);
});

it('surfaces worker failures and bounds unused completed revisions', () => {
  const { worker, queue } = setup();
  for (let id = 1; id <= 40; id++) {
    const close = queue.subscribe(String(id), input, vi.fn());
    worker.onmessage!({ data: { id, graph } } as MessageEvent);
    close();
  }
  expect(queue.read('1').graph).toBeUndefined();
  queue.subscribe('failure', input, vi.fn());
  worker.onerror!({ message: 'worker stopped' } as ErrorEvent);
  expect(queue.read('failure').error).toBe('worker stopped');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
