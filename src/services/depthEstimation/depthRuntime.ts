import { loadDepthModel } from './depthModel';
import type { DepthFrame } from './depthMath';

export class DepthRuntime {
  private worker?: Worker;
  private pending?: { id: number; reject: (error: Error) => void };
  private sequence = 0;
  private preparing = false;
  backend = '';
  get ready() { return !!this.worker && !!this.backend; }
  dispose() {
    this.pending?.reject(new DOMException('Depth operation cancelled.', 'AbortError'));
    this.pending = undefined; this.worker?.terminate(); this.worker = undefined; this.backend = '';
  }
  private call<T>(data: Record<string, unknown>, transfer: Transferable[], signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (!this.worker || this.pending) return Promise.reject(new Error('Depth runtime is busy or unavailable.'));
    const worker = this.worker, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, result?: T) => {
        clearTimeout(timeout); signal.removeEventListener('abort', cancel);
        worker.onmessage = null; worker.onerror = null;
        if (this.pending?.id === id) this.pending = undefined;
        if (error) reject(error); else resolve(result!);
      };
      const cancel = () => this.dispose();
      const timeout = setTimeout(() => { finish(new Error('Depth worker timed out. Retry at Fast quality.')); this.dispose(); }, 120_000);
      this.pending = { id, reject: error => finish(error) };
      signal.addEventListener('abort', cancel, { once: true });
      worker.onmessage = ({ data: response }) => { if (response.id === id) finish(response.error ? new Error(response.error) : undefined, response); };
      worker.onerror = event => { finish(new Error(event.message || 'Depth worker failed.')); this.dispose(); };
      worker.postMessage({ ...data, id }, transfer);
    });
  }
  async prepare(signal: AbortSignal, progress: (fraction: number, message: string) => void) {
    if (this.ready) return;
    if (this.worker || this.preparing) throw new Error('Depth model is already loading.');
    this.preparing = true;
    try {
      const model = await loadDepthModel(signal, progress);
      signal.throwIfAborted();
      this.worker = new Worker(new URL('./depthWorker.ts', import.meta.url), { type: 'module' });
      progress(1, 'Starting depth model (first run can take a moment)');
      try { this.backend = (await this.call<{ backend: string }>({ type: 'load', model }, [model], signal)).backend; }
      catch (error) { this.dispose(); throw error; }
    } finally { this.preparing = false; }
  }
  async infer(pixels: ImageData, edge: number, signal: AbortSignal): Promise<DepthFrame> {
    // Transfer a copy: the caller may still own its source frame.
    const buffer = pixels.data.slice().buffer;
    const result = await this.call<DepthFrame & { backend: string }>({ type: 'infer', pixels: buffer, width: pixels.width, height: pixels.height, edge }, [buffer], signal);
    this.backend = result.backend;
    return result;
  }
}
const hot = import.meta.hot?.data as { depthRuntime?: DepthRuntime } | undefined;
export const depthRuntime = hot?.depthRuntime ?? new DepthRuntime();
if (import.meta.hot) import.meta.hot.dispose(data => { data.depthRuntime = depthRuntime; });
