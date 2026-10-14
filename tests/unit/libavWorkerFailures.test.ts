import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibavWorker, type LibavOpenRequest } from '../../src/services/mediaRuntime/codec/LibavWorker';

let transport: { onmessage: (event: any) => void; onerror: (event: any) => void; terminate: ReturnType<typeof vi.fn> };
const open: LibavOpenRequest = { type: 'open', codec: 'hevc', eightBit: false, visibleRect: null,
  colorMatrix: 'bt709', frameDurationUs: 0, deinterlace: false };
const packet = { data: new Uint8Array([1]), timestamp: 0, duration: 1,
  microsecondTimestamp: 0, microsecondDuration: 1_000_000 };
beforeEach(() => {
  const stub = { onmessage: (_event: any) => {}, onerror: (_event: any) => {}, terminate: vi.fn(), postMessage: vi.fn() };
  transport = stub;
  vi.stubGlobal('Worker', vi.fn(function () { return stub; }));
});
afterEach(() => vi.unstubAllGlobals());

describe('shared libav worker failures', () => {
  it('rejects decoder startup when the worker script fails to load', async () => {
    const worker = new LibavWorker(open);
    const ready = expect(worker.ready()).rejects.toThrow('missing decoder');
    transport.onerror({ message: 'missing decoder' });
    await ready; worker.terminate();
    expect(transport.terminate).toHaveBeenCalledOnce();
  });
  it('releases drain, packet and capacity waiters when a running decoder fails', async () => {
    const worker = new LibavWorker(open);
    transport.onmessage({ data: { type: 'opened' } }); await worker.ready();
    worker.feed(packet);
    const capacity = worker.waitForFeedAck();
    const drain = expect(worker.drain(1)).rejects.toThrow('corrupt packet');
    const single = expect(worker.decode(2, packet)).rejects.toThrow('corrupt packet');
    const onError = vi.fn(); worker.onStreamError = onError;
    transport.onmessage({ data: { type: 'error', id: null, error: 'corrupt packet' } });
    await Promise.all([capacity, drain, single]);
    expect(onError).toHaveBeenCalledOnce();
    await expect(worker.decode(3, packet)).rejects.toThrow('corrupt packet');
    worker.terminate();
  });
  it('rejects pending flushes on disposal rather than leaving exact seeks hanging', async () => {
    const worker = new LibavWorker(open);
    transport.onmessage({ data: { type: 'opened' } }); await worker.ready();
    const drain = expect(worker.drain(1)).rejects.toThrow('terminated');
    worker.terminate(); await drain;
    worker.terminate(); expect(transport.terminate).toHaveBeenCalledOnce();
  });
});
