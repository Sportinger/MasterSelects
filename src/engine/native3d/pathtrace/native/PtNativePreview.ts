import { NativeHelperClient } from '../../../../services/nativeHelper/NativeHelperClient';
import type { OptixPreviewMetrics } from '../../../../services/nativeHelper/nativeHelperOptixPreview';
import type { PtRenderRequest } from '../runtime/PathTraceRuntime';
import { writePtFrame, type PtFrameValues } from '../runtime/ptFrameUniforms';
import type { PtSceneFrame } from '../scene/ptSceneBuilder';
import type { PtStatus } from '../contracts/ptTypes';
import { prepareNativeSnapshot } from './ptNativeSnapshot';
import { PtNativePresent } from './PtNativePresent';

type FrameJob = {
  viewKey: string; sceneKey: string; frame: ArrayBuffer; moving: boolean; samples: number;
  snapshot?: ReturnType<typeof prepareNativeSnapshot>;
};

/** Single-flight native rendering. Scene buffers stay native; camera packets are only 416 bytes. */
export class PtNativePreview {
  private session: { jobId: string; inputPath: string } | null = null;
  private loadedScene = '';
  private remoteView = '';
  private desiredView = '';
  private shownView = '';
  private stableFrame: ArrayBuffer | null = null;
  private busy = false;
  private generation = 0;
  private active = false;
  private lastSignature = '';
  private changedAt = 0;
  private movingScale = .5;
  private viewScale = .5;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private present: PtNativePresent | null = null;
  private metrics: OptixPreviewMetrics | null = null;
  private pendingSnapshot: ReturnType<typeof prepareNativeSnapshot> | null = null;
  failure = '';
  private phase = 'Connecting';
  private size = { width: 1, height: 1 };
  private moving = false;
  private readonly wake: () => void;
  constructor(wake: () => void) { this.wake = wake; }

  tick(request: PtRenderRequest, scene: PtSceneFrame, lights: Float32Array, lightsKey: string,
    frameValues: Omit<PtFrameValues, 'renderSize' | 'jitter' | 'frameIndex' | 'sampleOffset' | 'samples' | 'mode' | 'region'>,
    signature: string, schedule: (afterSubmit: () => void) => void): boolean {
    this.active = true;
    const now = performance.now();
    if (signature !== this.lastSignature) { this.lastSignature = signature; this.changedAt = now; this.viewScale = this.movingScale; }
    this.moving = request.realtime || now - this.changedAt < 180;
    const width = Math.round(request.camera.viewport.width * request.settings.renderScale);
    const height = Math.round(request.camera.viewport.height * request.settings.renderScale);
    const cap = Math.min(1, 1920 / width, 1080 / height);
    const scale = this.moving ? Math.min(cap, 640 / width, 360 / height) * this.viewScale : cap;
    this.size = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    const viewKey = `${signature}|${this.size.width}x${this.size.height}`;
    const sceneKey = `${scene.revision}|${lightsKey}`;
    if (this.desiredView !== viewKey) {
      this.desiredView = viewKey;
      this.stableFrame = writePtFrame({ ...frameValues, renderSize: this.size, jitter: [0, 0],
        frameIndex: 0, sampleOffset: 0, samples: 1, mode: 2, region: [0, 0, 1, 1] });
    }
    if (this.moving && !request.realtime && this.timer === null) {
      this.timer = setTimeout(() => { this.timer = null; this.wake(); }, Math.max(4, 185 - (now - this.changedAt)));
    }
    const current = this.shownView === viewKey;
    const target = this.moving ? 1 : request.settings.stillSamples;
    if (!this.busy && !this.failure && !document.hidden && (!current || !this.metrics || this.metrics.samples < target)) {
      this.busy = true;
      try {
        const snapshot = this.loadedScene !== sceneKey
          ? prepareNativeSnapshot(request.device, request.encoder, scene, this.stableFrame!, lights) : undefined;
        this.pendingSnapshot = snapshot ?? null;
        const job: FrameJob = { viewKey, sceneKey, frame: this.stableFrame!, moving: this.moving,
          samples: Math.max(1, Math.min(this.moving ? 1 : 4, target - (current ? this.metrics?.samples ?? 0 : 0))), snapshot };
        const generation = this.generation;
        // Readbacks are queued in this frame AFTER the fiber emission and are mapped after submission.
        schedule(() => { void this.run(request.device, job, generation); });
      } catch (error) { this.fail(error); this.busy = false; }
    }
    // While a new camera/scene is pending, the caller draws a responsive raster frame.
    return current && !!this.present?.draw(request.encoder, request.sceneView, request.sceneDepthView,
      request.camera.viewport.width, request.camera.viewport.height);
  }

  private async run(device: GPUDevice, job: FrameJob, generation: number) {
    const alive = () => this.active && this.generation === generation;
    const started = performance.now();
    try {
      if (!alive()) return;
      if (!this.session) {
        this.phase = 'Connecting';
        if (!await NativeHelperClient.connect()) throw new Error('Native helper unavailable');
        if (!alive()) return;
        this.session = await NativeHelperClient.optix.preview.open();
      }
      if (!alive()) return;
      const { jobId, inputPath } = this.session;
      if (job.snapshot) {
        this.phase = 'Updating scene';
        const snapshot = await job.snapshot.read();
        if (!alive()) return;
        if (!await NativeHelperClient.writeFileBinary(inputPath, snapshot)) throw new Error('Native scene upload failed');
        if (!alive()) return;
        await NativeHelperClient.optix.preview.load(jobId);
        this.loadedScene = job.sceneKey; this.remoteView = '';
      }
      if (!alive()) return;
      this.phase = 'Rendering';
      const image = await NativeHelperClient.optix.preview.frame(jobId, job.frame, job.samples, this.remoteView !== job.viewKey);
      this.remoteView = job.viewKey;
      if (!alive()) return;
      // Even a superseded camera result measures transport latency. Feed that back
      // before dropping it, so fast navigation can lower resolution and catch up.
      if (job.moving && !job.snapshot) {
        this.movingScale = Math.max(.25, Math.min(1, this.movingScale * Math.sqrt(40 / Math.max(8, performance.now() - started))));
      }
      if (this.desiredView !== job.viewKey) return;
      if (image.metrics.width !== new Float32Array(job.frame)[68] || image.metrics.height !== new Float32Array(job.frame)[69]) {
        throw new Error('Native preview dimensions do not match the requested frame');
      }
      this.present ??= new PtNativePresent(device);
      this.present.upload(image.color, image.depth, image.metrics.width, image.metrics.height);
      this.metrics = image.metrics; this.shownView = job.viewKey; this.phase = '';
    } catch (error) { if (alive()) this.fail(error); }
    finally {
      job.snapshot?.cancel();
      if (this.pendingSnapshot === job.snapshot) this.pendingSnapshot = null;
      if (!alive() || this.failure) {
        const session = this.session; this.session = null; this.loadedScene = this.remoteView = '';
        if (session) await NativeHelperClient.optix.preview.close(session.jobId).catch(() => undefined);
      }
      this.busy = false;
      if (this.active && !document.hidden) this.wake();
    }
  }

  private fail(error: unknown) {
    this.failure = error instanceof Error ? error.message : String(error);
    this.present?.dispose(); this.present = null; this.metrics = null; this.shownView = '';
  }

  status(request: PtRenderRequest, scene: PtSceneFrame): PtStatus {
    const metrics = this.shownView === this.desiredView ? this.metrics : null;
    const samples = metrics?.samples ?? 0;
    return { engine: 'path-traced', previewBackend: 'optix', nativeMessage: this.phase,
      state: this.moving ? 'realtime' : samples >= request.settings.stillSamples ? 'converged' : 'converging',
      samples, partialSample: metrics?.partialSample ?? 0, targetSamples: request.settings.stillSamples,
      frameMs: metrics?.totalMs ?? 0, renderSize: this.size, segments: scene.stats.segments,
      bvhNodes: scene.stats.bvhNodes, gpuBytes: scene.stats.gpuBytes + this.size.width * this.size.height * 20 };
  }

  stop() {
    if (!this.active && !this.failure) return;
    this.active = false; this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.failure = ''; this.phase = 'Connecting';
    this.pendingSnapshot?.cancel(); this.pendingSnapshot = null;
    this.present?.dispose(); this.present = null; this.metrics = null;
    this.shownView = this.desiredView = this.lastSignature = ''; this.stableFrame = null;
    if (!this.busy && this.session) {
      const session = this.session; this.session = null; this.loadedScene = this.remoteView = '';
      void NativeHelperClient.optix.preview.close(session.jobId).catch(() => undefined);
    }
  }
}
