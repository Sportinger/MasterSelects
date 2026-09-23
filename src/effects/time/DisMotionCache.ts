import { DisFlowGpu } from './DisFlowGpu';
import type { ResidentMotionFrames } from './residentMotionFrames';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { Logger } from '../../services/logger';
import { DisFlowPersistence } from './DisFlowPersistence';
import { readDisTile, uploadDisTile } from './DisFlowTransfer';
import { DisFlowWriteQueue } from './DisFlowWriteQueue';

const log = Logger.create('DisMotion');

/** One bounded field per resident reference PTS, keyed by both exact pair PTS.
 * Threshold, delay and output resolution never invalidate the measured pair.
 * While preparing, the caller must keep the source atlas pinned (no resolve).
 */
export class DisMotionCache {
  private raw?: GPUTexture;
  private volume?: GPUTexture;
  private backwardVolume?: GPUTexture;
  private bidirectional = false;
  private ages?: GPUTexture;
  private gpu?: DisFlowGpu;
  private completed = new Map<number,string>();
  private error?: Error;
  private disposed = false;
  private analysisRevision = 0;
  pending?: Promise<void>;
  progress = '';
  private device: GPUDevice;
  private onReady?: () => void;
  private onStatus?: (status: string) => void;
  constructor(device: GPUDevice, onReady?: () => void, onStatus?: (status: string) => void) {
    this.device = device; this.onReady = onReady; this.onStatus = onStatus;
  }

  resolve(snapshot: ResidentMotionFrames, bidirectional = false): { atlas: ResolvedImageGraphExternalResource; ages: ResolvedImageGraphExternalResource } | undefined {
    if (this.error) throw this.error;
    if (this.pending) return;
    if (bidirectional !== this.bidirectional) {
      this.bidirectional = bidirectional; this.retire(); this.raw = undefined; this.completed.clear();
    }
    if (this.raw !== snapshot.atlas) {
      this.retire(); this.completed.clear(); this.raw = snapshot.atlas;
    }
    const missing = [...snapshot.pairs].filter(([time,target]) => this.completed.get(snapshot.slots.get(time)!) !== `${time}/${target}`);
    if (!this.volume || missing.length) {
      this.progress = `DIS · analysing 0/${missing.length} source pairs`;
      this.onStatus?.(this.progress);
      this.pending = this.prepare(snapshot,missing).catch(error => {
        if (!this.disposed) {
          this.error = error instanceof Error ? error : new Error(String(error));
          log.error(`Source-pair analysis failed: ${this.error.message}`);
          this.onStatus?.(`DIS unavailable: ${this.error.message}`);
        }
        throw error;
      }).finally(() => { this.pending = undefined; if (!this.disposed) this.onReady?.(); });
      void this.pending.catch(() => undefined);
      return;
    }
    const width = snapshot.metadata.length/8;
    if (!this.ages || this.ages.width !== width) {
      const old = this.ages;
      this.ages = this.device.createTexture({ label: 'DIS source clock', size: [width,2],format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      if (old) void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(() => old.destroy());
    }
    this.device.queue.writeTexture({ texture: this.ages },new Float32Array(snapshot.metadata),{ bytesPerRow: width*16,rowsPerImage: 2 },[width,2]);
    const identity = `dis-v1:${snapshot.identity}`;
    return { atlas: { view: this.volume.createView({ dimension: '2d-array' }),identity,
      ...(this.backwardVolume ? { disTrajectory: {
        forward: this.volume.createView({ dimension: '2d-array' }), backward: this.backwardVolume.createView({ dimension: '2d-array' }),
        width: snapshot.width, height: snapshot.height, columns: snapshot.columns, rows: snapshot.rows, identity,
        pairs: [...snapshot.pairs].map(([sourceTime, targetTime]) => ({ sourceTime, targetTime, slot: snapshot.slots.get(sourceTime)! })),
      } } : {}) },
      ages: { view: this.ages.createView(),identity } };
  }

  private async prepare(snapshot: ResidentMotionFrames, missing: [number,number][]) {
    const revision = ++this.analysisRevision;
    const started = performance.now();
    const persistence = await DisFlowPersistence.open(snapshot).catch(() => undefined);
    if (this.disposed) return;
    let loaded = 0, saved = 0, calculated = 0;
    let ready = false;
    const pairBytes = snapshot.width*snapshot.height*8*(this.bidirectional ? 2 : 1);
    const writes = new DisFlowWriteQueue(pairBytes);
    const batchSize = Math.max(1, Math.min(4, Math.floor(64*1024*1024/pairBytes)));
    let cached: [Uint8Array<ArrayBuffer> | undefined, Uint8Array<ArrayBuffer> | undefined][] = [];
    const updateReady = (finished = false) => {
      if (!ready || this.disposed || revision !== this.analysisRevision) return;
      this.progress = persistence ? `DIS · ready · ${loaded} loaded, ${saved}/${calculated} saved${saved<calculated
        ? finished ? ' · cache write unavailable' : ' · saving' : ''}`
        : 'DIS · ready · memory only (project cache unavailable)';
      this.onStatus?.(this.progress);
    };
    if (!this.volume) {
      this.device.pushErrorScope('out-of-memory'); this.device.pushErrorScope('validation');
      try {
        this.volume = this.device.createTexture({ label: 'DIS cached source flow',
          size: [snapshot.width*snapshot.columns,snapshot.height*snapshot.rows,snapshot.layers],format: 'rgba16float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
      } finally {
        const checks = await Promise.all([this.device.popErrorScope(),this.device.popErrorScope()]);
        const error = checks.find(Boolean); if (error) throw new Error(`DIS allocation: ${error.message}`);
      }
    }
    if (this.bidirectional && !this.backwardVolume) {
      this.backwardVolume = this.device.createTexture({ label: 'DIS cached reverse correspondences',
        size: [snapshot.width*snapshot.columns,snapshot.height*snapshot.rows,snapshot.layers], format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    }
    for (let i = 0; i < missing.length; i++) {
      if (this.disposed) return;
      const [time,target] = missing[i];
      const pairStarted = performance.now();
      if (i%batchSize === 0) {
        cached = await Promise.all(missing.slice(i,i+batchSize).map(([source,destination]) => Promise.all([
          persistence?.read(source,destination,false),
          this.bidirectional ? persistence?.read(source,destination,true) : undefined,
        ])));
      }
      const [forward,backward] = cached[i%batchSize];
      cached[i%batchSize] = [undefined,undefined];
      const cacheReadMs = performance.now()-pairStarted;
      if (this.disposed) return;
      if (forward && (!this.bidirectional || backward)) {
        uploadDisTile(this.device,this.volume,snapshot,time,forward);
        if (backward && this.backwardVolume) uploadDisTile(this.device,this.backwardVolume,snapshot,time,backward);
        loaded++;
      } else {
        if (!this.gpu) {
          const gpu = await DisFlowGpu.create(this.device,snapshot.width,snapshot.height);
          if (this.disposed) { gpu.destroy(); return; }
          this.gpu = gpu;
        }
        const gpuStarted = performance.now();
        await this.gpu.pair(snapshot,time,target,this.volume,this.backwardVolume);
        const gpuMs = performance.now()-gpuStarted;
        if (this.disposed) return;
        calculated++;
        if (persistence) {
          const volume = this.volume, reverseVolume = this.backwardVolume;
          await writes.enqueue(async () => {
            if (this.disposed) return;
            try {
              const transferStarted = performance.now();
              const [data,reverse] = await Promise.all([
                readDisTile(this.device,volume,snapshot,time),
                reverseVolume ? readDisTile(this.device,reverseVolume,snapshot,time) : undefined,
              ]);
              const readbackMs = performance.now()-transferStarted;
              const results = await Promise.all([persistence.write(time,target,false,data),
                reverse ? persistence.write(time,target,true,reverse) : true]);
              if (results.every(Boolean)) saved++;
              log.info('DIS pair persisted', { time, target, readbackMs: Math.round(readbackMs) });
              updateReady();
            } catch (error) { log.warn('DIS project cache write failed; analysis remains available in memory', error); }
          });
        }
        log.info('DIS pair analysed', { time, target, width: snapshot.width, height: snapshot.height,
          cacheReadMs: Math.round(cacheReadMs), gpuMs: Math.round(gpuMs), totalMs: Math.round(performance.now()-pairStarted) });
      }
      if (this.disposed) return;
      this.completed.set(snapshot.slots.get(time)!,`${time}/${target}`);
      this.progress = `DIS · ${loaded ? `loaded ${loaded}, ` : ''}analysed ${calculated}/${missing.length} source pairs`;
      // Yield after every submitted pair. Playback gets the GPU between jobs;
      // source resources remain pinned until the entire requested window is ready.
      if (i%8 === 0) { this.onStatus?.(this.progress); this.onReady?.(); }
      await new Promise<void>(resolve => setTimeout(resolve,0));
    }
    log.info('Source-pair analysis ready', { pairs: missing.length, loaded, calculated, saved,
      width: snapshot.width, height: snapshot.height, ms: Math.round(performance.now()-started) });
    ready = true;
    updateReady();
    void writes.drain().then(() => updateReady(true));
  }

  private retire() {
    const volume = this.volume, backward = this.backwardVolume, ages = this.ages, gpu = this.gpu;
    this.volume = undefined; this.backwardVolume = undefined; this.ages = undefined; this.gpu = undefined;
    void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).finally(() => {
      volume?.destroy(); backward?.destroy(); ages?.destroy(); gpu?.destroy();
    });
  }
  destroy() {
    this.disposed = true;
    // Async pipeline creation/pair work owns scratch until its final continuation.
    void (this.pending ?? Promise.resolve()).catch(() => undefined).finally(() => this.retire());
    this.completed.clear();
  }
}
