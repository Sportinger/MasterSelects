import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeCanvasRuntime } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasRuntime';
import type { CanvasWorkerReply } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';

vi.mock('../../src/components/panels/nodes/canvas/rendering/paintNodeCanvas', () => ({ paintBase: vi.fn(), paintOverlay: vi.fn() }));
vi.mock('../../src/utils/canvasPlatform', () => ({ prefersSoftwareTimelineCanvas: () => false }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers();
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: CanvasWorkerReply }) => void;
    onerror?: () => void;
    terminate = vi.fn(); postMessage = vi.fn();
    constructor() { workers.push(this); }
  }
  vi.stubGlobal('Worker', FakeWorker); vi.stubGlobal('OffscreenCanvas', class {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, type: string) {
    return (type === 'bitmaprenderer' ? { transferFromImageBitmap: vi.fn() }
      : { canvas: this, setTransform: vi.fn(), clearRect: vi.fn() }) as CanvasRenderingContext2D;
  });
  const host = document.createElement('div'), ready = vi.fn();
  const runtime = createNodeCanvasRuntime(host, ready);
  runtime.update({ type: 'scene', scene: { nodes: [], cables: [], groups: [], plugs: [] } });
  runtime.update({ type: 'view', view: { zoom: 1, panX: 0, panY: 0, width: 500, height: 400, ratio: 1 },
    theme: { background: '#111', card: '#222', text: '#fff', muted: '#aaa', border: '#444', accent: '#abc' } });
  return { runtime, host, ready, worker: workers[0] };
}

describe('busy node worker ownership', () => {
  it('keeps an acknowledged worker while first paint and preview delivery exceed both old deadlines', async () => {
    const s = setup(); await Promise.resolve();
    s.worker.onmessage?.({ data: { type: 'initialized' } });
    s.runtime.preview({ key: 'preview', revision: '1', time: 0, status: 'live', label: 'Preview', bitmap: { close: vi.fn() } as unknown as ImageBitmap });
    await Promise.resolve();
    expect(s.runtime.previewBusy).toBe(true);
    vi.advanceTimersByTime(90_000);
    expect(s.worker.terminate).not.toHaveBeenCalled(); expect(s.ready).not.toHaveBeenCalled();
    expect(s.runtime.software).toBe(false);
    s.worker.onmessage?.({ data: { type: 'previews-ready', batchId: 1, previewCount: 1 } });
    expect(s.runtime.previewBusy).toBe(false);
    s.worker.onmessage?.({ data: { type: 'frame', bitmap: { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap } });
    expect(s.host.dataset.renderer).toBe('worker'); expect(s.ready).toHaveBeenCalledExactlyOnceWith(true);
    s.runtime.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('recovers on explicit failure without ever enabling DOM during the software swap', async () => {
    const s = setup(); await Promise.resolve();
    s.worker.onmessage?.({ data: { type: 'initialized' } });
    s.worker.onmessage?.({ data: { type: 'frame' } });
    s.worker.onmessage?.({ data: { type: 'failed' } });
    expect(s.ready).not.toHaveBeenCalledWith(false);
    vi.advanceTimersByTime(20);
    expect(s.host.dataset.renderer).toBe('software'); expect(s.ready).not.toHaveBeenCalledWith(false);
    s.runtime.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('retains a deadline for a worker that never initializes', async () => {
    const s = setup(); await Promise.resolve(); vi.advanceTimersByTime(5020);
    expect(s.worker.terminate).toHaveBeenCalledOnce(); expect(s.host.dataset.renderer).toBe('software');
    expect(s.ready).not.toHaveBeenCalledWith(false); s.runtime.dispose();
  });
  it('only enables DOM when the software contexts are unavailable too', async () => {
    const s = setup(); await Promise.resolve();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    s.worker.onerror?.();
    expect(s.host.dataset.renderer).toBe('dom'); expect(s.ready).toHaveBeenCalledExactlyOnceWith(false);
    s.runtime.dispose();
  });
  it('releases DOM ownership synchronously when there is no worker or 2D context', () => {
    const s = setup(); s.runtime.dispose();
    vi.stubGlobal('Worker', undefined); vi.stubGlobal('OffscreenCanvas', undefined);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const host = document.createElement('div'), ready = vi.fn();
    const runtime = createNodeCanvasRuntime(host, ready);
    expect(host.dataset.renderer).toBe('dom'); expect(ready).toHaveBeenCalledExactlyOnceWith(false);
    runtime.dispose();
  });
});
