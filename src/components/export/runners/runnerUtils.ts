import type { ExportFrameCapture } from '../../../engine/render/contracts/exportRenderSession';
import type {
  ExportRenderSessionImpl,
  ExportRenderSessionOptions,
} from '../../../engine/export/ExportRenderSessionImpl';

export interface RunnerImageFormatOption {
  id: string;
  label: string;
  mimeType: string;
  supportsAlpha: boolean;
  lossless: boolean;
}

export interface ExportRenderSessionRef {
  current: ExportRenderSessionImpl | null;
}

export type ExportRenderSessionFactory = (
  options: Omit<ExportRenderSessionOptions, 'compositionId'>,
) => ExportRenderSessionImpl;

export function attachRenderSession(
  sessionRef: ExportRenderSessionRef,
  session: ExportRenderSessionImpl,
): void {
  sessionRef.current = session;
}

export function disposeRenderSession(
  sessionRef: ExportRenderSessionRef,
  session: ExportRenderSessionImpl | null,
): null {
  if (!session) {
    return null;
  }

  session.dispose();
  if (sessionRef.current === session) {
    sessionRef.current = null;
  }

  return null;
}

export function getReadbackPixels(capture: ExportFrameCapture): Uint8ClampedArray {
  if (capture.kind === 'rgba-pixels') {
    return capture.pixels;
  }

  capture.frame.close();
  throw new Error('Failed to read frame from GPU');
}

export async function encodeImageDataToBlob(
  imageData: ImageData,
  format: RunnerImageFormatOption,
  quality: number,
): Promise<Blob> {
  if (format.id === 'bmp') {
    return encodeBmp(imageData);
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(
    canvas,
    format.mimeType,
    format.lossless ? undefined : quality,
  );
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error(`Failed to export ${type}`));
    }, type, quality);
  });
}

function encodeBmp(imageData: ImageData): Blob {
  const { width, height, data } = imageData;
  const rowStride = width * 3;
  const rowPadding = (4 - (rowStride % 4)) % 4;
  const paddedRowStride = rowStride + rowPadding;
  const pixelArraySize = paddedRowStride * height;
  const fileSize = 54 + pixelArraySize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  view.setUint8(0, 0x42);
  view.setUint8(1, 0x4d);
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const pixelOffset = (y * width + x) * 4;
      view.setUint8(offset++, data[pixelOffset + 2]);
      view.setUint8(offset++, data[pixelOffset + 1]);
      view.setUint8(offset++, data[pixelOffset]);
    }
    offset += rowPadding;
  }

  return new Blob([buffer], { type: 'image/bmp' });
}
