import type { MediaFile } from '../../stores/mediaStore';
import type { BrushPreviewSnapshot } from './brushPreviewRuntime';
import type { BrushTrainingJobSnapshot } from './brushTrainingManager';
import type { SolvedCameraPath } from './cameraSolvePoses';

export type BrushTimelineSplatStatus = 'idle' | 'placing' | 'live' | 'final' | 'removed' | 'error';

export interface BrushTimelineSplatState {
  status: BrushTimelineSplatStatus;
  mediaFileId: string | null;
  /** Training step currently shown by the timeline splat. */
  iteration: number;
  error: string | null;
}

interface Store<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }

/** Editor wiring. Injected so the job logic stays testable without a GPU or stores. */
export interface BrushTimelineSplatDeps {
  preview: Store<BrushPreviewSnapshot> & { request(): void };
  training: Store<BrushTrainingJobSnapshot>;
  importSplat(file: File): Promise<MediaFile>;
  findMedia(id: string): MediaFile | undefined;
  findMediaByName(name: string): MediaFile | undefined;
  /** Scene keys of the active timeline's clips that show this media file. */
  sceneKeysForMedia(mediaFileId: string): string[];
  placeOnTimeline(file: File, media: MediaFile, camera: SolvedCameraPath | null): Promise<string>;
  /** Scene key a clip of this media file renders under. */
  sceneKeyForMedia(media: MediaFile): string;
  /** Point every active-timeline clip of `from` at `to`; returns the moved clip count. */
  repointClips(from: string, to: MediaFile, sceneKey: string): number;
  removeMediaIfUnused(id: string): void;
  replaceScene(sceneKey: string, file: File): Promise<boolean>;
  /** Drop a replacement; `release` also frees its uploaded scene. */
  forgetScene(sceneKey: string, release: boolean): void;
  requestRender(): void;
  log(message: string, data?: unknown): void;
  setInterval(callback: () => void, ms: number): () => void;
  isDocumentVisible(): boolean;
}

export const LIVE_SPLAT_REFRESH_MS = 5_000;
const IDLE: BrushTimelineSplatState = { status: 'idle', mediaFileId: null, iteration: 0, error: null };
const ACTIVE_PHASES = new Set(['loading-runtime', 'loading-dataset', 'training', 'paused']);

export function scanSplatFile(bytes: Uint8Array, datasetName: string, kind: 'training' | 'trained'): File {
  const safeName = datasetName.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'browser-scan';
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], `${safeName}-${kind}.ply`, { type: 'application/octet-stream' });
}

/**
 * Keeps one timeline splat clip in step with a running Brush training.
 *
 * The first live snapshot enters Media as `<dataset>-training.ply` and is placed
 * on the timeline with its training camera. Later snapshots replace that clip's
 * GPU scene in place, so the normal Preview camera can orbit while the splat
 * improves. On completion the final PLY becomes `<dataset>-trained.ply`, the
 * clip is moved onto it, and the unused intermediate media item is removed.
 * Restored snapshots only update an existing live clip; they never add one.
 */
export class BrushTimelineSplat {
  private readonly deps: BrushTimelineSplatDeps;
  private state: BrushTimelineSplatState = IDLE;
  private listeners = new Set<() => void>();
  private appliedBytes: Uint8Array | null = null;
  private placeRequested = false;
  private wasStarting = false;
  private datasetName: string | null = null;
  private busy = false;
  private dirty = false;
  private readonly disposers: Array<() => void>;

  constructor(deps: BrushTimelineSplatDeps) {
    this.deps = deps;
    const job = deps.training.getSnapshot();
    this.datasetName = job.datasetName; this.wasStarting = job.isStarting;
    this.disposers = [
      deps.preview.subscribe(() => { void this.sync(); }),
      deps.training.subscribe(() => { this.onTraining(); void this.sync(); }),
      deps.setInterval(() => this.poll(), LIVE_SPLAT_REFRESH_MS),
    ];
  }

  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };

  /** Explicit request, also after the user removed the live clip or for a restored job. */
  showOnTimeline(): void {
    this.placeRequested = true;
    if (this.state.status === 'removed' || this.state.status === 'error') this.update(IDLE);
    this.appliedBytes = null;
    if (!this.deps.preview.getSnapshot().bytes) this.deps.preview.request();
    void this.sync();
  }

  dispose(): void { this.disposers.forEach(dispose => dispose()); this.listeners.clear(); }

  /** A different dataset or project, or a new run after a finished binding, starts over. */
  private onTraining(): void {
    const job = this.deps.training.getSnapshot();
    const restarted = job.isStarting && !this.wasStarting && ['final', 'removed', 'error'].includes(this.state.status);
    this.wasStarting = job.isStarting;
    if (job.datasetName === this.datasetName && !restarted) return;
    this.datasetName = job.datasetName;
    this.appliedBytes = null; this.placeRequested = false;
    if (this.state !== IDLE) this.update(IDLE);
  }

  /** Training snapshots cost a short pause in the worker; poll only while they are shown. */
  private poll(): void {
    const preview = this.deps.preview.getSnapshot();
    if (!preview.connected || !preview.updating || !this.deps.isDocumentVisible()) return;
    const media = this.state.mediaFileId;
    const awaitingFirst = this.state.status === 'idle' && !preview.bytes;
    const showing = this.state.status === 'live' && media !== null && this.deps.sceneKeysForMedia(media).length > 0;
    if (awaitingFirst || showing) this.deps.preview.request();
  }

  private async sync(): Promise<void> {
    if (this.busy) { this.dirty = true; return; }
    this.busy = true;
    try {
      do { this.dirty = false; await this.step(); } while (this.dirty);
    } finally { this.busy = false; }
  }

  private async step(): Promise<void> {
    const preview = this.deps.preview.getSnapshot();
    const job = this.deps.training.getSnapshot();
    const bytes = preview.bytes;
    if (!bytes || !job.datasetName || this.state.status === 'final') return;
    const training = job.training;
    const final = training?.phase === 'completed' && preview.iteration >= training.iteration;
    try {
      const media = this.resolveMedia(job.datasetName);
      if (!media) {
        if (this.state.mediaFileId) {
          // The user deleted the live media item: respect that until asked again.
          this.update({ ...IDLE, status: 'removed' });
          return;
        }
        const live = preview.updating && ACTIVE_PHASES.has(training?.phase ?? '');
        if (this.state.status === 'removed' || this.state.status === 'error') return;
        if (!live && !this.placeRequested) return;
        await this.place(bytes, job.datasetName, preview);
      } else {
        if (this.placeRequested && this.deps.sceneKeysForMedia(media.id).length === 0) {
          // The live media survived but its clip was deleted: place it again.
          await this.deps.placeOnTimeline(media.file ?? scanSplatFile(bytes, job.datasetName, 'training'), media, preview.cameraPath);
          this.placeRequested = false; this.appliedBytes = null;
        }
        if (bytes !== this.appliedBytes) await this.replace(media, bytes, job.datasetName, preview.iteration);
      }
      if (final && this.state.mediaFileId) await this.finalize(this.state.mediaFileId, bytes, job.datasetName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.log('Live timeline splat failed', { error: message });
      this.update({ ...this.state, status: this.state.status === 'placing' ? 'error' : this.state.status, error: message });
    }
  }

  private resolveMedia(datasetName: string): MediaFile | undefined {
    if (this.state.mediaFileId) return this.deps.findMedia(this.state.mediaFileId);
    // A dismissed or failed binding waits for an explicit Show on timeline.
    if ((this.state.status === 'removed' || this.state.status === 'error') && !this.placeRequested) return undefined;
    // After a reload the binding is gone; reattach to the job's existing live clip.
    const existing = this.deps.findMediaByName(scanSplatFile(new Uint8Array(), datasetName, 'training').name);
    if (existing) this.update({ ...this.state, status: 'live', mediaFileId: existing.id, error: null });
    return existing;
  }

  private async place(bytes: Uint8Array, datasetName: string, preview: BrushPreviewSnapshot): Promise<void> {
    this.update({ ...this.state, status: 'placing', error: null });
    const file = scanSplatFile(bytes, datasetName, 'training');
    const media = await this.deps.importSplat(file);
    await this.deps.placeOnTimeline(file, media, preview.cameraPath);
    this.appliedBytes = bytes; this.placeRequested = false;
    this.update({ status: 'live', mediaFileId: media.id, iteration: preview.iteration, error: null });
    this.deps.log('Placed live training splat on the timeline', { media: media.name, iteration: preview.iteration });
  }

  private async replace(media: MediaFile, bytes: Uint8Array, datasetName: string, iteration: number): Promise<void> {
    const sceneKeys = this.deps.sceneKeysForMedia(media.id);
    // No visible clip (deleted or in another composition): catch up on the next snapshot.
    if (sceneKeys.length === 0) return;
    const file = scanSplatFile(bytes, datasetName, 'training');
    let applied = false;
    for (const sceneKey of sceneKeys) applied = await this.deps.replaceScene(sceneKey, file) || applied;
    if (!applied) return;
    this.appliedBytes = bytes;
    this.deps.requestRender();
    this.update({ ...this.state, status: 'live', iteration, error: null });
  }

  private async finalize(liveMediaId: string, bytes: Uint8Array, datasetName: string): Promise<void> {
    const staleKeys = this.deps.sceneKeysForMedia(liveMediaId);
    const file = scanSplatFile(bytes, datasetName, 'trained');
    const finalMedia = await this.deps.importSplat(file);
    const sceneKey = this.deps.sceneKeyForMedia(finalMedia);
    // Upload before switching so the clip never shows an empty frame while loading.
    if (staleKeys.length > 0) await this.deps.replaceScene(sceneKey, file);
    const moved = this.deps.repointClips(liveMediaId, finalMedia, sceneKey);
    this.deps.forgetScene(sceneKey, false);
    staleKeys.filter(key => key !== sceneKey).forEach(key => this.deps.forgetScene(key, true));
    this.deps.removeMediaIfUnused(liveMediaId);
    this.deps.requestRender();
    this.update({ ...this.state, status: 'final', mediaFileId: finalMedia.id, error: null });
    this.deps.log('Moved the live training splat onto the final result', { media: finalMedia.name, clips: moved });
  }

  private update(state: BrushTimelineSplatState): void {
    this.state = state; this.listeners.forEach(listener => listener());
  }
}
