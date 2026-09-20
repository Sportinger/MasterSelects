import type { ArtifactSampleRequest, ArtifactSampleResult } from './previewArtifactProtocol';

/** One lazy worker per workspace; compressed bakes never decode on the interaction thread. */
export class PreviewArtifactReader {
  private worker?: Worker;
  private nextId = 0;
  private sent = new Map<string, string>();
  private pending = new Map<number, (value: ArtifactSampleResult) => void>();
  private watchdog?: ReturnType<typeof setTimeout>;
  sample(artifact: string, data: string, format: ArtifactSampleRequest['format'], stage: string, time: number): Promise<ArtifactSampleResult> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./previewArtifacts.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<ArtifactSampleResult & { retained: string[] }>) => {
        for (const key of this.sent.keys()) if (!event.data.retained.includes(key)) this.sent.delete(key);
        this.pending.get(event.data.id)?.(event.data); this.pending.delete(event.data.id);
        if (!this.pending.size) clearTimeout(this.watchdog);
      };
      this.worker.onerror = () => this.dispose();
    }
    const id = ++this.nextId;
    const changed = this.sent.get(artifact) !== data;
    this.sent.set(artifact, data);
    return new Promise(resolve => {
      if (!this.pending.size) this.watchdog = setTimeout(() => this.dispose(), 4000);
      this.pending.set(id, resolve);
      try { this.worker!.postMessage({ id, artifact, data: changed ? data : undefined, format, stage, time } satisfies ArtifactSampleRequest); }
      catch { this.dispose(); }
    });
  }
  dispose() {
    this.worker?.terminate(); this.worker = undefined; this.sent.clear();
    clearTimeout(this.watchdog);
    for (const [id, resolve] of this.pending) resolve({ id, label: 'Preview paused' });
    this.pending.clear();
  }
}
