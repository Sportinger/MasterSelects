import type { EffectOperatorGraph } from '../../types/operatorGraph';

export interface InspectorGraphInput { type: string; params: Record<string, unknown>; operatorGraph?: EffectOperatorGraph }
export interface InspectorGraphResult { graph?: EffectOperatorGraph; error?: string; durationMs?: number }
export interface InspectorGraphWorker {
  postMessage(message: { id: number; input: InspectorGraphInput }): void;
  onmessage: ((event: MessageEvent<InspectorGraphResult & { id: number }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}
interface Entry { id: number; input: InspectorGraphInput; result: InspectorGraphResult; listeners: Set<() => void> }
const pending: InspectorGraphResult = {};

/** One active job, only still-visible revisions queued, bounded completed cache.
 * An obsolete result can populate its own cache entry, never a newer revision. */
export class InspectorGraphQueue {
  private entries = new Map<string, Entry>();
  private worker?: InspectorGraphWorker;
  private active?: Entry;
  private sequence = 0;
  private createWorker: () => InspectorGraphWorker;
  constructor(createWorker: () => InspectorGraphWorker) { this.createWorker = createWorker; }

  read(key: string): InspectorGraphResult { return this.entries.get(key)?.result ?? pending; }

  subscribe(key: string, input: InspectorGraphInput, listener: () => void): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { id: ++this.sequence, input, result: pending, listeners: new Set() };
      this.entries.set(key, entry);
    }
    entry.listeners.add(listener);
    this.pump();
    return () => {
      entry!.listeners.delete(listener);
      if (!entry!.listeners.size && entry!.result === pending && entry !== this.active) this.entries.delete(key);
      this.trim();
    };
  }

  private pump(): void {
    if (this.active) return;
    const entry = [...this.entries.values()].find(item => item.result === pending && item.listeners.size);
    if (!entry) return;
    this.active = entry;
    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        this.worker.onmessage = event => {
          if (this.active?.id !== event.data.id) return;
          this.finish(event.data);
        };
        this.worker.onerror = event => {
          this.worker?.terminate(); this.worker = undefined;
          this.finish({ error: event.message || 'Graph preparation worker failed.' });
        };
      }
      this.worker.postMessage({ id: entry.id, input: entry.input });
    } catch (error) {
      this.finish({ error: String(error) });
    }
  }

  private finish(result: InspectorGraphResult): void {
    const entry = this.active;
    if (!entry) return;
    entry.result = result;
    this.active = undefined;
    for (const listener of entry.listeners) listener();
    this.trim(); this.pump();
  }

  private trim(): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= 32) break;
      if (!entry.listeners.size && entry !== this.active) this.entries.delete(key);
    }
  }
}
