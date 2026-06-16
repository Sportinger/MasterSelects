import { Logger } from '../../../services/logger';
import { vfPipelineMonitor } from '../../../services/vfPipelineMonitor';

const log = Logger.create('ScrubbingCache');

export class LastFrameCache {
  private readonly device: GPUDevice;
  private textures: Map<HTMLVideoElement, GPUTexture> = new Map();
  private views: Map<HTMLVideoElement, GPUTextureView> = new Map();
  private sizes: Map<HTMLVideoElement, { width: number; height: number }> = new Map();
  private mediaTimes: Map<HTMLVideoElement, number> = new Map();
  private owners = new WeakMap<HTMLVideoElement, string>();
  private captureTimes: Map<HTMLVideoElement, number> = new Map();
  private presentedTimes = new WeakMap<HTMLVideoElement, number>();
  private presentedOwners = new WeakMap<HTMLVideoElement, string>();
  private lastOwnerMissSignature = new WeakMap<HTMLVideoElement, string>();
  private lastOwnerMissAt = new WeakMap<HTMLVideoElement, number>();
  private allocations = 0;
  private reuses = 0;
  private releases = 0;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  captureVideoFrame(video: HTMLVideoElement, ownerId?: string): boolean {
    if (video.videoWidth === 0 || video.videoHeight === 0) return false;

    const width = video.videoWidth;
    const height = video.videoHeight;
    const existingTexture = this.textures.get(video);
    const existingSize = this.sizes.get(video);
    const canReuseExisting =
      !!existingTexture &&
      !!existingSize &&
      existingSize.width === width &&
      existingSize.height === height;

    let texture = existingTexture;
    let view = this.views.get(video);
    let createdFreshTexture = false;

    if (!canReuseExisting) {
      texture = this.device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      view = texture.createView();
      createdFreshTexture = true;
    }

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video },
        { texture: texture! },
        [width, height]
      );
      if (createdFreshTexture) {
        this.textures.set(video, texture!);
        this.views.set(video, view!);
        this.sizes.set(video, { width, height });
        this.allocations += 1;
      } else {
        this.reuses += 1;
      }
      this.mediaTimes.set(video, video.currentTime);
      if (ownerId) {
        this.owners.set(video, ownerId);
      }
      return true;
    } catch {
      if (createdFreshTexture) {
        texture?.destroy();
      }
      return false;
    }
  }

  async captureVideoFrameViaImageBitmap(video: HTMLVideoElement, ownerId?: string): Promise<boolean> {
    if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
      return false;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    try {
      const bitmap = await createImageBitmap(video);
      let texture = this.textures.get(video);
      const existingSize = this.sizes.get(video);

      if (!texture || !existingSize || existingSize.width !== width || existingSize.height !== height) {
        texture = this.device.createTexture({
          size: [width, height],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.textures.set(video, texture);
        this.sizes.set(video, { width, height });
        this.views.set(video, texture.createView());
        this.allocations += 1;
      } else {
        this.reuses += 1;
      }

      this.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        [width, height]
      );
      bitmap.close();
      this.mediaTimes.set(video, video.currentTime);
      if (ownerId) {
        this.owners.set(video, ownerId);
      }
      log.debug('Pre-cached video frame via createImageBitmap', { width, height });
      return true;
    } catch (e) {
      log.warn('captureVideoFrameViaImageBitmap failed', e);
      return false;
    }
  }

  captureVideoFrameAtTime(video: HTMLVideoElement, mediaTime: number, ownerId?: string): boolean {
    const captured = this.captureVideoFrame(video, ownerId);
    if (captured && Number.isFinite(mediaTime)) {
      this.mediaTimes.set(video, mediaTime);
    }
    return captured;
  }

  captureVideoFrameIfCloser(
    video: HTMLVideoElement,
    targetTime: number,
    candidateTime: number,
    ownerId?: string,
    minIntervalMs: number = 50
  ): boolean {
    if (!Number.isFinite(candidateTime) || !Number.isFinite(targetTime)) {
      return false;
    }

    const existing = this.getLastFrame(video, ownerId);
    const existingDrift =
      typeof existing?.mediaTime === 'number' && Number.isFinite(existing.mediaTime)
        ? Math.abs(existing.mediaTime - targetTime)
        : Number.POSITIVE_INFINITY;
    const candidateDrift = Math.abs(candidateTime - targetTime);

    if (candidateDrift + 0.001 >= existingDrift) {
      return false;
    }

    const now = performance.now();
    const lastCapture = this.getLastCaptureTime(video);
    if (now - lastCapture < minIntervalMs) {
      return false;
    }

    const captured = this.captureVideoFrameAtTime(video, candidateTime, ownerId);
    if (captured) {
      this.setLastCaptureTime(video, now);
    }
    return captured;
  }

  getLastFrame(
    video: HTMLVideoElement,
    ownerId?: string
  ): { view: GPUTextureView; width: number; height: number; mediaTime?: number } | null {
    const view = this.views.get(video);
    const size = this.sizes.get(video);
    const owner = this.owners.get(video);
    if (ownerId && owner !== ownerId) {
      const now = performance.now();
      const signature = `${ownerId}:${owner ?? 'none'}`;
      const lastSignature = this.lastOwnerMissSignature.get(video);
      const lastAt = this.lastOwnerMissAt.get(video) ?? 0;
      if (signature !== lastSignature || now - lastAt > 120) {
        this.lastOwnerMissSignature.set(video, signature);
        this.lastOwnerMissAt.set(video, now);
        vfPipelineMonitor.record('vf_scrub_owner_miss', {
          requestedClipId: ownerId,
          cachedClipId: owner ?? 'none',
          cachedTimeMs: Math.round((this.mediaTimes.get(video) ?? -1) * 1000),
          currentTimeMs: Math.round(video.currentTime * 1000),
        });
      }
      return null;
    }
    if (view && size) {
      this.reuses += 1;
      return {
        view,
        width: size.width,
        height: size.height,
        mediaTime: this.mediaTimes.get(video),
      };
    }
    return null;
  }

  getLastFrameOwner(video: HTMLVideoElement): string | undefined {
    return this.owners.get(video);
  }

  getLastFrameNearTime(
    video: HTMLVideoElement,
    targetTime: number,
    maxDeltaSeconds: number,
    ownerId?: string
  ): { view: GPUTextureView; width: number; height: number; mediaTime?: number } | null {
    const frame = this.getLastFrame(video, ownerId);
    if (!frame) return null;

    const frameTime = frame.mediaTime;
    if (typeof frameTime !== 'number' || !Number.isFinite(frameTime)) {
      return null;
    }

    return Math.abs(frameTime - targetTime) <= maxDeltaSeconds ? frame : null;
  }

  getLastCaptureTime(video: HTMLVideoElement): number {
    return this.captureTimes.get(video) || 0;
  }

  setLastCaptureTime(video: HTMLVideoElement, time: number): void {
    this.captureTimes.set(video, time);
  }

  getLastPresentedTime(video: HTMLVideoElement): number | undefined {
    return this.presentedTimes.get(video);
  }

  getLastPresentedOwner(video: HTMLVideoElement): string | undefined {
    return this.presentedOwners.get(video);
  }

  markFramePresented(video: HTMLVideoElement, time: number = video.currentTime, ownerId?: string): void {
    if (Number.isFinite(time)) {
      this.presentedTimes.set(video, time);
    }
    if (ownerId) {
      this.presentedOwners.set(video, ownerId);
    }
  }

  cleanupVideo(video: HTMLVideoElement): void {
    const texture = this.textures.get(video);
    if (texture) {
      texture.destroy();
      this.releases += 1;
    }
    this.textures.delete(video);
    this.views.delete(video);
    this.sizes.delete(video);
    this.mediaTimes.delete(video);
    this.owners.delete(video);
    this.captureTimes.delete(video);
    this.presentedTimes.delete(video);
    this.presentedOwners.delete(video);
  }

  clearAll(): void {
    this.releases += this.textures.size;
    for (const texture of this.textures.values()) {
      texture.destroy();
    }
    this.textures.clear();
    this.views.clear();
    this.sizes.clear();
    this.mediaTimes.clear();
    this.owners = new WeakMap();
    this.captureTimes.clear();
    this.presentedTimes = new WeakMap();
    this.presentedOwners = new WeakMap();
  }

  getRuntimeCacheSnapshot(): {
    entries: number;
    bytes: number;
    allocations: number;
    reuses: number;
    releases: number;
  } {
    let bytes = 0;
    for (const size of this.sizes.values()) {
      bytes += size.width * size.height * 4;
    }
    return {
      entries: this.textures.size,
      bytes,
      allocations: this.allocations,
      reuses: this.reuses,
      releases: this.releases,
    };
  }
}
