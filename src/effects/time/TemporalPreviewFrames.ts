import { StabilizedCurrentFrame } from './StabilizedCurrentFrame';

/** Presentation-only snapshots. Never sample these as source history: incomplete
 * source windows hold one finished effect image instead of splicing time ranges. */
export class TemporalPreviewFrames {
  private frames = new Map<string, { frame: StabilizedCurrentFrame; view: GPUTextureView; bytes: number }>();
  private device: GPUDevice;
  constructor(device: GPUDevice) { this.device = device; }

  get(key: string | undefined, width: number, height: number) {
    const entry = key ? this.frames.get(key) : undefined;
    return entry?.frame.width === width && entry.frame.height === height ? entry.view : undefined;
  }

  capture(key: string | undefined, encoder: GPUCommandEncoder, view: GPUTextureView, width: number, height: number) {
    if (!key) return;
    let entry = this.frames.get(key);
    if (entry && (entry.frame.width !== width || entry.frame.height !== height)) {
      this.retire(entry.frame); this.frames.delete(key); entry = undefined;
    }
    const frame = entry?.frame ?? new StabilizedCurrentFrame(this.device, width, height);
    const captured = frame.encode(encoder, view, [1, 0, 0, 0, 1, 0]);
    this.frames.delete(key);
    this.frames.set(key, { frame, view: captured, bytes: width * height * 4 });
    // Presentation memory is bounded independently of source-history allocation.
    let bytes = [...this.frames.values()].reduce((sum, value) => sum + value.bytes, 0);
    for (const [oldKey, old] of this.frames) {
      if (this.frames.size <= 4 && bytes <= 64 * 1024 * 1024) break;
      if (oldKey === key) continue;
      this.frames.delete(oldKey); bytes -= old.bytes; this.retire(old.frame);
    }
  }

  private retire(frame: StabilizedCurrentFrame) {
    void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(() => frame.destroy()).catch(() => undefined);
  }
  destroy() { for (const entry of this.frames.values()) this.retire(entry.frame); this.frames.clear(); }
}
