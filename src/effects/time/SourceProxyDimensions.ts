import { proxyFrameCache } from '../../services/proxyFrameCache';
import { sourceFrameService } from '../../services/mediaRuntime/sourceFrames/SourceFrameService';
import type { MediaFile } from '../../stores/mediaStore/types';
import { recordTemporalPreparation } from './temporalResourcePreparation';

interface Size { width: number; height: number }
interface Entry { media: MediaFile; fps: number; size?: Size; pending?: Promise<void> }

/** Read actual JPEG dimensions before allocating a full-size proxy atlas.
 * No guessed proxy size and no 4K upscaling of every cached historical frame. */
export class SourceProxyDimensions {
  private entries = new Map<string, Entry>();
  private disposed = false;
  resolve(media: MediaFile, fps: number, onReady?: () => void): Size | null | undefined {
    let entry = this.entries.get(media.id);
    if (!entry || entry.media.file !== media.file || entry.media.url !== media.url || entry.fps !== fps
      || entry.media.proxyStatus !== media.proxyStatus || entry.media.proxyFrameCount !== media.proxyFrameCount) {
      entry = { media, fps };
      if (this.entries.size >= 16) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(media.id, entry);
      const owner = entry;
      owner.pending = this.load(media, fps).then(size => { owner.size = size; }, () => undefined)
        .finally(() => { owner.pending = undefined; if (!this.disposed) onReady?.(); });
    }
    if (entry.pending) { recordTemporalPreparation(entry.pending); return null; }
    return entry.size;
  }
  private async load(media: MediaFile, fps: number): Promise<Size | undefined> {
    const image = proxyFrameCache.getNearestCachedFrameEntry(media.id, 0, 0)?.image
      ?? await proxyFrameCache.getFrame(media.id, 0, fps, false);
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return undefined;
    const lease = sourceFrameService.acquire(media);
    try {
      const { rotation } = await lease.ready;
      return rotation % 180 === 0 ? { width: image.naturalWidth, height: image.naturalHeight }
        : { width: image.naturalHeight, height: image.naturalWidth };
    } finally { lease.release(); }
  }
  destroy() { this.disposed = true; this.entries.clear(); }
}
