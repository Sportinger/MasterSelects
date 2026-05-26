export const MAX_SPECTROGRAM_CSS_WIDTH = 8192;
export const MAX_SPECTROGRAM_DRAW_PIXELS = 524_288;
export const MAX_SPECTROGRAM_DPR = 2;

export interface SpectrogramCanvasPlanInput {
  clipWidth: number;
  height: number;
  renderStartPx?: number;
  renderWidth?: number;
  dpr?: number;
}

export interface SpectrogramCanvasPlan {
  startPx: number;
  cssCanvasWidth: number;
  drawWidth: number;
  drawHeight: number;
  effectiveDpr: number;
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

export function resolveSpectrogramCanvasPlan(input: SpectrogramCanvasPlanInput): SpectrogramCanvasPlan {
  const clipWidth = positiveFinite(input.clipWidth, 1);
  const height = positiveFinite(input.height, 1);
  const requestedDpr = positiveFinite(input.dpr, 1);
  const effectiveDpr = Math.max(1, Math.min(MAX_SPECTROGRAM_DPR, requestedDpr));
  const startPx = Math.max(0, Math.min(clipWidth, Number.isFinite(input.renderStartPx) ? input.renderStartPx ?? 0 : 0));
  const targetWidth = Math.max(1, Math.min(
    clipWidth - startPx,
    Number.isFinite(input.renderWidth) && input.renderWidth !== undefined ? input.renderWidth : clipWidth,
  ));
  const cssCanvasWidth = Math.max(1, Math.min(targetWidth, MAX_SPECTROGRAM_CSS_WIDTH));
  const drawHeight = Math.max(1, Math.floor(height * effectiveDpr));
  const widthFromDpr = Math.max(1, Math.floor(cssCanvasWidth * effectiveDpr));
  const widthFromPixelBudget = Math.max(1, Math.floor(MAX_SPECTROGRAM_DRAW_PIXELS / drawHeight));
  const drawWidth = Math.max(1, Math.min(widthFromDpr, widthFromPixelBudget));

  return {
    startPx,
    cssCanvasWidth,
    drawWidth,
    drawHeight,
    effectiveDpr,
  };
}
