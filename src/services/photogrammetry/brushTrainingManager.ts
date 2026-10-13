import { isScratchRepository } from '../project/repository/lifecycle/editorRepositoryLifecycle';
import { brushPreviewRuntime } from './brushPreviewRuntime';
import { captureRepositoryDomainPublication } from '../project/repository/artifacts/RepositoryDomainPublication';
import { BrushCheckpointSession, EMPTY_CHECKPOINT, type BrushCheckpointStatus } from './BrushCheckpointSession';
import { BrushCheckpointWriter, readBrushCheckpoint, readCheckpointDataset, type BrushCheckpoint } from './brushCheckpointStorage';
import { readBrushPreviewCameras } from './brushPreviewCameras';
import type { ScanSourceStorage } from './scanSourceProjectStorage';
import { BRUSH_PRESET_CONFIG } from './brushTrainingContract';
import { startBrushTraining, type BrushTrainingController, type BrushTrainingPreset, type BrushTrainingSnapshot } from './brushRuntime';

export interface BrushTrainingJobSnapshot {
  datasetName: string | null;
  preset: BrushTrainingPreset;
  training: BrushTrainingSnapshot | null;
  isStarting: boolean;
  error: string | null;
  checkpoint: BrushCheckpointStatus;
  restored: boolean;
}
type BrushTrainingStarter = typeof startBrushTraining;
const EMPTY_JOB: BrushTrainingJobSnapshot = {
  datasetName: null, preset: 'preview', training: null, isStarting: false, error: null,
  checkpoint: EMPTY_CHECKPOINT, restored: false,
};
const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Owns GPU work and checkpoints independently of mounted panels. */
export class BrushTrainingManager {
  private starter: BrushTrainingStarter;
  private controller: BrushTrainingController | null = null;
  private listeners = new Set<() => void>();
  private jobId = 0;
  private snapshot: BrushTrainingJobSnapshot = EMPTY_JOB;
  private checkpointSession: BrushCheckpointSession | null = null;
  private restored: { checkpoint: BrushCheckpoint; storage: ScanSourceStorage } | null = null;
  private restoreKey: string | null = null;
  constructor(starter: BrushTrainingStarter = startBrushTraining) { this.starter = starter; }
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };

  async start(files: File[], preset: BrushTrainingPreset, datasetName: string, sourceVersion = 0,
    resume?: { checkpoint: BrushCheckpoint; storage: ScanSourceStorage }): Promise<void> {
    const jobId = ++this.jobId;
    this.checkpointSession?.stop(); this.checkpointSession = null;
    this.controller?.cancel(); this.controller = null; this.restored = null;
    this.update({ ...EMPTY_JOB, datasetName, preset, isStarting: true });
    try {
      const storage = resume?.storage ?? (isScratchRepository() ? null : captureRepositoryDomainPublication());
      if (storage) {
        const token = crypto.randomUUID();
        const base = resume?.checkpoint.manifest ?? { version: 1 as const, jobId: token,
          datasetName, datasetPath: `scan-training/${token}/dataset.zip`, preset, sourceVersion,
          totalIterations: BRUSH_PRESET_CONFIG[preset].totalIterations, cameraPath: await readBrushPreviewCameras(files) };
        if (jobId !== this.jobId) return;
        const writer = new BrushCheckpointWriter(storage, files, base, Boolean(resume));
        this.checkpointSession = new BrushCheckpointSession(writer, (checkpoint, manifest) => {
          if (jobId === this.jobId) {
            this.update({ ...this.snapshot, checkpoint });
            if (manifest?.completed) { this.checkpointSession?.stop(); brushPreviewRuntime.freeze(); }
          }
        });
      }
      const controller = await this.starter(files, preset, training => {
        if (jobId !== this.jobId) return;
        this.update({ ...this.snapshot, training });
        this.checkpointSession?.onTraining(training);
      }, resume ? { iteration: resume.checkpoint.manifest.iteration,
        ply: new File([resume.checkpoint.bytes], 'init.ply', { type: 'application/octet-stream' }) } : undefined);
      if (jobId !== this.jobId) { controller.cancel(); return; }
      this.controller = controller;
      this.update({ ...this.snapshot, isStarting: false });
    } catch (error) {
      if (jobId !== this.jobId) return;
      this.checkpointSession?.stop();
      if (resume) { this.showRestored(resume, describeError(error)); return; }
      this.update({ ...this.snapshot, isStarting: false, error: describeError(error) });
    }
  }

  async restoreSaved(storage: ScanSourceStorage, projectKey: string, sourceVersion: number): Promise<void> {
    if (this.controller || this.snapshot.isStarting || this.restoreKey === projectKey) return;
    this.restoreKey = projectKey;
    const jobId = this.jobId;
    try {
      const checkpoint = await readBrushCheckpoint(storage, sourceVersion);
      if (jobId !== this.jobId || !checkpoint) return;
      this.showRestored({ checkpoint, storage });
    } catch (error) {
      if (jobId === this.jobId) this.update({ ...this.snapshot, error: `Could not restore training: ${describeError(error)}` });
    }
  }
  private showRestored(saved: { checkpoint: BrushCheckpoint; storage: ScanSourceStorage }, error: string | null = null): void {
    this.restored = saved;
    const { checkpoint } = saved;
    const manifest = checkpoint.manifest;
    this.update({ datasetName: manifest.datasetName, preset: manifest.preset, isStarting: false, error, restored: true,
      checkpoint: { state: 'saved', iteration: manifest.iteration, savedAt: manifest.savedAt, error: null },
      training: { phase: manifest.completed ? 'completed' : 'paused', iteration: manifest.iteration,
        totalIterations: manifest.totalIterations, splatCount: manifest.splatCount, trainViews: manifest.trainViews,
        evalViews: 0, elapsedMs: 0, psnr: null, ssim: null, warning: null } });
    brushPreviewRuntime.restore(checkpoint.bytes, manifest.iteration, manifest.cameraPath);
  }
  pause(): void { this.controller?.pause(); }
  resume(): void {
    if (this.controller) { this.controller.resume(); return; }
    const saved = this.restored;
    if (!saved || saved.checkpoint.manifest.completed || this.snapshot.isStarting) return;
    const jobId = this.jobId;
    this.update({ ...this.snapshot, isStarting: true, error: null });
    void readCheckpointDataset(saved.storage, saved.checkpoint.manifest).then(files => {
      if (jobId !== this.jobId) return;
      const { preset, datasetName, sourceVersion } = saved.checkpoint.manifest;
      return this.start(files, preset, datasetName, sourceVersion, saved);
    }).catch(error => {
      if (jobId === this.jobId) this.update({ ...this.snapshot, isStarting: false, error: describeError(error) });
    });
  }
  retryCheckpoint(): void { this.checkpointSession?.retry(); }
  cancel(): void {
    if (!this.controller) {
      ++this.jobId;
      this.update({ ...this.snapshot, isStarting: false,
        training: this.snapshot.training ? { ...this.snapshot.training, phase: 'cancelled' } : null });
    } else this.controller.cancel();
    this.checkpointSession?.stop();
  }
  reset(): void {
    ++this.jobId;
    this.checkpointSession?.stop(); this.checkpointSession = null;
    this.controller?.cancel(); this.controller = null; this.restored = null; this.restoreKey = null;
    brushPreviewRuntime.disconnect(); this.update(EMPTY_JOB);
  }
  exportPly(): Promise<Uint8Array> {
    if (this.restored?.checkpoint.manifest.completed) return Promise.resolve(this.restored.checkpoint.bytes.slice());
    if (!this.controller) return Promise.reject(new Error('No Brush training result is available.'));
    return this.controller.exportPly();
  }
  refreshAfterHmr(starter: BrushTrainingStarter): void {
    this.starter = starter;
    this.snapshot = { ...this.snapshot, checkpoint: this.snapshot.checkpoint ?? EMPTY_CHECKPOINT,
      restored: this.snapshot.restored ?? false };
  }
  private update(snapshot: BrushTrainingJobSnapshot): void {
    this.snapshot = snapshot; this.listeners.forEach(listener => listener());
  }
}
const hot = import.meta.hot?.data as { manager?: BrushTrainingManager } | undefined;
export const brushTrainingManager = hot?.manager ?? new BrushTrainingManager();
if (hot?.manager) {
  Object.setPrototypeOf(brushTrainingManager, BrushTrainingManager.prototype);
  brushTrainingManager.refreshAfterHmr(startBrushTraining);
}
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(data => { data.manager = brushTrainingManager; });
}
