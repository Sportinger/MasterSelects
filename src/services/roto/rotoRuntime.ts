import type { RotoPoint, RotoReply, RotoRequest } from './rotoTypes';

class RotoRuntime {
  private worker?: Worker;
  private pending?: (error: Error) => void;
  private sequence = 0;
  ready = false;
  dispose() {
    this.pending?.(new Error('Rotoscoping stopped. Cached models and completed masks are kept.'));
    this.pending = undefined; this.worker?.terminate(); this.worker = undefined; this.ready = false;
  }
  private call(request: RotoRequest, signal: AbortSignal, progress?: (value: number, text: string) => void): Promise<RotoReply> {
    signal.throwIfAborted();
    if (this.pending) throw new Error('Another segmentation operation is still running.');
    this.worker ??= new Worker(new URL('./rotoWorker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, result?: RotoReply) => {
        clearTimeout(timeout); signal.removeEventListener('abort', cancel); worker.onmessage = null; worker.onerror = null;
        this.pending = undefined; if (error) reject(error); else resolve(result!);
      };
      const cancel = () => this.dispose();
      const timeout = setTimeout(() => { finish(new Error('SAM 2.1 timed out. Retry or shorten the range.')); this.dispose(); }, 300_000);
      this.pending = error => finish(error);
      signal.addEventListener('abort', cancel, { once: true });
      worker.onerror = event => { finish(new Error(event.message || 'Segmentation worker failed.')); this.dispose(); };
      worker.onmessage = ({ data }: MessageEvent<RotoReply>) => {
        if (data.id !== id) return;
        if (data.progress !== undefined) { progress?.(data.progress, data.message ?? 'Preparing SAM 2.1'); return; }
        finish(data.error ? new Error(data.error) : undefined, data);
      };
      worker.postMessage({ ...request, id });
    });
  }
  async prepare(signal: AbortSignal, progress: (value: number, text: string) => void) {
    if (this.ready) return;
    try { await this.call({ type: 'load' }, signal, progress); this.ready = true; }
    catch (error) { this.dispose(); throw error; }
  }
  async seed(pixels: ImageData, points: RotoPoint[], totalFrames: number, signal: AbortSignal) {
    return this.call({ type: 'seed', pixels, points, totalFrames }, signal);
  }
  async step(pixels: ImageData, signal: AbortSignal) { return this.call({ type: 'step', pixels }, signal); }
}
const hot = import.meta.hot?.data as { rotoRuntime?: RotoRuntime } | undefined;
export const rotoRuntime = hot?.rotoRuntime ?? new RotoRuntime();
if (import.meta.hot) import.meta.hot.dispose(data => { data.rotoRuntime = rotoRuntime; });
