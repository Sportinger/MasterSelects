import type { PreviewFrame } from './previewTypes';

export function isTextPreview(frame: PreviewFrame): boolean {
  return frame.drawing?.kind === 'text' || frame.drawing?.kind === 'number' || frame.presentation === 'text';
}

/** Runtime text channel. No bitmaps, stores, per-node clocks or thumbnail workers.
 * Subscribers are notified only when the displayed value/status actually changes. */
export class PreviewTextStore {
  private frames = new Map<string, PreviewFrame>();
  private signatures = new Map<string, string>();
  private listeners = new Map<string, Set<() => void>>();
  private owners = new Map<object, Set<string>>();
  get = (key: string) => this.frames.get(key);
  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set(); listeners.add(listener); this.listeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }
  publish(frame: PreviewFrame): boolean {
    const hadText = this.frames.has(frame.key), text = isTextPreview(frame);
    const signature = text ? JSON.stringify([frame.drawing, frame.controls, frame.values, frame.status, frame.label]) : undefined;
    if (signature !== this.signatures.get(frame.key)) {
      if (text) { const { bitmap: _bitmap, ...plain } = frame; this.frames.set(frame.key, plain); this.signatures.set(frame.key, signature!); }
      else { this.frames.delete(frame.key); this.signatures.delete(frame.key); }
      this.listeners.get(frame.key)?.forEach(listener => listener());
    }
    return hadText !== text;
  }
  retain(owner: object, keys: Set<string>) {
    if (keys.size) this.owners.set(owner, keys); else this.owners.delete(owner);
    const retained = new Set([...this.owners.values()].flatMap(value => [...value]));
    for (const key of this.frames.keys()) if (!retained.has(key)) {
      this.frames.delete(key); this.signatures.delete(key); this.listeners.get(key)?.forEach(listener => listener());
    }
  }
}
const instance = import.meta.hot?.data?.previewTextStore as PreviewTextStore | undefined;
export const previewTextStore = instance ?? new PreviewTextStore();
if (import.meta.hot) import.meta.hot.dispose(data => { data.previewTextStore = previewTextStore; });
