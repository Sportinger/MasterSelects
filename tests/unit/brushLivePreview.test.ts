import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachBrushPreview } from '../../src/services/photogrammetry/brushPreviewWorker';
import { BrushPreviewRuntime } from '../../src/services/photogrammetry/brushPreviewRuntime';

class Channel {
  static all: Channel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly name: string) { Channel.all.push(this); }
  postMessage(data: unknown) {
    for (const peer of Channel.all) if (peer !== this && !peer.closed && peer.name === this.name) peer.onmessage?.({ data });
  }
  close() { this.closed = true; }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { Channel.all = []; vi.unstubAllGlobals(); });

describe('live training preview', () => {
  it('waits for a training step before reading splats, coalesces requests, and continues training', async () => {
    vi.stubGlobal('BroadcastChannel', Channel);
    let finish!: (value: { iter: number }[]) => void;
    const calls: string[] = [];
    const training = {
      trainSteps: vi.fn(() => { calls.push('train'); return new Promise<{ iter: number }[]>(resolve => { finish = resolve; }); }),
      exportPly: vi.fn(async () => { calls.push('export'); return new Uint8Array([1, 2]); }),
    };
    const close = attachBrushPreview(training, 'one');
    const host = new BrushPreviewRuntime(); host.connect('one');
    const step = training.trainSteps();
    await flush();
    host.request(); host.request();
    await flush();
    expect(calls).toEqual(['train']);
    finish([{ iter: 1055 }]); await step; await flush();
    expect(calls).toEqual(['train', 'export']);
    expect(host.getSnapshot()).toMatchObject({ iteration: 1055, bytes: new Uint8Array([1, 2]), revision: 1 });
    close(); host.disconnect();
  });

  it('captures an already paused job without taking another training step', async () => {
    vi.stubGlobal('BroadcastChannel', Channel);
    const training = { trainSteps: vi.fn(async () => []), exportPly: vi.fn(async () => new Uint8Array([3])) };
    const trainSpy = training.trainSteps;
    const close = attachBrushPreview(training, 'paused', 1050);
    const host = new BrushPreviewRuntime(); host.connect('paused'); host.request(); await flush();
    expect(trainSpy).not.toHaveBeenCalled();
    expect(host.getSnapshot().iteration).toBe(1050);
    close(); host.disconnect();
  });

  it('keeps training usable after a failed snapshot and retries visibly', async () => {
    vi.stubGlobal('BroadcastChannel', Channel);
    const training = { trainSteps: vi.fn(async () => [{ iter: 15 }]),
      exportPly: vi.fn().mockRejectedValueOnce(new Error('readback failed')).mockResolvedValue(new Uint8Array([4])) };
    const close = attachBrushPreview(training, 'retry', 10);
    const host = new BrushPreviewRuntime(); host.connect('retry'); host.request(); await flush();
    expect(host.getSnapshot().error).toContain('readback failed');
    await training.trainSteps(); host.request(); await flush();
    expect(host.getSnapshot()).toMatchObject({ iteration: 15, error: null });
    close(); host.disconnect();
  });

  it('discards snapshots from the previous job and protects the next channel from old cleanup', async () => {
    vi.stubGlobal('BroadcastChannel', Channel);
    const host = new BrushPreviewRuntime(); host.connect('old');
    const oldWorker = new Channel('brush-preview:old');
    host.connect('new'); host.disconnect('old');
    oldWorker.postMessage({ type: 'preview', bytes: new Uint8Array([9]), iteration: 500 });
    expect(host.getSnapshot()).toMatchObject({ connected: true, bytes: null, iteration: 0 });
    new Channel('brush-preview:new').postMessage({ type: 'preview', bytes: new Uint8Array([2]), iteration: 5 });
    expect(host.getSnapshot().iteration).toBe(5);
    host.disconnect();
  });

  it('does not read back before the first splats are available', async () => {
    vi.stubGlobal('BroadcastChannel', Channel);
    const training = { trainSteps: vi.fn(async () => []), exportPly: vi.fn(async () => new Uint8Array([1])) };
    const exportSpy = training.exportPly;
    const close = attachBrushPreview(training, 'loading');
    const host = new BrushPreviewRuntime(); host.connect('loading'); host.request(); await flush();
    expect(exportSpy).not.toHaveBeenCalled();
    expect(host.getSnapshot().error).toBeNull();
    close(); host.disconnect();
  });
});
