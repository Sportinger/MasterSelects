import { BrushCheckpointWriter, type BrushCheckpointManifest } from './brushCheckpointStorage';
import { brushPreviewRuntime } from './brushPreviewRuntime';
import type { BrushTrainingSnapshot } from './brushTrainingContract';

export interface BrushCheckpointStatus {
  state: 'none' | 'saving' | 'saved' | 'error';
  iteration: number;
  savedAt: number | null;
  error: string | null;
}
export const EMPTY_CHECKPOINT: BrushCheckpointStatus = { state: 'none', iteration: 0, savedAt: null, error: null };

/** Job owner, independent of panels. Polls even when Preview and Scan are closed. */
export class BrushCheckpointSession {
  private writer: BrushCheckpointWriter;
  private emit: (status: BrushCheckpointStatus, manifest?: BrushCheckpointManifest) => void;
  private training: BrushTrainingSnapshot | null = null;
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval>;
  private active = true;
  private saving = false;
  private force = true;
  private savedIteration = -1;
  private savedAt = 0;
  private firstRequested = false;

  constructor(writer: BrushCheckpointWriter, emit: BrushCheckpointSession['emit']) {
    this.writer = writer; this.emit = emit;
    this.unsubscribe = brushPreviewRuntime.subscribe(() => { void this.saveLatest(); });
    this.timer = setInterval(() => brushPreviewRuntime.request(), 15_000);
  }
  onTraining(training: BrushTrainingSnapshot): void {
    this.training = training;
    if (training.phase === 'paused' || training.phase === 'completed') {
      this.force = true; brushPreviewRuntime.request();
    } else if (training.iteration > 0 && !this.firstRequested) {
      this.firstRequested = true; brushPreviewRuntime.request();
    }
  }
  retry(): void { this.force = true; brushPreviewRuntime.request(); void this.saveLatest(); }
  stop(): void {
    this.active = false; this.unsubscribe(); clearInterval(this.timer);
  }
  private async saveLatest(): Promise<void> {
    const preview = brushPreviewRuntime.getSnapshot();
    const training = this.training;
    if (!this.active || this.saving || !preview.bytes || !training || preview.iteration < 1) return;
    if (!this.force && (preview.iteration === this.savedIteration || Date.now() - this.savedAt < 15_000)) return;
    // Pause/completion must save the current weights, not an older visible preview.
    if (['paused', 'completed'].includes(training.phase) && preview.iteration !== training.iteration) return;
    this.saving = true; this.force = false;
    this.emit({ state: 'saving', iteration: this.savedIteration, savedAt: this.savedAt || null, error: null });
    try {
      const manifest = await this.writer.save(preview.bytes, {
        iteration: preview.iteration, splatCount: training.splatCount, trainViews: training.trainViews,
        completed: training.phase === 'completed',
      });
      this.savedIteration = manifest.iteration; this.savedAt = manifest.savedAt;
      if (this.active) this.emit({ state: 'saved', iteration: manifest.iteration, savedAt: manifest.savedAt, error: null }, manifest);
    } catch (error) {
      if (this.active) this.emit({ state: 'error', iteration: this.savedIteration, savedAt: this.savedAt || null, error: String(error) });
    } finally {
      this.saving = false;
      if (this.active && this.force) void this.saveLatest();
    }
  }
}
