// Mask Renderer - Generates mask textures from ClipMask data using Canvas2D

import type { ClipMask, MaskVertex } from '../types';
import { transformMaskPoint } from './maskTransform';

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

function getRenderedEdgeFeathers(mask: ClipMask): readonly (readonly [number, number, number])[] {
  if (!mask.edgeFeathers) return [];

  // Vertex ids are authoring identities rather than raster inputs. Resolve
  // feathered edges to their vertex positions so equivalent cloned masks can
  // share a raster even when their generated ids differ.
  const vertexIndexById = new Map(mask.vertices.map((vertex, index) => [vertex.id, index]));
  const renderedEdges: Array<readonly [number, number, number]> = [];
  for (const [edgeId, feather] of Object.entries(mask.edgeFeathers)) {
    const [fromId, toId] = edgeId.split('->');
    const fromIndex = fromId ? vertexIndexById.get(fromId) : undefined;
    const toIndex = toId ? vertexIndexById.get(toId) : undefined;
    if (fromIndex === undefined || toIndex === undefined) continue;
    renderedEdges.push([fromIndex, toIndex, feather]);
  }
  return renderedEdges.toSorted((a, b) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  );
}

/** Exact content key for CPU mask rasters; excludes authoring-only labels and ids. */
export function createMaskTextureRasterKey(
  masks: readonly ClipMask[],
  width: number,
  height: number,
  options: MaskTextureRenderOptions = {},
): string {
  const renderedMasks = masks
    .filter(mask => mask.enabled !== false && mask.vertices.length >= 3 && mask.closed)
    .map(mask => ({
      closed: mask.closed,
      inverted: mask.inverted,
      mode: mask.mode,
      // Retain opacity in the key so enabling mask-opacity raster semantics in
      // the renderer cannot make an existing cache entry visually stale.
      opacity: mask.opacity,
      position: [mask.position.x, mask.position.y],
      rotation: mask.rotation ?? 0,
      feather: mask.feather || 0,
      featherQuality: mask.featherQuality ?? 50,
      vertices: mask.vertices.map(vertex => [
        vertex.x,
        vertex.y,
        vertex.handleIn.x,
        vertex.handleIn.y,
        vertex.handleOut.x,
        vertex.handleOut.y,
      ]),
      edgeFeathers: getRenderedEdgeFeathers(mask),
    }));

  return JSON.stringify({
    width,
    height,
    featherScale: options.featherScale ?? 1,
    maxFeatherQualityScale: options.maxFeatherQualityScale ?? null,
    masks: renderedMasks,
  });
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
  mask: ClipMask,
  width: number,
  height: number,
): boolean {
  const { vertices, closed } = mask;
  if (vertices.length < 2) return false;
  const pointFor = (point: { x: number; y: number }) => {
    const transformed = transformMaskPoint(mask, point, { width, height });
    return { x: transformed.x * width, y: transformed.y * height };
  };

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const point = pointFor(v);
    const { x, y } = point;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      const prev = vertices[i - 1];
      const cp1 = pointFor({ x: prev.x + prev.handleOut.x, y: prev.y + prev.handleOut.y });
      const cp2 = pointFor({ x: v.x + v.handleIn.x, y: v.y + v.handleIn.y });

      // Check if handles are at origin (straight line)
      const isStraight =
        prev.handleOut.x === 0 && prev.handleOut.y === 0 &&
        v.handleIn.x === 0 && v.handleIn.y === 0;

      if (isStraight) {
        ctx.lineTo(x, y);
      } else {
        ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, x, y);
      }
    }
  }

  // Close path if needed
  if (closed && vertices.length > 2) {
    const last = vertices[vertices.length - 1];
    const first = vertices[0];

    const firstPoint = pointFor(first);
    const cp1 = pointFor({ x: last.x + last.handleOut.x, y: last.y + last.handleOut.y });
    const cp2 = pointFor({ x: first.x + first.handleIn.x, y: first.y + first.handleIn.y });

    const isStraight =
      last.handleOut.x === 0 && last.handleOut.y === 0 &&
      first.handleIn.x === 0 && first.handleIn.y === 0;

    if (isStraight) {
      ctx.lineTo(firstPoint.x, firstPoint.y);
    } else {
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, firstPoint.x, firstPoint.y);
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
  mask: ClipMask,
  width: number,
  height: number,
): void {
  ctx.beginPath();

  if (mask.inverted) {
    ctx.rect(0, 0, width, height);
  }

  if (!traceMaskPath(ctx, mask, width, height)) {
    return;
  }

  ctx.fill(mask.inverted ? 'evenodd' : 'nonzero');
}

function traceMaskEdge(
  ctx: OffscreenCanvasRenderingContext2D,
  mask: ClipMask,
  from: MaskVertex,
  to: MaskVertex,
  width: number,
  height: number,
): void {
  const pointFor = (point: { x: number; y: number }) => {
    const transformed = transformMaskPoint(mask, point, { width, height });
    return { x: transformed.x * width, y: transformed.y * height };
  };
  const fromPoint = pointFor(from);
  const toPoint = pointFor(to);
  const cp1 = pointFor({ x: from.x + from.handleOut.x, y: from.y + from.handleOut.y });
  const cp2 = pointFor({ x: to.x + to.handleIn.x, y: to.y + to.handleIn.y });
  const isStraight =
    from.handleOut.x === 0 && from.handleOut.y === 0 &&
    to.handleIn.x === 0 && to.handleIn.y === 0;

  ctx.moveTo(fromPoint.x, fromPoint.y);
  if (isStraight) {
    ctx.lineTo(toPoint.x, toPoint.y);
  } else {
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, toPoint.x, toPoint.y);
  }
}

function applyEdgeFeathersToShapeCanvas(mask: ClipMask, width: number, height: number, featherScale: number): void {
  const edgeFeathers = mask.edgeFeathers;
  if (!edgeFeathers || Object.keys(edgeFeathers).length === 0) return;

  const verticesById = new Map(mask.vertices.map(vertex => [vertex.id, vertex]));
  const tempCtx = ensureBlurCanvas(width, height);
  const shapeCtx = ensureMaskShapeCanvas(width, height);

  tempCtx.globalCompositeOperation = 'source-over';
  tempCtx.clearRect(0, 0, width, height);
  tempCtx.strokeStyle = '#ffffff';
  tempCtx.lineCap = 'round';
  tempCtx.lineJoin = 'round';

  for (const [edgeId, featherValue] of Object.entries(edgeFeathers)) {
    const feather = Math.max(0, featherValue * featherScale);
    if (feather <= 0.5) continue;

    const [fromId, toId] = edgeId.split('->');
    const from = fromId ? verticesById.get(fromId) : undefined;
    const to = toId ? verticesById.get(toId) : undefined;
    if (!from || !to) continue;

    tempCtx.filter = `blur(${Math.max(1, feather * 0.5)}px)`;
    tempCtx.lineWidth = Math.max(1, feather * 2);
    tempCtx.beginPath();
    traceMaskEdge(tempCtx, mask, from, to, width, height);
    tempCtx.stroke();
  }

  tempCtx.filter = 'none';
  shapeCtx.globalCompositeOperation = 'source-over';
  shapeCtx.drawImage(blurCanvas!, 0, 0);
}

function getFeatherQualityScale(featherQuality: number | undefined): number {
  const quality = Math.min(100, Math.max(1, Math.round(featherQuality ?? 50)));
  if (quality <= 33) return 0.5;
  if (quality <= 66) return 0.75;
  return 1;
}

function renderMaskAlpha(mask: ClipMask, width: number, height: number, featherScale: number): OffscreenCanvas {
  const shapeCtx = ensureMaskShapeCanvas(width, height);
  shapeCtx.globalCompositeOperation = 'source-over';
  shapeCtx.filter = 'none';
  shapeCtx.clearRect(0, 0, width, height);
  shapeCtx.fillStyle = '#ffffff';
  drawMaskPath(shapeCtx, mask, width, height);
  applyEdgeFeathersToShapeCanvas(mask, width, height, featherScale);
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
    renderMaskAlpha(mask, width, height, featherScale);
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
  drawMaskPath(ctx, mask, width, height);

  // Feather is applied by generateMaskTexture for the multi-mask render path.

  return ctx.getImageData(0, 0, width, height);
}

// Convert ImageData to a format suitable for WebGPU texture
export function imageDataToUint8Array(imageData: ImageData): Uint8Array {
  return new Uint8Array(imageData.data.buffer);
}
