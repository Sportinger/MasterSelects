// Mask Renderer - Generates mask textures from ClipMask data using Canvas2D

import type { ClipMask, MaskVertex } from '../types';

// Canvas for rendering masks (reused for performance)
let maskCanvas: OffscreenCanvas | null = null;
let maskCtx: OffscreenCanvasRenderingContext2D | null = null;
let maskShapeCanvas: OffscreenCanvas | null = null;
let maskShapeCtx: OffscreenCanvasRenderingContext2D | null = null;
let blurCanvas: OffscreenCanvas | null = null;
let blurCtx: OffscreenCanvasRenderingContext2D | null = null;

export interface MaskTextureRenderOptions {
  featherScale?: number;
  maxFeatherQualityScale?: number;
}

// Ensure canvas exists at given size
function ensureMaskCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!maskCanvas || maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas = new OffscreenCanvas(width, height);
    maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!maskCtx) {
    throw new Error('Failed to get 2D context for mask canvas');
  }
  return maskCtx;
}

// Append a single bezier path for a mask to the current Canvas2D path
function traceMaskPath(
  ctx: OffscreenCanvasRenderingContext2D,
  vertices: MaskVertex[],
  closed: boolean,
  width: number,
  height: number,
  offsetX: number = 0,
  offsetY: number = 0
): boolean {
  if (vertices.length < 2) return false;

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const x = (v.x + offsetX) * width;
    const y = (v.y + offsetY) * height;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      const prev = vertices[i - 1];
      const prevX = (prev.x + offsetX) * width;
      const prevY = (prev.y + offsetY) * height;

      // Control points for cubic bezier
      const cp1x = prevX + prev.handleOut.x * width;
      const cp1y = prevY + prev.handleOut.y * height;
      const cp2x = x + v.handleIn.x * width;
      const cp2y = y + v.handleIn.y * height;

      // Check if handles are at origin (straight line)
      const isStraight =
        prev.handleOut.x === 0 && prev.handleOut.y === 0 &&
        v.handleIn.x === 0 && v.handleIn.y === 0;

      if (isStraight) {
        ctx.lineTo(x, y);
      } else {
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
      }
    }
  }

  // Close path if needed
  if (closed && vertices.length > 2) {
    const last = vertices[vertices.length - 1];
    const first = vertices[0];

    const lastX = (last.x + offsetX) * width;
    const lastY = (last.y + offsetY) * height;
    const firstX = (first.x + offsetX) * width;
    const firstY = (first.y + offsetY) * height;

    const cp1x = lastX + last.handleOut.x * width;
    const cp1y = lastY + last.handleOut.y * height;
    const cp2x = firstX + first.handleIn.x * width;
    const cp2y = firstY + first.handleIn.y * height;

    const isStraight =
      last.handleOut.x === 0 && last.handleOut.y === 0 &&
      first.handleIn.x === 0 && first.handleIn.y === 0;

    if (isStraight) {
      ctx.lineTo(firstX, firstY);
    } else {
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, firstX, firstY);
    }
    ctx.closePath();
  }

  return true;
}

function ensureBlurCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!blurCanvas || blurCanvas.width !== width || blurCanvas.height !== height) {
    blurCanvas = new OffscreenCanvas(width, height);
    blurCtx = blurCanvas.getContext('2d', { willReadFrequently: false });
  }
  if (!blurCtx) {
    throw new Error('Failed to get 2D context for mask blur canvas');
  }
  return blurCtx;
}

function ensureMaskShapeCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!maskShapeCanvas || maskShapeCanvas.width !== width || maskShapeCanvas.height !== height) {
    maskShapeCanvas = new OffscreenCanvas(width, height);
    maskShapeCtx = maskShapeCanvas.getContext('2d', { willReadFrequently: false });
  }
  if (!maskShapeCtx) {
    throw new Error('Failed to get 2D context for mask shape canvas');
  }
  return maskShapeCtx;
}

// Draw a single bezier path for a mask
function drawMaskPath(
  ctx: OffscreenCanvasRenderingContext2D,
  vertices: MaskVertex[],
  closed: boolean,
  width: number,
  height: number,
  offsetX: number = 0,
  offsetY: number = 0,
  inverted: boolean = false
): void {
  ctx.beginPath();

  if (inverted) {
    ctx.rect(0, 0, width, height);
  }

  if (!traceMaskPath(ctx, vertices, closed, width, height, offsetX, offsetY)) {
    return;
  }

  ctx.fill(inverted ? 'evenodd' : 'nonzero');
}

function getFeatherQualityScale(featherQuality: number | undefined): number {
  const quality = Math.min(100, Math.max(1, Math.round(featherQuality ?? 50)));
  if (quality <= 33) return 0.5;
  if (quality <= 66) return 0.75;
  return 1;
}

function renderMaskAlpha(mask: ClipMask, width: number, height: number): OffscreenCanvas {
  const shapeCtx = ensureMaskShapeCanvas(width, height);
  shapeCtx.globalCompositeOperation = 'source-over';
  shapeCtx.filter = 'none';
  shapeCtx.clearRect(0, 0, width, height);
  shapeCtx.fillStyle = '#ffffff';
  drawMaskPath(
    shapeCtx,
    mask.vertices,
    mask.closed,
    width,
    height,
    mask.position.x,
    mask.position.y,
    mask.inverted,
  );
  return maskShapeCanvas!;
}

function applyFeatherToShapeCanvas(
  width: number,
  height: number,
  feather: number,
  featherQualityScale: number,
): OffscreenCanvas {
  if (feather <= 0.5) return maskShapeCanvas!;

  const blurWidth = Math.max(1, Math.round(width * featherQualityScale));
  const blurHeight = Math.max(1, Math.round(height * featherQualityScale));
  const tempCtx = ensureBlurCanvas(blurWidth, blurHeight);
  tempCtx.globalCompositeOperation = 'source-over';
  tempCtx.filter = 'none';
  tempCtx.clearRect(0, 0, blurWidth, blurHeight);
  tempCtx.drawImage(maskShapeCanvas!, 0, 0, blurWidth, blurHeight);

  const shapeCtx = ensureMaskShapeCanvas(width, height);
  shapeCtx.globalCompositeOperation = 'source-over';
  shapeCtx.clearRect(0, 0, width, height);
  shapeCtx.filter = `blur(${feather}px)`;
  shapeCtx.drawImage(blurCanvas!, 0, 0, width, height);
  shapeCtx.filter = 'none';
  return maskShapeCanvas!;
}

function alphaToMaskImageData(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): ImageData {
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i + 3];
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return imageData;
}

// Generate a mask texture from an array of ClipMask
export function generateMaskTexture(
  masks: ClipMask[],
  width: number,
  height: number,
  options: MaskTextureRenderOptions = {},
): ImageData | null {
  if (!masks || masks.length === 0) return null;

  const enabledMasks = masks.filter(m => m.enabled !== false && m.vertices.length >= 3 && m.closed);
  if (enabledMasks.length === 0) return null;

  const ctx = ensureMaskCanvas(width, height);
  const featherScale = options.featherScale ?? 1;

  // Compose mask semantics into alpha, then copy alpha into RGB at the end.
  // Canvas destination-out/destination-in operate on alpha, while the GPU
  // compositor samples the red channel.
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  const firstMask = enabledMasks[0];
  if (firstMask?.mode === 'subtract' || firstMask?.mode === 'intersect') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  // Process each mask
  for (const mask of enabledMasks) {
    renderMaskAlpha(mask, width, height);
    const feather = (mask.feather || 0) * featherScale;
    const baseFeatherQualityScale = getFeatherQualityScale(mask.featherQuality);
    const featherQualityScale = options.maxFeatherQualityScale
      ? Math.min(baseFeatherQualityScale, options.maxFeatherQualityScale)
      : baseFeatherQualityScale;
    const maskCanvasSource = applyFeatherToShapeCanvas(width, height, feather, featherQualityScale);

    // Set composite operation based on mask mode
    switch (mask.mode) {
      case 'add':
        // Union this mask into the visible alpha.
        ctx.globalCompositeOperation = 'source-over';
        break;
      case 'subtract':
        // Remove this mask's alpha from the visible alpha.
        ctx.globalCompositeOperation = 'destination-out';
        break;
      case 'intersect':
        // Keep only the overlap between current alpha and this mask's alpha.
        ctx.globalCompositeOperation = 'destination-in';
        break;
    }

    ctx.drawImage(maskCanvasSource, 0, 0);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  return alphaToMaskImageData(ctx, width, height);
}

// Generate mask texture for a single mask (simpler API for common case)
export function generateSingleMaskTexture(
  mask: ClipMask,
  width: number,
  height: number
): ImageData | null {
  if (!mask || mask.enabled === false || mask.vertices.length < 3 || !mask.closed) return null;

  const ctx = ensureMaskCanvas(width, height);

  // Start with black (mask area = white, outside = black)
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // Draw mask as white. Layer opacity is handled by the clip transform.
  ctx.fillStyle = '#ffffff';
  drawMaskPath(ctx, mask.vertices, mask.closed, width, height, mask.position.x, mask.position.y, mask.inverted);

  // Feather is applied by generateMaskTexture for the multi-mask render path.

  return ctx.getImageData(0, 0, width, height);
}

// Convert ImageData to a format suitable for WebGPU texture
export function imageDataToUint8Array(imageData: ImageData): Uint8Array {
  return new Uint8Array(imageData.data.buffer);
}
