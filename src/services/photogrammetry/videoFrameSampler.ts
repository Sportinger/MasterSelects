export interface ScanVideoSampleOptions {
  frameCount: number;
  maxResolution: number;
  startTime?: number;
  endTime?: number;
  frameRate?: number;
  jpegQuality?: number;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

export interface SampledScanVideoFrame {
  file: File;
  sourceTime: number;
}

const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);

export function isSupportedScanVideo(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.has(extension);
}

export function planVideoSampleTimes(
  duration: number,
  frameCount: number,
  requestedStart = 0,
  requestedEnd = duration,
  frameRate?: number,
): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || frameCount <= 0) return [];
  const count = Math.max(1, Math.floor(frameCount));
  const rangeStart = Math.max(0, Math.min(duration, requestedStart));
  const rangeEnd = Math.max(rangeStart, Math.min(duration, requestedEnd));
  const rangeDuration = rangeEnd - rangeStart;
  if (rangeDuration <= 0) return [];
  if (frameRate && Number.isFinite(frameRate) && frameRate > 0) {
    const firstFrame = Math.ceil(rangeStart * frameRate - 1e-6);
    const lastFrame = Math.max(
      firstFrame,
      Math.floor((rangeEnd - 0.5 / frameRate) * frameRate + 1e-6),
    );
    const availableFrames = lastFrame - firstFrame + 1;
    const sampleCount = Math.min(count, availableFrames);
    if (sampleCount === 1) {
      return [Math.round((firstFrame + lastFrame) * 0.5) / frameRate];
    }
    const frameNumbers = Array.from({ length: sampleCount }, (_, index) => Math.round(
      firstFrame + ((lastFrame - firstFrame) * index) / (sampleCount - 1),
    ));
    return Array.from(new Set(frameNumbers)).map((frame) => frame / frameRate);
  }
  const start = rangeStart + rangeDuration * 0.05;
  const end = rangeEnd - rangeDuration * 0.05;
  if (count === 1) return [rangeStart + rangeDuration * 0.5];
  return Array.from({ length: count }, (_, index) => (
    start + ((end - start) * index) / (count - 1)
  ));
}

function waitForEvent(
  target: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'canplaythrough' | 'seeked',
  signal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error(`Video ${eventName} timed out.`)), timeoutMs);
    const onEvent = () => finish();
    const onError = () => finish(new Error('The browser could not decode this video.'));
    const onAbort = () => finish(new DOMException('Video sampling was cancelled.', 'AbortError'));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForVideoReady(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await waitForEvent(video, 'loadedmetadata', signal);
  }
  if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
    await waitForEvent(video, 'canplaythrough', signal);
  }
}

async function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Video sampling was cancelled.', 'AbortError');
  if (Math.abs(video.currentTime - time) < 0.001) return;
  const seeked = waitForEvent(video, 'seeked', signal);
  video.currentTime = time;
  await seeked;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode a sampled video frame.'));
    }, 'image/jpeg', quality);
  });
}

export async function sampleScanVideoWithTimes(
  file: File,
  options: ScanVideoSampleOptions,
): Promise<SampledScanVideoFrame[]> {
  if (!isSupportedScanVideo(file)) throw new Error('Choose a browser-decodable video file.');
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = sourceUrl;
  const canvas = document.createElement('canvas');

  try {
    video.load();
    await waitForVideoReady(video, options.signal);
    const times = planVideoSampleTimes(
      video.duration,
      options.frameCount,
      options.startTime,
      options.endTime,
      options.frameRate,
    );
    if (times.length === 0) throw new Error('This video does not report a usable duration.');
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('This video does not expose a usable frame size.');
    const scale = Math.min(1, options.maxResolution / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas frame extraction is unavailable.');

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'video';
    const frames: SampledScanVideoFrame[] = [];
    for (let index = 0; index < times.length; index += 1) {
      await seekVideo(video, times[index], options.signal);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToJpeg(canvas, options.jpegQuality ?? 0.9);
      frames.push({
        file: new File(
          [blob],
          `${baseName}-frame-${String(index + 1).padStart(3, '0')}.jpg`,
          { type: 'image/jpeg', lastModified: file.lastModified + index + 1 },
        ),
        sourceTime: times[index],
      });
      options.onProgress?.(index + 1, times.length);
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function sampleScanVideo(
  file: File,
  options: ScanVideoSampleOptions,
): Promise<File[]> {
  return (await sampleScanVideoWithTimes(file, options)).map((frame) => frame.file);
}
