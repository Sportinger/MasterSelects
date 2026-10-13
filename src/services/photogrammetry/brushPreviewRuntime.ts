import type { SolvedCameraPath } from './cameraSolvePoses';
export interface BrushPreviewSnapshot {
  connected: boolean;
  visible: boolean;
  updating: boolean;
  cameraPath: SolvedCameraPath | null;
  bytes: Uint8Array<ArrayBuffer> | null;
  iteration: number;
  revision: number;
  error: string | null;
  warning: string | null;
}
const empty = (): BrushPreviewSnapshot => ({ connected: false, visible: false, updating: false, cameraPath: null, bytes: null, iteration: 0,
  revision: 0, error: null, warning: null });

/** Transient preview data. No intermediate PLYs enter Media, undo, or project storage. */
export class BrushPreviewRuntime {
  private channel: BroadcastChannel | null = null;
  private channelId: string | null = null;
  private state = empty();
  private listeners = new Set<() => void>();
  private requestedAt = 0;
  private pending = false;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  setVisible(visible: boolean): void { this.update({ ...this.state, visible }); }
  connect(id: string, cameraPath: SolvedCameraPath | null = null): void {
    this.disconnect();
    const channel = new BroadcastChannel(`brush-preview:${id}`);
    this.channel = channel; this.channelId = id;
    this.update({ ...empty(), connected: true, visible: true, updating: true, cameraPath });
    channel.onmessage = event => {
      if (this.channel !== channel) return;
      this.pending = false;
      const message = event.data;
      if (message?.type === 'preview' && message.bytes instanceof Uint8Array
        && message.bytes.byteLength > 0 && message.bytes.byteLength <= 64 * 1024 * 1024) {
        this.update({ ...this.state, connected: true, bytes: message.bytes, iteration: message.iteration,
          revision: this.state.revision + 1, error: null, warning: message.warning ?? null });
      } else if (message?.type === 'error') this.update({ ...this.state, error: String(message.message) });
    };
  }
  freeze(): void {
    this.channel?.close(); this.channel = null; this.pending = false;
    this.update({ ...this.state, updating: false });
  }
  restore(bytes: Uint8Array<ArrayBuffer>, iteration: number, cameraPath: SolvedCameraPath | null): void {
    this.disconnect();
    this.update({ ...empty(), connected: true, visible: true, bytes, iteration, cameraPath, revision: 1 });
  }
  request(): void {
    if (!this.channel) return;
    if (this.pending && Date.now() - this.requestedAt < 30_000) return;
    if (this.pending) this.update({ ...this.state, error: 'Waiting for a safe training checkpoint…' });
    this.pending = true; this.requestedAt = Date.now();
    this.channel.postMessage({ type: 'request' });
  }
  disconnect(id?: string): void {
    if (id && this.channelId !== id) return;
    this.channelId = null;
    this.channel?.close(); this.channel = null; this.pending = false;
    this.update(empty());
  }
  private update(state: BrushPreviewSnapshot): void {
    this.state = state; this.listeners.forEach(listener => listener());
  }
}
const hot = import.meta.hot?.data as { preview?: BrushPreviewRuntime } | undefined;
export const brushPreviewRuntime = hot?.preview ?? new BrushPreviewRuntime();
if (hot?.preview) Object.setPrototypeOf(brushPreviewRuntime, BrushPreviewRuntime.prototype);
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(data => { data.preview = brushPreviewRuntime; });
}
