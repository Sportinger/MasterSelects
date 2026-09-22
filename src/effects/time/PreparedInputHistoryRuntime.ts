import type { MediaFile } from '../../stores/mediaStore/types';
import type { PreparedFrameCache } from './PreparedFrameCache';
import { openPreparedFrameCache } from './openPreparedFrameCache';
import { preparedTemporalMemory, preparedTemporalWindow } from './preparedTemporalWindow';
import { temporalSourceTime, type TemporalClipSource } from './temporalClipSource';
import { recordTemporalPreparation, setTemporalStatus } from './temporalResourcePreparation';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';

type Resources = { atlas: ResolvedImageGraphExternalResource; ages: ResolvedImageGraphExternalResource };
interface Entry {
  media: MediaFile; maxEdge: number; samples: number; abort: AbortController; reader?: PreparedFrameCache;
  pending?: Promise<void>; error?: Error; signature?: string; resources?: Resources;
  atlas?: GPUTexture; ages?: GPUTexture; encoder?: GPUCommandEncoder; effectId: string;
}

/** Bounded independent source decoding. This deliberately samples the source clip boundary. */
export class PreparedInputHistoryRuntime {
  private entries = new Map<string, Entry>();
  private device: GPUDevice;
  private onReady?: () => void;
  constructor(device: GPUDevice, onReady?: () => void) { this.device = device; this.onReady = onReady; }

  resolve(key: string, effectId: string, media: MediaFile, source: TemporalClipSource,
    horizon: number, samples: number, maxEdge: number, encoder: GPUCommandEncoder, interpolation = 'linear'): Resources | undefined {
    // Reserve CPU + GPU worst case before opening a decoder, not just after allocation.
    const memory = preparedTemporalMemory(maxEdge, maxEdge, samples, 128 * 1024 * 1024);
    const window = preparedTemporalWindow({ localTime: source.localTime, duration: source.duration,
      horizon, samples, direction: 'past', sourceTimeAt: time => temporalSourceTime(source, time) });
    const signature = JSON.stringify([window, horizon, maxEdge, interpolation]);
    let entry = this.entries.get(key);
    if (entry && (entry.media.id !== media.id || entry.media.url !== media.url || entry.media.file !== media.file || entry.maxEdge !== maxEdge || entry.samples !== samples)) {
      if (entry.encoder === encoder) throw new Error('Prepared source settings changed within an unsubmitted render frame.');
      this.remove(key); entry = undefined;
    }
    if (!entry) {
      if (this.entries.size >= 2) {
        const old = [...this.entries].find(([, item]) => item.encoder !== encoder);
        if (!old) throw new Error('Prepared frame memory budget supports two simultaneous source owners.');
        this.remove(old[0]);
      }
      entry = { media: { ...media }, maxEdge, samples, abort: new AbortController(), effectId };
      this.entries.set(key, entry);
    }
    entry.encoder = encoder;
    if (entry.error) throw entry.error;
    if (entry.signature === signature && entry.resources) return entry.resources;
    if (!entry.pending) {
      const owner = entry;
      setTemporalStatus(effectId, `Preparing ${samples} source samples…`);
      owner.pending = (async () => {
        const signal = owner.abort.signal;
        owner.reader ??= await openPreparedFrameCache({ url: media.url, file: media.file, maxEdge,
          budgetBytes: memory.cacheBytes, signal });
        const frames = await owner.reader.prepare(window.map(sample => sample.sourceTime), signal);
        signal.throwIfAborted();
        const { width, height } = frames[0].pixels;
        if (frames.some(frame => frame.pixels.width !== width || frame.pixels.height !== height)) {
          throw new Error('Prepared source changes dimensions within the requested window.');
        }
        // The await above yielded past submission of the previous synchronous render.
        // Retire before allocating the replacement so peak allocation respects the budget.
        owner.atlas?.destroy(); owner.ages?.destroy(); owner.resources = undefined;
        owner.atlas = undefined; owner.ages = undefined;
        const atlas = this.device.createTexture({ label: 'prepared-source-atlas', size: [width, height, 64],
          format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        const ages = this.device.createTexture({ label: 'prepared-source-times', size: [65, 1],
          format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        try {
          frames.forEach((frame, index) => this.device.queue.writeTexture({ texture: atlas,
            origin: [0, 0, index] },
          frame.pixels.data as Uint8ClampedArray<ArrayBuffer>, { bytesPerRow: width * 4 }, [width, height]));
          const metadata = new Float32Array(65 * 4);
          window.forEach((sample, index) => { metadata[index * 4] = sample.position * horizon; });
          metadata[256] = samples; metadata[257] = interpolation === 'nearest' ? 1 : 0;
          metadata[258] = 1; metadata[259] = horizon;
          this.device.queue.writeTexture({ texture: ages }, metadata, { bytesPerRow: 65 * 16 }, [65, 1]);
          owner.atlas = atlas; owner.ages = ages; owner.signature = signature;
          owner.resources = { atlas: { view: atlas.createView({ dimension: '2d-array' }), identity: `${key}:${signature}:atlas` },
            ages: { view: ages.createView(), identity: `${key}:${signature}:ages` } };
          setTemporalStatus(effectId, '');
        } catch (error) { atlas.destroy(); ages.destroy(); throw error; }
      })().catch(error => {
        if (owner.abort.signal.aborted) return;
        owner.error = error instanceof Error ? error : new Error(String(error));
        setTemporalStatus(effectId, owner.error.message); throw owner.error;
      }).finally(() => { owner.pending = undefined; this.onReady?.(); });
      void owner.pending.catch(() => undefined);
    }
    recordTemporalPreparation(entry.pending!);
    return undefined;
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.abort.abort(); entry.reader?.close(); entry.atlas?.destroy(); entry.ages?.destroy();
    this.entries.delete(key); setTemporalStatus(entry.effectId, '');
  }
  destroy() { for (const key of this.entries.keys()) this.remove(key); }
  release(key: string) { this.remove(key); }
}
