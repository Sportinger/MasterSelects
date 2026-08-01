import type { TextureFillAppearance } from '../../../types/motionDesign';
import { useMediaStore } from '../../../stores/mediaStore';
import { resolveMediaFileSourceFile } from '../../../stores/mediaStore/slices/fileManage/sourceResolution';
import {
  buildMotionMediaReuseKey,
} from '../../../services/motionDesign/media/reuseKeyPlanner';
import { createMotionMediaSourceReference } from '../../../services/motionDesign/media/sourceReferencePlanner';
import { resolveMotionMediaSourceTime } from '../../../services/motionDesign/media/timingPlanner';
import type {
  MotionMediaRenderParameters,
  MotionMediaResolvedTime,
  MotionMediaSourceReference,
} from '../../../services/motionDesign/media/contracts';

const MAX_CACHED_TEXTURES = 32;

export type MotionTextureAcquisitionStatus = 'ready' | 'pending' | 'missing';

export interface MotionTextureAcquisitionResult {
  status: MotionTextureAcquisitionStatus;
  textureView?: GPUTextureView;
  sourceSize?: { width: number; height: number };
  reuseKey?: string;
}

export interface TextureFillUvInput {
  point: { x: number; y: number };
  shapeSize: { width: number; height: number };
  textureSize: { width: number; height: number };
  appearance: Pick<TextureFillAppearance, 'fit' | 'transform'>;
}

export interface TextureFillUvResult {
  u: number;
  v: number;
  covered: boolean;
}

interface CachedTexture {
  texture: GPUTexture;
  view: GPUTextureView;
  sourceSize: { width: number; height: number };
  releaseExtraction?: () => void;
}

export interface MotionTextureVideoFrame {
  bitmap: ImageBitmap;
  /** Releases the decoder/element resources retained for this cached frame. */
  release?: () => void;
}

export interface MotionTextureAcquisitionDependencies {
  findMediaFile?: (mediaFileId: string) => ReturnType<typeof useMediaStore.getState>['files'][number] | undefined;
  resolveFile?: typeof resolveMediaFileSourceFile;
  decodeImage?: (file: Blob) => Promise<ImageBitmap>;
  /**
   * Extracts one frozen video frame. The default is a browser seek fallback;
   * it is frame-accurate only to the browser decoder's seek precision.
   */
  extractVideoFrame?: (file: Blob, resolvedTimeSeconds: number) => Promise<MotionTextureVideoFrame>;
  onDiagnostic?: (code: 'TEXTURE_MEDIA_MISSING', message: string) => void;
}

/**
 * Still image textures are capped by a 32-entry LRU.  Entries are destroyed on
 * eviction, and callers can explicitly release a reuse key or the whole cache.
 */
export class MotionTextureAcquisition {
  private readonly device: GPUDevice;
  private readonly cache = new Map<string, CachedTexture>();
  private readonly readyKeys = new Map<string, string>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly missing = new Map<string, string>();
  private readonly findMediaFile: NonNullable<MotionTextureAcquisitionDependencies['findMediaFile']>;
  private readonly resolveFile: NonNullable<MotionTextureAcquisitionDependencies['resolveFile']>;
  private readonly decodeImage: NonNullable<MotionTextureAcquisitionDependencies['decodeImage']>;
  private readonly extractVideoFrame: NonNullable<MotionTextureAcquisitionDependencies['extractVideoFrame']>;
  private readonly onDiagnostic?: MotionTextureAcquisitionDependencies['onDiagnostic'];

  constructor(
    device: GPUDevice,
    dependencies: MotionTextureAcquisitionDependencies = {},
  ) {
    this.device = device;
    this.findMediaFile = dependencies.findMediaFile
      ?? ((mediaFileId) => useMediaStore.getState().files.find((file) => file.id === mediaFileId));
    this.resolveFile = dependencies.resolveFile ?? resolveMediaFileSourceFile;
    this.decodeImage = dependencies.decodeImage ?? ((file) => createImageBitmap(file));
    this.extractVideoFrame = dependencies.extractVideoFrame ?? extractVideoFrameWithSeek;
    this.onDiagnostic = dependencies.onDiagnostic;
  }

  acquire(
    appearance: TextureFillAppearance,
    onComplete: () => void,
  ): MotionTextureAcquisitionResult {
    const mediaFileId = appearance.mediaFileId;
    if (!mediaFileId) {
      return this.reportMissing('texture-fill has no mediaFileId');
    }

    const mediaFile = this.findMediaFile(mediaFileId);
    const source = mediaFile ? this.createSource(mediaFileId, mediaFile.type, mediaFile.duration) : null;
    if (!mediaFile || !source) {
      return this.reportMissing(`texture-fill media is unavailable or invalid: ${mediaFileId}`);
    }
    const resolvedTime = resolveTextureFillTime(source, appearance.time);

    const signature = `${source.sourceId}:${JSON.stringify(resolvedTime)}:${JSON.stringify(appearance.transform)}:${appearance.fit}`;
    const cachedKey = this.readyKeys.get(signature);
    if (cachedKey) {
      const cached = this.takeCached(cachedKey);
      if (cached) return readyResult(cachedKey, cached);
      this.readyKeys.delete(signature);
    }
    const knownSize = validSize(mediaFile.width, mediaFile.height);
    if (knownSize) {
      const knownKey = buildTextureReuseKey(source.sourceId, appearance, knownSize, resolvedTime);
      const cached = this.takeCached(knownKey);
      if (cached) return readyResult(knownKey, cached);
    }

    if (this.missing.has(signature)) return { status: 'missing' };
    if (!this.pending.has(signature)) {
      const task = this.load(source, resolvedTime, mediaFileId, appearance, signature)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'unable to decode texture-fill media';
          this.missing.set(signature, message);
          // MotionDiagnostics currently exposes only TEXTURE_MEDIA_MISSING.
          // Preserve that public diagnostic envelope while making video decode
          // failures distinguishable to callers by their stable message prefix.
          this.onDiagnostic?.('TEXTURE_MEDIA_MISSING', mediaFile.type === 'video'
            ? `TEXTURE_VIDEO_FRAME_UNAVAILABLE: ${message}`
            : message);
        })
        .finally(() => {
          this.pending.delete(signature);
          onComplete();
        });
      this.pending.set(signature, task);
    }
    return { status: 'pending' };
  }

  release(reuseKey: string): void {
    const cached = this.cache.get(reuseKey);
    if (!cached) return;
    cached.texture.destroy();
    cached.releaseExtraction?.();
    this.cache.delete(reuseKey);
    for (const [signature, cachedKey] of this.readyKeys) {
      if (cachedKey === reuseKey) this.readyKeys.delete(signature);
    }
  }

  destroy(): void {
    for (const cached of this.cache.values()) {
      cached.texture.destroy();
      cached.releaseExtraction?.();
    }
    this.cache.clear();
    this.readyKeys.clear();
    this.pending.clear();
    this.missing.clear();
  }

  private async load(
    source: MotionMediaSourceReference,
    resolvedTime: MotionMediaResolvedTime,
    mediaFileId: string,
    appearance: TextureFillAppearance,
    signature: string,
  ): Promise<void> {
    const mediaFile = this.findMediaFile(mediaFileId);
    if (!mediaFile || (mediaFile.type !== 'image' && mediaFile.type !== 'video')) {
      throw new Error(`texture-fill media is unavailable: ${mediaFileId}`);
    }
    const file = await this.resolveFile(mediaFile);
    if (!file) throw new Error(`texture-fill media file cannot be resolved: ${mediaFileId}`);

    const extracted = mediaFile.type === 'video'
      ? await this.extractVideoFrame(file, resolvedTime.seconds)
      : { bitmap: await this.decodeImage(file) };
    const { bitmap } = extracted;
    let retainedExtraction = false;
    try {
      const sourceSize = validSize(bitmap.width, bitmap.height);
      if (!sourceSize) throw new Error(`texture-fill media has invalid dimensions: ${mediaFileId}`);
      const reuseKey = buildTextureReuseKey(source.sourceId, appearance, sourceSize, resolvedTime);
      if (this.cache.has(reuseKey)) {
        return;
      }
      const texture = this.device.createTexture({
        label: `motion-texture-fill-${reuseKey}`,
        size: sourceSize,
        format: 'rgba8unorm',
        // copyExternalImageToTexture requires COPY_DST AND RENDER_ATTACHMENT
        // on the destination; Dawn rejects the copy otherwise.
        usage: GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      try {
        this.device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture },
          sourceSize,
        );
      } catch (error) {
        texture.destroy();
        throw error;
      }
      this.cache.set(reuseKey, {
        texture,
        view: texture.createView(),
        sourceSize,
        releaseExtraction: extracted.release,
      });
      retainedExtraction = true;
      this.readyKeys.set(signature, reuseKey);
      this.evictOldest();
    } finally {
      bitmap.close?.();
      if (!retainedExtraction) extracted.release?.();
    }
  }

  private takeCached(reuseKey: string): CachedTexture | undefined {
    const cached = this.cache.get(reuseKey);
    if (!cached) return undefined;
    this.cache.delete(reuseKey);
    this.cache.set(reuseKey, cached);
    return cached;
  }

  private evictOldest(): void {
    while (this.cache.size > MAX_CACHED_TEXTURES) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.release(oldestKey);
    }
  }

  private createSource(
    mediaFileId: string,
    mediaType: ReturnType<typeof useMediaStore.getState>['files'][number]['type'],
    durationSeconds: number | undefined,
  ): MotionMediaSourceReference | null {
    try {
      if (mediaType === 'image') {
        return createMotionMediaSourceReference('image', mediaFileId, null);
      }
      if (mediaType === 'video' && validVideoDuration(durationSeconds)) {
        return createMotionMediaSourceReference('video', mediaFileId, durationSeconds);
      }
      return null;
    } catch {
      return null;
    }
  }

  private reportMissing(message: string): MotionTextureAcquisitionResult {
    this.onDiagnostic?.('TEXTURE_MEDIA_MISSING', message);
    return { status: 'missing' };
  }
}

export function buildTextureReuseKey(
  sourceId: string,
  appearance: Pick<TextureFillAppearance, 'fit' | 'transform'>,
  textureSize: { width: number; height: number },
  resolvedTime: MotionMediaResolvedTime = { ticks: 0, ticksPerSecond: 1, seconds: 0 },
): string {
  const parameters: MotionMediaRenderParameters = {
    targetWidth: textureSize.width,
    targetHeight: textureSize.height,
    pixelRatio: 1,
    fitMode: appearance.fit === 'contain' ? 'fit' : appearance.fit === 'cover' ? 'fill' : appearance.fit,
    positionX: finiteOr(appearance.transform.position.x, 0),
    positionY: finiteOr(appearance.transform.position.y, 0),
    scaleX: nonZeroOr(appearance.transform.scale.x, 1),
    scaleY: nonZeroOr(appearance.transform.scale.y, 1),
    rotationDegrees: finiteOr(appearance.transform.rotation, 0),
    tileRepeatX: 1,
    tileRepeatY: 1,
    tileOffsetX: 0,
    tileOffsetY: 0,
    sampling: 'linear',
  };
  return buildMotionMediaReuseKey(sourceId, resolvedTime, parameters);
}

function resolveTextureFillTime(
  source: MotionMediaSourceReference,
  requestedTime: number | undefined,
): MotionMediaResolvedTime {
  if (source.kind === 'image') return { ticks: 0, ticksPerSecond: 1, seconds: 0 };
  const duration = source.durationSeconds;
  if (duration === null) throw new Error('video texture source is missing a duration');
  const freezeTimeSeconds = Math.min(
    duration,
    Math.max(0, finiteOr(requestedTime, 0)),
  );
  return resolveMotionMediaSourceTime(source, {
    mode: 'freeze',
    sourceInSeconds: 0,
    sourceOutSeconds: duration,
    freezeTimeSeconds,
    playbackRate: 1,
    perInstanceOffsetSeconds: 0,
  }, {
    ticksPerSecond: 1_000_000,
    rounding: 'nearest-half-up',
  }, 0, 0);
}

/**
 * Fallback only: HTML media seeks may land on a browser-decoded keyframe or
 * adjacent presentation frame, so this is not an exact-WebCodecs extractor.
 * The element and object URL remain owned by the cache entry until release.
 */
async function extractVideoFrameWithSeek(
  file: Blob,
  resolvedTimeSeconds: number,
): Promise<MotionTextureVideoFrame> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('video texture frame extraction is unavailable in this environment');
  }
  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;
  try {
    await waitForVideoEvent(video, 'loadedmetadata');
    if (!validSize(video.videoWidth, video.videoHeight)) {
      throw new Error('video texture frame has invalid dimensions');
    }
    const target = safeVideoSeekTime(video.duration, resolvedTimeSeconds);
    if (Math.abs(video.currentTime - target) > 0.0001) {
      video.currentTime = target;
      await waitForVideoEvent(video, 'seeked');
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error('video texture frame has no current data after seek');
    }
    const bitmap = await createImageBitmap(video);
    return {
      bitmap,
      release: () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadedmetadata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error(`video texture frame ${eventName} timed out`));
    }, 10_000);
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener('error', onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`video texture frame ${eventName} failed`));
    };
    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function safeVideoSeekTime(duration: number, time: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, time);
  return Math.min(Math.max(0, time), Math.max(0, duration - 0.001));
}

function validVideoDuration(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Pure CPU mirror of the WGSL texture-fill UV transform for unit tests. */
export function resolveTextureFillUv(input: TextureFillUvInput): TextureFillUvResult {
  const shapeAspect = safeRatio(input.shapeSize.width, input.shapeSize.height);
  const textureAspect = safeRatio(input.textureSize.width, input.textureSize.height);
  const transform = input.appearance.transform;
  const scaleX = nonZeroOr(transform.scale.x, 1);
  const scaleY = nonZeroOr(transform.scale.y, 1);
  const radians = -finiteOr(transform.rotation, 0) * Math.PI / 180;
  const translatedX = (input.point.x - 0.5 - finiteOr(transform.position.x, 0)) / scaleX;
  const translatedY = (input.point.y - 0.5 - finiteOr(transform.position.y, 0)) / scaleY;
  const rotatedX = translatedX * Math.cos(radians) - translatedY * Math.sin(radians);
  const rotatedY = translatedX * Math.sin(radians) + translatedY * Math.cos(radians);
  const point = { x: rotatedX + 0.5, y: rotatedY + 0.5 };

  if (input.appearance.fit === 'tile') {
    return { u: fract(point.x), v: fract(point.y), covered: true };
  }
  if (input.appearance.fit === 'stretch') {
    return { u: point.x, v: point.y, covered: inUnit(point.x) && inUnit(point.y) };
  }

  const contain = input.appearance.fit === 'contain';
  const aspectScale = textureAspect / shapeAspect;
  const display = textureAspect >= shapeAspect
    ? (contain
      ? { width: 1, height: 1 / aspectScale }
      : { width: aspectScale, height: 1 })
    : (contain
      ? { width: aspectScale, height: 1 }
      : { width: 1, height: 1 / aspectScale });
  const u = (point.x - (1 - display.width) * 0.5) / display.width;
  const v = (point.y - (1 - display.height) * 0.5) / display.height;
  return {
    u,
    v,
    covered: inUnit(u) && inUnit(v),
  };
}

function readyResult(reuseKey: string, cached: CachedTexture): MotionTextureAcquisitionResult {
  return { status: 'ready', reuseKey, textureView: cached.view, sourceSize: cached.sourceSize };
}

function validSize(width: number | undefined, height: number | undefined): { width: number; height: number } | null {
  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
  ) return null;
  return { width, height };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonZeroOr(value: number | undefined, fallback: number): number {
  const resolved = finiteOr(value, fallback);
  return resolved === 0 ? fallback : resolved;
}

function safeRatio(width: number, height: number): number {
  return Math.max(0.0001, finiteOr(width, 1)) / Math.max(0.0001, finiteOr(height, 1));
}

function inUnit(value: number): boolean {
  return value >= 0 && value <= 1;
}

function fract(value: number): number {
  return value - Math.floor(value);
}
