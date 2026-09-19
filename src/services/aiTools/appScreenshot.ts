import type { Options as ModernScreenshotOptions } from 'modern-screenshot';

import type { ToolResult } from './types';

const DEFAULT_SCALE = 1;
const MIN_REQUESTED_SCALE = 0.25;
const MAX_REQUESTED_SCALE = 2;
const MAX_OUTPUT_DIMENSION = 8_192;
const MAX_OUTPUT_PIXELS = 12_000_000;
const MAX_SOURCE_DIMENSION = 32_768;
const MAX_SETTLE_MS = 5_000;

interface CaptureGeometry {
  appliedScale: number;
  fullPage: boolean;
  outputHeight: number;
  outputWidth: number;
  requestedScale: number;
  sourceHeight: number;
  sourceWidth: number;
}

function positiveDimension(...values: number[]): number {
  return Math.max(1, ...values.filter((value) => Number.isFinite(value) && value > 0));
}

function requestedScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SCALE;
  return Math.max(MIN_REQUESTED_SCALE, Math.min(MAX_REQUESTED_SCALE, value));
}

function settleMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_SETTLE_MS, Math.round(value)));
}

export function resolveAppScreenshotGeometry(
  fullPage: boolean,
  scaleValue: unknown,
): CaptureGeometry {
  const root = document.documentElement;
  const body = document.body;
  const sourceWidth = Math.ceil(fullPage
    ? positiveDimension(root.scrollWidth, root.clientWidth, body?.scrollWidth ?? 0, window.innerWidth)
    : positiveDimension(window.innerWidth, root.clientWidth));
  const sourceHeight = Math.ceil(fullPage
    ? positiveDimension(root.scrollHeight, root.clientHeight, body?.scrollHeight ?? 0, window.innerHeight)
    : positiveDimension(window.innerHeight, root.clientHeight));

  if (sourceWidth > MAX_SOURCE_DIMENSION || sourceHeight > MAX_SOURCE_DIMENSION) {
    throw new Error(
      `App screenshot source is too large (${sourceWidth}x${sourceHeight} CSS pixels; maximum ${MAX_SOURCE_DIMENSION} per side).`,
    );
  }

  const requested = requestedScale(scaleValue);
  const dimensionScale = Math.min(
    MAX_OUTPUT_DIMENSION / sourceWidth,
    MAX_OUTPUT_DIMENSION / sourceHeight,
  );
  const pixelScale = Math.sqrt(MAX_OUTPUT_PIXELS / (sourceWidth * sourceHeight));
  const appliedScale = Math.min(requested, dimensionScale, pixelScale);

  return {
    appliedScale,
    fullPage,
    outputHeight: Math.max(1, Math.floor(sourceHeight * appliedScale)),
    outputWidth: Math.max(1, Math.floor(sourceWidth * appliedScale)),
    requestedScale: requested,
    sourceHeight,
    sourceWidth,
  };
}

function captureOptions(geometry: CaptureGeometry): ModernScreenshotOptions {
  return {
    features: { restoreScrollPosition: true },
    height: geometry.sourceHeight,
    maximumCanvasSize: MAX_OUTPUT_DIMENSION,
    scale: geometry.appliedScale,
    timeout: 20_000,
    type: 'image/png',
    width: geometry.sourceWidth,
    ...(geometry.fullPage
      ? {
          style: {
            height: `${geometry.sourceHeight}px`,
            width: `${geometry.sourceWidth}px`,
          },
        }
      : {}),
  };
}

export async function handleCaptureAppScreenshot(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { success: false, error: 'App screenshots require a connected browser tab.' };
  }

  const root = document.documentElement;
  if (!root) return { success: false, error: 'The browser document is not ready.' };

  try {
    const fullPage = args.fullPage === true;
    const geometry = resolveAppScreenshotGeometry(fullPage, args.scale);
    const wait = settleMs(args.settleMs);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    const { domToPng } = await import('modern-screenshot');
    const dataUrl = await domToPng(root, captureOptions(geometry));
    if (!dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('DOM capture returned an invalid PNG data URL.');
    }

    return {
      success: true,
      data: {
        appliedScale: geometry.appliedScale,
        capturedAt: Date.now(),
        constrained: geometry.appliedScale < geometry.requestedScale,
        dataUrl,
        fullPage,
        outputPixels: {
          height: geometry.outputHeight,
          width: geometry.outputWidth,
        },
        page: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          title: document.title,
          url: window.location.href,
        },
        requestedScale: geometry.requestedScale,
        sourceCssPixels: {
          height: geometry.sourceHeight,
          width: geometry.sourceWidth,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'App screenshot capture failed.',
    };
  }
}
