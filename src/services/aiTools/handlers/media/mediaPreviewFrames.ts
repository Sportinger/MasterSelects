import type { ToolResult } from '../../types';
import type { MediaStore } from './runtime';
import { extractVideoFrame } from '../../../clipAnalysis/frameExtractor';
import { thumbnailCacheService } from '../../../thumbnailCacheService';

const FRAME_COUNT = 3;
const FRAME_WIDTH = 360;
const FRAME_HEIGHT = 216;
const LABEL_HEIGHT = 24;
const LOAD_TIMEOUT_MS = 12_000;
const CONTACT_SHEET_FRAME_COUNT = 20;
const CONTACT_SHEET_COLUMNS = 5;
const CONTACT_SHEET_FRAME_WIDTH = 256;
const CONTACT_SHEET_FRAME_HEIGHT = 144;
const CONTACT_SHEET_LABEL_HEIGHT = 22;

type RepresentativeMediaFrameTimes = readonly [number, number, number];

function roundedTime(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * Deterministic source-owned evidence positions. Videos shorter than two
 * seconds use proportional positions so the three observations remain ordered.
 */
export function representativeMediaFrameTimes(durationSeconds: number): RepresentativeMediaFrameTimes {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('A positive finite video duration is required.');
  }
  const safeEnd = Math.max(0, durationSeconds - Math.min(0.05, durationSeconds * 0.02));
  if (durationSeconds <= 2) {
    return [
      roundedTime(safeEnd * 0.1),
      roundedTime(safeEnd * 0.5),
      roundedTime(safeEnd * 0.9),
    ];
  }
  return [
    roundedTime(Math.min(1, safeEnd)),
    roundedTime(durationSeconds / 2),
    roundedTime(safeEnd),
  ];
}

export function contactSheetMediaFrameTimes(
  durationSeconds: number,
  frameCount = CONTACT_SHEET_FRAME_COUNT,
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('A positive finite video duration is required.');
  }
  if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > CONTACT_SHEET_FRAME_COUNT) {
    throw new Error(`frameCount must be an integer from 2 to ${CONTACT_SHEET_FRAME_COUNT}.`);
  }
  const safeEnd = Math.max(0, durationSeconds - Math.min(0.05, durationSeconds * 0.02));
  const safeStart = Math.min(0.25, safeEnd * 0.02);
  return Array.from({ length: frameCount }, (_, index) => roundedTime(
    safeStart + ((safeEnd - safeStart) * index) / (frameCount - 1),
  ));
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    && Number.isFinite(video.duration)
    && video.duration > 0
  ) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (timeout !== null) clearTimeout(timeout);
      video.removeEventListener('canplaythrough', onReady);
      video.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = () => finish(new Error('The video source could not be decoded.'));
    timeout = setTimeout(
      () => finish(new Error('Loading video data timed out.')),
      LOAD_TIMEOUT_MS,
    );
    video.addEventListener('canplaythrough', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function drawFrameLabel(
  context: CanvasRenderingContext2D,
  index: number,
  time: number,
): void {
  const labels = ['OPENING', 'MIDDLE', 'ENDING'];
  const x = index * FRAME_WIDTH;
  const y = FRAME_HEIGHT;
  context.fillStyle = '#101216';
  context.fillRect(x, y, FRAME_WIDTH, LABEL_HEIGHT);
  context.fillStyle = '#ffffff';
  context.font = '600 13px sans-serif';
  context.fillText(`${labels[index]}  ${time.toFixed(2)}s`, x + 10, y + 17);
}

function drawContactSheetLabel(
  context: CanvasRenderingContext2D,
  index: number,
  time: number,
): void {
  const column = index % CONTACT_SHEET_COLUMNS;
  const row = Math.floor(index / CONTACT_SHEET_COLUMNS);
  const x = column * CONTACT_SHEET_FRAME_WIDTH;
  const y = row * (CONTACT_SHEET_FRAME_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT)
    + CONTACT_SHEET_FRAME_HEIGHT;
  context.fillStyle = '#101216';
  context.fillRect(x, y, CONTACT_SHEET_FRAME_WIDTH, CONTACT_SHEET_LABEL_HEIGHT);
  context.fillStyle = '#ffffff';
  context.font = '600 12px sans-serif';
  context.fillText(`${index + 1}/${CONTACT_SHEET_FRAME_COUNT}  ${time.toFixed(2)}s`, x + 8, y + 15);
}

function drawContactSheetImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  index: number,
): void {
  const column = index % CONTACT_SHEET_COLUMNS;
  const row = Math.floor(index / CONTACT_SHEET_COLUMNS);
  context.drawImage(
    image,
    column * CONTACT_SHEET_FRAME_WIDTH,
    row * (CONTACT_SHEET_FRAME_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT),
    CONTACT_SHEET_FRAME_WIDTH,
    CONTACT_SHEET_FRAME_HEIGHT,
  );
}

function loadThumbnailImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => reject(new Error('Loading cached thumbnail timed out.')), 5_000);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('A cached thumbnail could not be decoded.'));
    };
    image.src = url;
  });
}

async function drawCachedContactSheet(
  context: CanvasRenderingContext2D,
  mediaFileId: string,
  fileHash: string | undefined,
  frameTimes: readonly number[],
): Promise<boolean> {
  await thumbnailCacheService.loadCachedForSource(mediaFileId, fileHash);
  const urls = frameTimes.map((time) => (
    thumbnailCacheService.getThumbnail(mediaFileId, Math.floor(time))
  ));
  if (urls.some((url) => url === null)) return false;
  try {
    const images = await Promise.all(urls.map((url) => loadThumbnailImage(url!)));
    images.forEach((image, index) => drawContactSheetImage(context, image, index));
    return true;
  } catch {
    return false;
  }
}

/** Direct-agent overview: one bounded image containing twenty distributed source frames. */
export async function handleGetMediaContactSheet(
  args: Record<string, unknown>,
  mediaStore: MediaStore,
): Promise<ToolResult> {
  const mediaFileId = typeof args.mediaFileId === 'string' ? args.mediaFileId.trim() : '';
  if (!mediaFileId) return { success: false, error: 'mediaFileId is required.' };
  const file = mediaStore.files.find((candidate) => candidate.id === mediaFileId);
  if (!file) return { success: false, error: `Media item not found: ${mediaFileId}` };
  if (file.type !== 'video') {
    return { success: false, error: 'A media contact sheet requires a video source.' };
  }
  if (!file.file && !file.url) {
    return { success: false, error: `Video source is unavailable: ${mediaFileId}` };
  }
  const duration = file.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return { success: false, error: `Video duration is unavailable: ${mediaFileId}` };
  }

  const frameTimes = contactSheetMediaFrameTimes(duration);
  const rows = Math.ceil(CONTACT_SHEET_FRAME_COUNT / CONTACT_SHEET_COLUMNS);
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = CONTACT_SHEET_COLUMNS * CONTACT_SHEET_FRAME_WIDTH;
  gridCanvas.height = rows * (CONTACT_SHEET_FRAME_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT);
  const gridContext = gridCanvas.getContext('2d');
  if (!gridContext) return { success: false, error: 'Failed to create a contact-sheet canvas.' };
  gridContext.fillStyle = '#07090c';
  gridContext.fillRect(0, 0, gridCanvas.width, gridCanvas.height);

  let source: 'thumbnail-cache' | 'video-decode' = 'thumbnail-cache';
  let cached = await drawCachedContactSheet(
    gridContext,
    mediaFileId,
    file.fileHash,
    frameTimes,
  );
  if (!cached && file.url) {
    await thumbnailCacheService.generateForSourceUrl(
      mediaFileId,
      file.url,
      duration,
      file.fileHash,
    );
    cached = await drawCachedContactSheet(
      gridContext,
      mediaFileId,
      file.fileHash,
      frameTimes,
    );
  }
  if (!cached) {
    source = 'video-decode';
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    const objectUrl = file.file ? URL.createObjectURL(file.file) : null;
    video.src = objectUrl ?? file.url;
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = CONTACT_SHEET_FRAME_WIDTH;
    frameCanvas.height = CONTACT_SHEET_FRAME_HEIGHT;
    const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
    if (!frameContext) return { success: false, error: 'Failed to create a contact-sheet frame canvas.' };
    try {
      video.load();
      await waitForVideoReady(video);
      for (const [index, time] of frameTimes.entries()) {
        await extractVideoFrame(video, time, frameCanvas, frameContext);
        drawContactSheetImage(gridContext, frameCanvas, index);
      }
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    }
  }
  frameTimes.forEach((time, index) => drawContactSheetLabel(gridContext, index, time));

  return {
    success: true,
    data: {
      dataUrl: gridCanvas.toDataURL('image/jpeg', 0.82),
      duration,
      frameCount: CONTACT_SHEET_FRAME_COUNT,
      frameTimes,
      height: gridCanvas.height,
      mediaFileId,
      mediaName: file.name,
      source,
      visualReviewKind: 'source-contact-sheet-20-v2',
      width: gridCanvas.width,
    },
  };
}

export async function handleGetMediaPreviewFrames(
  args: Record<string, unknown>,
  mediaStore: MediaStore,
): Promise<ToolResult> {
  if (args.contactSheet === true) {
    return handleGetMediaContactSheet(args, mediaStore);
  }
  const mediaFileId = typeof args.mediaFileId === 'string' ? args.mediaFileId.trim() : '';
  if (!mediaFileId) return { success: false, error: 'mediaFileId is required.' };
  const file = mediaStore.files.find((candidate) => candidate.id === mediaFileId);
  if (!file) return { success: false, error: `Media item not found: ${mediaFileId}` };
  if (file.type !== 'video') {
    return { success: false, error: 'Representative media frames require a video source.' };
  }
  if (!file.file && !file.url) {
    return { success: false, error: `Video source is unavailable: ${mediaFileId}` };
  }

  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  const objectUrl = file.file ? URL.createObjectURL(file.file) : null;
  video.src = objectUrl ?? file.url;

  try {
    video.load();
    await waitForVideoReady(video);
    const duration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : file.duration;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      return { success: false, error: `Video duration is unavailable: ${mediaFileId}` };
    }
    const frameTimes = representativeMediaFrameTimes(duration);
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = FRAME_WIDTH;
    frameCanvas.height = FRAME_HEIGHT;
    const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = FRAME_WIDTH * FRAME_COUNT;
    gridCanvas.height = FRAME_HEIGHT + LABEL_HEIGHT;
    const gridContext = gridCanvas.getContext('2d');
    if (!frameContext || !gridContext) {
      return { success: false, error: 'Failed to create a frame-preview canvas.' };
    }
    gridContext.fillStyle = '#07090c';
    gridContext.fillRect(0, 0, gridCanvas.width, gridCanvas.height);

    for (const [index, time] of frameTimes.entries()) {
      await extractVideoFrame(video, time, frameCanvas, frameContext);
      gridContext.drawImage(frameCanvas, index * FRAME_WIDTH, 0);
      drawFrameLabel(gridContext, index, time);
    }

    return {
      success: true,
      data: {
        dataUrl: gridCanvas.toDataURL('image/jpeg', 0.86),
        duration,
        frameCount: FRAME_COUNT,
        frameTimes: [...frameTimes],
        height: gridCanvas.height,
        mediaFileId,
        mediaName: file.name,
        visualReviewKind: 'source-three-frame-v1',
        width: gridCanvas.width,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Representative frame capture failed.',
      data: { mediaFileId, mediaName: file.name },
    };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  }
}
