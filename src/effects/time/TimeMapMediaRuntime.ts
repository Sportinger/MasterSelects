import type { MediaFile } from '../../stores/mediaStore/types';
import { sourceFrameService, type SourceFrameLease } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';
import { TemporalFrameUploader } from '../../engine/texture/TemporalFrameUploader';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { recordTemporalPreparation, setTemporalStatus } from './temporalResourcePreparation';

interface Entry {
  mediaId: string; url: string; file?: File; effectId: string;
  abort: AbortController; reader?: SourceFrameLease; pending?: Promise<void>;
  time?: number; transformKey?: string; texture?: GPUTexture; view?: GPUTextureView; identity?: string; error?: Error;
  encoder?: GPUCommandEncoder;
}

/** Shared source decoding and one bounded GPU texture per map owner. */
export class TimeMapMediaRuntime {
  private readonly device: GPUDevice;
  private readonly onReady?: () => void;
  private uploader?: TemporalFrameUploader;
  private entries = new Map<string, Entry>();
  constructor(device: GPUDevice, onReady?: () => void) { this.device = device; this.onReady = onReady; }

  resolve(key: string, effectId: string, media: MediaFile, requestedTime: number, encoder: GPUCommandEncoder, outputToSource?: readonly number[]): ResolvedImageGraphExternalResource | undefined {
    if (!Number.isFinite(requestedTime)) throw new Error('Time map timestamp must be finite.');
    if (media.type !== 'image' && media.type !== 'video') throw new Error('Time maps require an image or video asset.');
    const transformKey = JSON.stringify(outputToSource ?? null);
    const time = media.type === 'image' ? 0 : Math.max(0, requestedTime);
    let entry = this.entries.get(key);
    if (entry && (entry.mediaId !== media.id || entry.url !== media.url || entry.file !== media.file)) { this.remove(key); entry = undefined; }
    if (!entry) {
      if (this.entries.size >= 4) {
        const retired = [...this.entries].find(([, item]) => item.encoder !== encoder);
        if (!retired) throw new Error('Time map budget supports at most four simultaneous map owners.');
        this.remove(retired[0]);
      }
      entry = { mediaId: media.id, url: media.url, file: media.file, effectId, abort: new AbortController() };
      this.entries.set(key, entry);
    }
    entry.encoder = encoder;
    if (entry.error) { setTemporalStatus(effectId, entry.error.message); throw entry.error; }
    if (entry.time === time && entry.transformKey === transformKey && entry.view) {
      setTemporalStatus(effectId, '');
      return { view: entry.view, identity: entry.identity! };
    }
    if (!entry.pending) {
      const owner = entry;
      setTemporalStatus(effectId, 'Preparing time map…');
      owner.pending = this.prepare(owner, media, time, outputToSource ? [...outputToSource] : undefined, transformKey).catch(error => {
        if (owner.abort.signal.aborted) return;
        owner.error = error instanceof Error ? error : new Error(String(error));
        setTemporalStatus(effectId, owner.error.message);
        throw owner.error;
      }).finally(() => { owner.pending = undefined; this.onReady?.(); });
      // Preview reads status, while the export collector awaits the rejecting original.
      void owner.pending.catch(() => undefined);
    }
    recordTemporalPreparation(entry.pending!);
    return undefined;
  }

  private async prepare(entry: Entry, media: MediaFile, time: number, outputToSource: readonly number[] | undefined, transformKey: string) {
    const signal = entry.abort.signal;
    let pixels: ImageData;
    if (media.type === 'video') {
      entry.reader ??= sourceFrameService.acquire({ id: media.id, url: media.url, file: media.file });
      const reader = await entry.reader.ready;
      signal.throwIfAborted();
      const scale = Math.min(1, 640 / Math.max(reader.width, reader.height));
      const texture = this.device.createTexture({ label: 'slit-scan-time-map',
        size: [Math.max(1, Math.round(reader.width * scale)), Math.max(1, Math.round(reader.height * scale))],
        format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      let sourceTime: number | undefined;
      try {
        await entry.reader.request({ times: [time], priority: 'required', signal, onFrame: surface => {
          signal.throwIfAborted();
          this.uploader ??= new TemporalFrameUploader(this.device);
          this.uploader.upload(surface, texture, 0, outputToSource);
          sourceTime = surface.time;
        } });
        signal.throwIfAborted();
        if (sourceTime === undefined) throw new Error('Time map decoder returned no frame.');
      } catch (error) { texture.destroy(); throw error; }
      entry.texture?.destroy(); entry.texture = texture; entry.view = texture.createView();
      entry.time = time; entry.transformKey = transformKey;
      entry.identity = `${entry.mediaId}:${sourceTime}:${transformKey}`;
      return;
    } else {
      const blob = media.file ?? await fetch(media.url, { signal }).then(response => {
        if (!response.ok) throw new Error(`Time map image failed to load (${response.status}).`);
        return response.blob();
      });
      signal.throwIfAborted();
      if (!blob) throw new Error('Time map image has no readable data.');
      const bitmap = await createImageBitmap(blob);
      try {
        signal.throwIfAborted();
        const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not create time map image canvas.');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      } finally { bitmap.close(); }
    }
    signal.throwIfAborted();
    const texture = this.device.createTexture({ label: 'slit-scan-time-map', size: [pixels.width, pixels.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture }, pixels.data as Uint8ClampedArray<ArrayBuffer>, { bytesPerRow: pixels.width * 4 }, [pixels.width, pixels.height]);
    // Preparation yields before replacement: the preceding synchronous render has submitted.
    entry.texture?.destroy(); entry.texture = texture; entry.view = texture.createView();
    entry.time = time; entry.transformKey = transformKey; entry.identity = `${entry.mediaId}:${time}`;
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.abort.abort(); entry.reader?.release(); entry.texture?.destroy();
    this.entries.delete(key); setTemporalStatus(entry.effectId, '');
  }
  destroy() { for (const key of this.entries.keys()) this.remove(key); this.uploader?.destroy(); }
}
