import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DepthRuntime } from '../../src/services/depthEstimation/depthRuntime';
vi.mock('../../src/services/depthEstimation/depthModel', () => ({ loadDepthModel: vi.fn(async () => new ArrayBuffer(8)) }));
const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  terminate = vi.fn();
  last: any;
  constructor() { workers.push(this); }
  postMessage(data: any) { this.last = data; if (data.type === 'load') queueMicrotask(() => this.onmessage?.({ data: { id: data.id, backend: 'WebGPU' } })); }
}
beforeEach(() => { workers.length = 0; vi.stubGlobal('Worker', FakeWorker); });
describe('depth worker lifecycle', () => {
  it('aborts in-flight inference, terminates the worker, and can reload', async () => {
    const runtime = new DepthRuntime(), abort = new AbortController();
    await runtime.prepare(abort.signal, vi.fn());
    expect(runtime.ready).toBe(true);
    const pending = runtime.infer({ data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData, 280, abort.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await rejection;
    expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(runtime.ready).toBe(false);
    await runtime.prepare(new AbortController().signal, vi.fn());
    expect(runtime.ready).toBe(true); expect(workers).toHaveLength(2); runtime.dispose();
  });
  it('bounds work to one request and ignores an unrelated reply', async () => {
    const runtime = new DepthRuntime(), signal = new AbortController().signal;
    await runtime.prepare(signal, vi.fn());
    const image = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData;
    const result = runtime.infer(image, 280, signal);
    await expect(runtime.infer(image, 280, signal)).rejects.toThrow(/busy/);
    workers[0].onmessage?.({ data: { id: -1, error: 'stale response' } });
    const response = { id: workers[0].last.id, width: 1, height: 1, values: new Float32Array([2]), backend: 'CPU / WASM', milliseconds: 12 };
    workers[0].onmessage?.({ data: response });
    expect(await result).toMatchObject({ milliseconds: 12 }); expect(runtime.backend).toBe('CPU / WASM'); runtime.dispose();
  });
});
