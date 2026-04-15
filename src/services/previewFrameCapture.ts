import { Logger } from './logger';

const log = Logger.create('PreviewFrameCapture');

interface CapturedPreviewFrameCanvas {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export async function captureCurrentPreviewFrameCanvas(): Promise<CapturedPreviewFrameCanvas | null> {
  try {
    const { engine } = await import('../engine/WebGPUEngine');
    if (!engine) {
      return null;
    }

    const pixels = await engine.readPixels();
    if (!pixels) {
      return null;
    }

    const { width, height } = engine.getOutputDimensions();
    if (!width || !height) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
    ctx.putImageData(imageData, 0, 0);

    return { canvas, width, height };
  } catch (error) {
    log.error('Failed to capture current preview frame', error);
    return null;
  }
}

export async function captureCurrentPreviewFrameDataUrl(): Promise<string | null> {
  const capture = await captureCurrentPreviewFrameCanvas();
  if (!capture) {
    return null;
  }

  return capture.canvas.toDataURL('image/png');
}

export async function captureCurrentPreviewFrameFile(filenamePrefix = 'preview_frame'): Promise<File | null> {
  const capture = await captureCurrentPreviewFrameCanvas();
  if (!capture) {
    return null;
  }

  const blob = await canvasToPngBlob(capture.canvas);
  if (!blob) {
    return null;
  }

  return new File([blob], `${filenamePrefix}_${Date.now()}.png`, { type: 'image/png' });
}
