import { renderHostPort } from '../render/renderHostPort';

export type PreviewCaptureMode = 'auto' | 'gpu' | 'dom';

export interface PreviewCaptureSuccess {
  readonly success: true;
  readonly width: number;
  readonly height: number;
  readonly mode: 'gpu' | 'dom';
  readonly dataUrl: string;
  readonly canvasSource?: string;
}

export interface PreviewCaptureFailure {
  readonly success: false;
  readonly error: string;
}

export type PreviewCaptureResult = PreviewCaptureSuccess | PreviewCaptureFailure;

export interface StablePreviewCaptureResult {
  readonly capture: PreviewCaptureResult;
  readonly attempts: number;
  readonly stable: boolean;
  readonly waitedMs: number;
}

export interface StablePreviewCaptureOptions {
  readonly settleMs?: number;
  readonly pollIntervalMs?: number;
  readonly minimumStableWindowMs?: number;
  readonly maximumWaitMs?: number;
}

function normalizePreviewCaptureMode(mode: unknown): PreviewCaptureMode {
  return mode === 'gpu' || mode === 'dom' || mode === 'auto' ? mode : 'auto';
}

function captureDomPreviewCanvas(): PreviewCaptureResult {
  const captureCanvas = renderHostPort.getCaptureCanvas();
  if (!captureCanvas) {
    return { success: false, error: 'Failed to capture frame - preview canvas not available' };
  }

  try {
    return {
      success: true,
      width: captureCanvas.canvas.width,
      height: captureCanvas.canvas.height,
      mode: 'dom',
      canvasSource: captureCanvas.source,
      dataUrl: captureCanvas.canvas.toDataURL('image/png'),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error
        ? `Failed to capture frame from preview canvas: ${error.message}`
        : 'Failed to capture frame from preview canvas',
    };
  }
}

async function captureGpuReadback(): Promise<PreviewCaptureResult> {
  const pixels = await renderHostPort.readPixels();
  if (!pixels) {
    return { success: false, error: 'Failed to capture frame - GPU readback unavailable' };
  }

  const { width, height } = renderHostPort.getOutputDimensions();
  if (width <= 0 || height <= 0) {
    return { success: false, error: 'Failed to capture frame - invalid output dimensions' };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { success: false, error: 'Failed to create canvas context' };
  }

  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
  ctx.putImageData(imageData, 0, 0);
  return {
    success: true,
    width,
    height,
    mode: 'gpu',
    dataUrl: canvas.toDataURL('image/png'),
  };
}

export async function captureRenderHostFrame(modeInput: unknown = 'auto'): Promise<PreviewCaptureResult> {
  const mode = normalizePreviewCaptureMode(modeInput);
  if (mode === 'dom') return captureDomPreviewCanvas();

  const gpuResult = await captureGpuReadback();
  if (gpuResult.success || mode === 'gpu') return gpuResult;

  return captureDomPreviewCanvas();
}

function boundedMilliseconds(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.round(value)))
    : fallback;
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

/**
 * Wait for the render host to present the same successful frame twice after a
 * short observation window. This avoids returning an intermediate frame while
 * newly-created layers are still reaching the renderer, without introducing an
 * unbounded wait into the agent loop.
 */
export async function captureStableRenderHostFrame(
  modeInput: unknown = 'auto',
  options: StablePreviewCaptureOptions = {},
): Promise<StablePreviewCaptureResult> {
  const settleMs = boundedMilliseconds(options.settleMs, 120, 1_500);
  const pollIntervalMs = boundedMilliseconds(options.pollIntervalMs, 120, 500);
  const minimumStableWindowMs = boundedMilliseconds(
    options.minimumStableWindowMs,
    Math.max(360, settleMs),
    1_500,
  );
  const maximumWaitMs = Math.max(
    minimumStableWindowMs,
    boundedMilliseconds(options.maximumWaitMs, 1_200, 2_000),
  );

  let waitedMs = 0;
  let attempts = 0;
  let previousDataUrl: string | null = null;
  let latestCapture: PreviewCaptureResult = {
    success: false,
    error: 'Failed to capture a stable frame',
  };

  await wait(settleMs);
  waitedMs += settleMs;

  while (true) {
    try {
      renderHostPort.requestRender();
    } catch {
      // Capture can still succeed through the currently presented canvas.
    }
    latestCapture = await captureRenderHostFrame(modeInput);
    attempts += 1;

    if (
      latestCapture.success
      && latestCapture.dataUrl === previousDataUrl
      && waitedMs >= minimumStableWindowMs
    ) {
      return { capture: latestCapture, attempts, stable: true, waitedMs };
    }
    previousDataUrl = latestCapture.success ? latestCapture.dataUrl : null;

    if (waitedMs >= maximumWaitMs) {
      return { capture: latestCapture, attempts, stable: false, waitedMs };
    }
    const nextWait = Math.min(pollIntervalMs, maximumWaitMs - waitedMs);
    await wait(nextWait);
    waitedMs += nextWait;
  }
}
