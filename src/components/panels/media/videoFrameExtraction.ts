import type { MediaFile } from '../../../stores/mediaStore';
import { resolveMediaFileSourceFile } from '../../../stores/mediaStore/slices/fileManage/sourceResolution';

export type VideoFrameExtractionPosition = 'first' | 'last';

const METADATA_READY_STATE = 1;
const CURRENT_FRAME_READY_STATE = 2;
const EXTRACTION_TIMEOUT_MS = 10000;
const DEFAULT_FRAME_RATE = 30;

export function getVideoFrameExtractionTime(
  duration: number | undefined,
  fps: number | undefined,
  position: VideoFrameExtractionPosition,
): number {
  if (position === 'first' || !Number.isFinite(duration) || (duration ?? 0) <= 0) {
    return 0;
  }

  const frameDuration = Number.isFinite(fps) && (fps ?? 0) > 0
    ? 1 / (fps as number)
    : 1 / DEFAULT_FRAME_RATE;
  const endOffset = Math.min(0.1, Math.max(0.001, frameDuration / 2));
  return Math.max(0, (duration as number) - endOffset);
}

export function getExtractedVideoFrameFileName(
  sourceName: string,
  position: VideoFrameExtractionPosition,
): string {
  const sourceBaseName = (sourceName.trim() || 'video')
    .replace(/\.[^./\\]+$/, '')
    .trim() || 'video';
  return `${sourceBaseName} - ${position} frame.png`;
}

export async function extractVideoFrameFile(
  mediaFile: MediaFile,
  position: VideoFrameExtractionPosition,
): Promise<File> {
  if (mediaFile.type !== 'video') {
    throw new Error('Only video files support frame extraction.');
  }

  const sourceFile = await resolveMediaFileSourceFile(mediaFile);
  if (!sourceFile) {
    throw new Error('Video source is not available. Relink the file and try again.');
  }

  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(sourceFile);

  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;
    video.load();

    await waitForLoadedMetadata(video);
    const duration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : mediaFile.duration;
    const targetTime = getVideoFrameExtractionTime(duration, mediaFile.fps, position);

    if (targetTime > 0) {
      await seekVideo(video, targetTime);
    } else {
      await waitForCurrentFrame(video);
    }

    const width = video.videoWidth || mediaFile.width || 0;
    const height = video.videoHeight || mediaFile.height || 0;
    if (width <= 0 || height <= 0) {
      throw new Error('Video frame dimensions are not available.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not create a canvas for video frame extraction.');
    }

    context.drawImage(video, 0, 0, width, height);
    const blob = await canvasToPngBlob(canvas);

    return new File([blob], getExtractedVideoFrameFileName(mediaFile.name, position), {
      type: 'image/png',
      lastModified: Date.now(),
    });
  } finally {
    video.pause();
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      // Ignore detached video cleanup errors.
    }
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForLoadedMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= METADATA_READY_STATE && Number.isFinite(video.duration)) {
    return Promise.resolve();
  }

  return waitForVideoReadyEvent(video, 'loadedmetadata', 'Video metadata is not available.');
}

function waitForCurrentFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= CURRENT_FRAME_READY_STATE) {
    return Promise.resolve();
  }

  return waitForVideoReadyEvent(video, 'loadeddata', 'Video frame data is not available.');
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while seeking the video frame.'));
    }, EXTRACTION_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('error', onError);
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    const onSeeked = () => {
      finish();
    };

    const onLoadedData = () => {
      if (video.readyState >= CURRENT_FRAME_READY_STATE && Math.abs(video.currentTime - time) < 0.15) {
        finish();
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error(video.error?.message || 'Video seek failed.'));
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('error', onError, { once: true });

    try {
      video.currentTime = time;
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error('Video seek failed.'));
      return;
    }

    if (video.readyState >= CURRENT_FRAME_READY_STATE && Math.abs(video.currentTime - time) < 0.001) {
      queueMicrotask(finish);
    }
  });
}

function waitForVideoReadyEvent(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'loadeddata',
  failureMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(failureMessage));
    }, EXTRACTION_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener('error', onError);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(video.error?.message || failureMessage));
    };

    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size <= 0) {
        reject(new Error('Could not encode the extracted frame as PNG.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}
