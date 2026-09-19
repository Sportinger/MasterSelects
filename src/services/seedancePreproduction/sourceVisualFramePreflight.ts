import type { MediaFile } from '../../stores/mediaStore';
import { useMediaStore } from '../../stores/mediaStore';
import { extractVideoFrame } from '../clipAnalysis/frameExtractor';
import type { SeedanceSourceBundleReference } from './contracts';

const FRAME_BOX_WIDTH = 320;
const FRAME_BOX_HEIGHT = 180;
const CONTACT_SHEET_COLUMNS = 4;
const CONTACT_SHEET_ROWS = 4;
const CONTACT_SHEET_FRAME_COUNT = CONTACT_SHEET_COLUMNS * CONTACT_SHEET_ROWS;
const CONTACT_SHEET_WIDTH = 640;
const CONTACT_SHEET_HEIGHT = 432;
const CONTACT_CELL_WIDTH = CONTACT_SHEET_WIDTH / CONTACT_SHEET_COLUMNS;
const CONTACT_CELL_HEIGHT = CONTACT_SHEET_HEIGHT / CONTACT_SHEET_ROWS;
const LOAD_TIMEOUT_MS = 15_000;

interface VisualFrameUploadItem {
  id: string;
  kind: 'source-frame' | 'contact-sheet';
  index: number;
  timestampSeconds: number;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  sha256: string;
  dataUrl: string;
}

function visualSourceFingerprint(file: MediaFile): string | undefined {
  return typeof file.fileHash === 'string' && /^[a-f0-9]{64}$/u.test(file.fileHash)
    ? file.fileHash
    : undefined;
}

export interface SeedanceVisualFrameCoverage {
  sourceMediaId: string;
  expectedFrameCount: number;
  storedFrameCount: number;
  expectedContactSheetCount: number;
  storedContactSheetCount: number;
  complete: boolean;
}

export interface SeedanceVisualFrameStatus {
  schemaVersion: 1;
  kind: 'source-frame-status';
  sourceBundleId: string;
  complete: boolean;
  media: SeedanceVisualFrameCoverage[];
}

export interface SeedanceVisualFramePreflightDependencies {
  captureAndUpload(
    file: MediaFile,
    sourceBundleId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  readFiles(): readonly MediaFile[];
  status(sourceBundleId: string, signal?: AbortSignal): Promise<SeedanceVisualFrameStatus>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseStatus(value: unknown): SeedanceVisualFrameStatus {
  const root = record(value);
  if (
    root?.schemaVersion !== 1
    || root.kind !== 'source-frame-status'
    || typeof root.sourceBundleId !== 'string'
    || typeof root.complete !== 'boolean'
    || !Array.isArray(root.media)
  ) throw new Error('The kernel returned invalid source-frame coverage.');
  const media = root.media.map((item) => {
    const value = record(item);
    if (
      typeof value?.sourceMediaId !== 'string'
      || typeof value.expectedFrameCount !== 'number'
      || typeof value.storedFrameCount !== 'number'
      || typeof value.expectedContactSheetCount !== 'number'
      || typeof value.storedContactSheetCount !== 'number'
      || typeof value.complete !== 'boolean'
    ) throw new Error('The kernel returned invalid source-frame coverage.');
    return value as unknown as SeedanceVisualFrameCoverage;
  });
  return { schemaVersion: 1, kind: 'source-frame-status', sourceBundleId: root.sourceBundleId, complete: root.complete, media };
}

async function responseValue(response: Response): Promise<unknown> {
  const value = await response.json().catch(() => null) as unknown;
  if (response.ok) return value;
  const error = record(value)?.error;
  throw new Error(typeof error === 'string' ? error : `Source-frame upload failed with HTTP ${response.status}.`);
}

async function readStatus(sourceBundleId: string, signal?: AbortSignal): Promise<SeedanceVisualFrameStatus> {
  const query = new URLSearchParams({ sourceBundleId });
  const response = await fetch(`/api/kernel/preproduction/seedance/source-frames?${query}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  return parseStatus(await responseValue(response));
}

async function uploadBatch(input: {
  sourceBundleId: string;
  sourceMediaId: string;
  sourceFingerprint?: string;
  items: VisualFrameUploadItem[];
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch('/api/kernel/preproduction/seedance/source-frames', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      sourceBundleId: input.sourceBundleId,
      sourceMediaId: input.sourceMediaId,
      ...(input.sourceFingerprint === undefined
        ? {}
        : { sourceFingerprint: input.sourceFingerprint }),
      items: input.items,
    }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  await responseValue(response);
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: Error) => {
      if (timeout !== null) clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
      if (error) reject(error); else resolve();
    };
    const onReady = () => finish();
    const onError = () => finish(new Error('The video source could not be decoded for visual ideation.'));
    timeout = setTimeout(() => finish(new Error('Loading video metadata for visual ideation timed out.')), LOAD_TIMEOUT_MS);
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function captureSize(video: HTMLVideoElement): { width: number; height: number } {
  const scale = Math.min(FRAME_BOX_WIDTH / video.videoWidth, FRAME_BOX_HEIGHT / video.videoHeight);
  return {
    width: Math.max(1, Math.round(video.videoWidth * scale)),
    height: Math.max(1, Math.round(video.videoHeight * scale)),
  };
}

function bytesFromDataUrl(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encodedCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<{ dataUrl: string; sha256: string }> {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytesFromDataUrl(dataUrl)).buffer);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { dataUrl, sha256 };
}

function drawContactCell(
  context: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  cellIndex: number,
  timestampSeconds: number,
): void {
  const column = cellIndex % CONTACT_SHEET_COLUMNS;
  const row = Math.floor(cellIndex / CONTACT_SHEET_COLUMNS);
  const x = column * CONTACT_CELL_WIDTH;
  const y = row * CONTACT_CELL_HEIGHT;
  context.fillStyle = '#080a0d';
  context.fillRect(x, y, CONTACT_CELL_WIDTH, CONTACT_CELL_HEIGHT);
  const scale = Math.min(CONTACT_CELL_WIDTH / frame.width, CONTACT_CELL_HEIGHT / frame.height);
  const width = Math.round(frame.width * scale);
  const height = Math.round(frame.height * scale);
  context.drawImage(frame, x + (CONTACT_CELL_WIDTH - width) / 2, y + (CONTACT_CELL_HEIGHT - height) / 2, width, height);
  context.fillStyle = 'rgba(0,0,0,0.72)';
  context.fillRect(x + 4, y + CONTACT_CELL_HEIGHT - 22, 48, 18);
  context.fillStyle = '#fff';
  context.font = '600 12px sans-serif';
  context.fillText(`${timestampSeconds}s`, x + 8, y + CONTACT_CELL_HEIGHT - 8);
}

async function captureAndUploadVideo(
  file: MediaFile,
  sourceBundleId: string,
  signal?: AbortSignal,
): Promise<void> {
  if (file.type !== 'video') return;
  if (!file.file && !file.url) throw new Error(`Visual ideation requires the original video source: ${file.name}`);
  const durationSeconds = file.duration;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86_400) {
    throw new Error(`Visual ideation requires a valid video duration up to 24 hours: ${file.name}`);
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const objectUrl = file.file ? URL.createObjectURL(file.file) : null;
  video.src = objectUrl ?? file.url ?? '';
  try {
    video.load();
    await waitForVideoReady(video);
    const size = captureSize(video);
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = size.width;
    frameCanvas.height = size.height;
    const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = CONTACT_SHEET_WIDTH;
    sheetCanvas.height = CONTACT_SHEET_HEIGHT;
    const sheetContext = sheetCanvas.getContext('2d');
    if (!frameContext || !sheetContext) throw new Error('Visual source-frame canvases are unavailable.');
    const frameCount = Math.ceil(durationSeconds);
    for (let sheetIndex = 0; sheetIndex < Math.ceil(frameCount / CONTACT_SHEET_FRAME_COUNT); sheetIndex += 1) {
      const items: VisualFrameUploadItem[] = [];
      sheetContext.fillStyle = '#080a0d';
      sheetContext.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
      const start = sheetIndex * CONTACT_SHEET_FRAME_COUNT;
      const end = Math.min(frameCount, start + CONTACT_SHEET_FRAME_COUNT);
      for (let frameIndex = start; frameIndex < end; frameIndex += 1) {
        signal?.throwIfAborted();
        await extractVideoFrame(video, frameIndex, frameCanvas, frameContext);
        const encoded = await encodedCanvas(frameCanvas, 0.72);
        items.push({
          id: `frame-${frameIndex}`,
          kind: 'source-frame',
          index: frameIndex,
          timestampSeconds: frameIndex,
          mimeType: 'image/jpeg',
          width: frameCanvas.width,
          height: frameCanvas.height,
          ...encoded,
        });
        drawContactCell(sheetContext, frameCanvas, frameIndex - start, frameIndex);
      }
      const sheet = await encodedCanvas(sheetCanvas, 0.68);
      items.push({
        id: `sheet-${sheetIndex}`,
        kind: 'contact-sheet',
        index: sheetIndex,
        timestampSeconds: start,
        mimeType: 'image/jpeg',
        width: sheetCanvas.width,
        height: sheetCanvas.height,
        ...sheet,
      });
      await uploadBatch({
        sourceBundleId,
        sourceMediaId: file.id.slice(0, 200),
        sourceFingerprint: visualSourceFingerprint(file),
        items,
        signal,
      });
    }
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  }
}

function defaultDependencies(): SeedanceVisualFramePreflightDependencies {
  return {
    captureAndUpload: captureAndUploadVideo,
    readFiles: () => useMediaStore.getState().files,
    status: readStatus,
  };
}

export async function ensureSeedanceSourceVisualFrames(
  sourceBundle: SeedanceSourceBundleReference,
  signal?: AbortSignal,
  dependencies: SeedanceVisualFramePreflightDependencies = defaultDependencies(),
): Promise<SeedanceVisualFrameStatus> {
  signal?.throwIfAborted();
  const current = await dependencies.status(sourceBundle.id, signal);
  if (current.complete) return current;
  const filesById = new Map(dependencies.readFiles().map((file) => [file.id.slice(0, 200), file]));
  for (const coverage of current.media.filter((item) => !item.complete)) {
    const file = filesById.get(coverage.sourceMediaId);
    if (!file) throw new Error(`The original video source is unavailable: ${coverage.sourceMediaId}`);
    await dependencies.captureAndUpload(file, sourceBundle.id, signal);
  }
  const completed = await dependencies.status(sourceBundle.id, signal);
  if (!completed.complete) throw new Error('Every source second must reach the kernel before visual ideation.');
  return completed;
}

export const seedanceVisualFramePreflightInternals = {
  captureSize,
  parseStatus,
};
