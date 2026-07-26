import type { FaceAnalysisBox } from '../../types/clipMetadata';
import { projectFileService } from '../project/ProjectFileService';

const MAX_CACHE_ENTRIES = 80;
const THUMBNAIL_SIZE = 112;
const FACE_PADDING = 0.34;
const CACHE_VERSION = 1;

interface FaceCropThumbnailRequest {
  file: File;
  timestamp: number;
  box: FaceAnalysisBox;
}

interface FaceCropThumbnailRuntime {
  cache: Map<string, Blob>;
  pending: Map<string, Promise<Blob | null>>;
  generationQueue: Promise<void>;
}

interface LegacyFaceCropThumbnailRuntime {
  cache?: Map<string, Blob>;
  pending?: Map<string, Promise<Blob | null>>;
  generationQueue?: Promise<void>;
  queue?: Promise<void>;
}

function thumbnailKey({ file, timestamp, box }: FaceCropThumbnailRequest): string {
  return [
    file.name,
    file.size,
    file.lastModified,
    timestamp.toFixed(3),
    box.x.toFixed(3),
    box.y.toFixed(3),
    box.width.toFixed(3),
    box.height.toFixed(3),
  ].join(':');
}

async function persistentThumbnailFileName(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(`face-crop:v${CACHE_VERSION}:${key}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  return `v${CACHE_VERSION}-${hash}.jpg`;
}

function waitForVideo(video: HTMLVideoElement, eventName: 'canplaythrough' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = () => finish(new Error('Could not decode the source video for a face thumbnail.'));
    const timeout = window.setTimeout(() => finish(new Error(`Face thumbnail ${eventName} timed out.`)), 15_000);
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, timestamp: number): Promise<void> {
  const maxTime = Math.max(0, (Number.isFinite(video.duration) ? video.duration : timestamp) - 0.01);
  const targetTime = Math.max(0, Math.min(maxTime, timestamp));
  if (Math.abs(video.currentTime - targetTime) < 0.01) return;
  video.currentTime = targetTime;
  await waitForVideo(video, 'seeked');
}

function cropBounds(box: FaceAnalysisBox, sourceWidth: number, sourceHeight: number) {
  const centerX = (box.x + box.width / 2) * sourceWidth;
  const centerY = (box.y + box.height / 2) * sourceHeight;
  const side = Math.max(box.width * sourceWidth, box.height * sourceHeight) * (1 + FACE_PADDING * 2);
  const size = Math.max(1, Math.min(side, sourceWidth, sourceHeight));
  return {
    x: Math.max(0, Math.min(sourceWidth - size, centerX - size / 2)),
    y: Math.max(0, Math.min(sourceHeight - size, centerY - size / 2)),
    size,
  };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode face thumbnail.'));
    }, 'image/jpeg', 0.84);
  });
}

async function createFaceCropThumbnail({ file, timestamp, box }: FaceCropThumbnailRequest): Promise<Blob> {
  const video = document.createElement('video');
  const sourceUrl = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = sourceUrl;
  video.load();

  try {
    if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      await waitForVideo(video, 'canplaythrough');
    }
    await seekVideo(video, timestamp);

    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_SIZE;
    canvas.height = THUMBNAIL_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create a face thumbnail canvas.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const sourceWidth = video.videoWidth || 1;
    const sourceHeight = video.videoHeight || 1;
    const crop = cropBounds(box, sourceWidth, sourceHeight);
    context.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    return await canvasBlob(canvas);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

let runtime: FaceCropThumbnailRuntime = {
  cache: new Map(),
  pending: new Map(),
  generationQueue: Promise.resolve(),
};

if (import.meta.hot) {
  import.meta.hot.accept();
  const restored = import.meta.hot.data?.faceCropThumbnailRuntime as LegacyFaceCropThumbnailRuntime | undefined;
  if (restored) {
    runtime = {
      cache: restored.cache ?? new Map(),
      pending: restored.pending ?? new Map(),
      generationQueue: restored.generationQueue ?? restored.queue ?? Promise.resolve(),
    };
  }
  import.meta.hot.dispose((data) => {
    data.faceCropThumbnailRuntime = runtime;
  });
}

function rememberThumbnail(key: string, thumbnail: Blob): void {
  runtime.cache.set(key, thumbnail);
  while (runtime.cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = runtime.cache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    runtime.cache.delete(oldestKey);
  }
}

function queueThumbnailGeneration(request: FaceCropThumbnailRequest): Promise<Blob> {
  const task = runtime.generationQueue.then(() => createFaceCropThumbnail(request));
  runtime.generationQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function loadOrCreateThumbnail(
  request: FaceCropThumbnailRequest,
  key: string,
): Promise<Blob> {
  let persistentFileName: string | null = null;
  if (projectFileService.isProjectOpen()) {
    try {
      persistentFileName = await persistentThumbnailFileName(key);
      const stored = await projectFileService.readFile('CACHE_FACE_THUMBNAILS', persistentFileName);
      if (stored && stored.size > 0) {
        rememberThumbnail(key, stored);
        return stored;
      }
    } catch {
      persistentFileName = null;
    }
  }

  const thumbnail = await queueThumbnailGeneration(request);
  rememberThumbnail(key, thumbnail);
  if (persistentFileName && projectFileService.isProjectOpen()) {
    try {
      await projectFileService.writeFile('CACHE_FACE_THUMBNAILS', persistentFileName, thumbnail);
    } catch {
      // The generated thumbnail is still valid when project cache storage is unavailable.
    }
  }
  return thumbnail;
}

export function getFaceCropThumbnail(request: FaceCropThumbnailRequest): Promise<Blob | null> {
  const key = thumbnailKey(request);
  const cached = runtime.cache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = runtime.pending.get(key);
  if (pending) return pending;

  const task = loadOrCreateThumbnail(request, key).catch(() => null);
  runtime.pending.set(key, task);
  void task.finally(() => {
    if (runtime.pending.get(key) === task) runtime.pending.delete(key);
  });
  return task;
}
