export interface WorkerSoftwareBitmapSnapshotMaxSize {
  readonly width: number;
  readonly height: number;
}

export interface WorkerSoftwareBitmapSnapshotInput {
  readonly source: ImageBitmapSource;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly maxSize?: WorkerSoftwareBitmapSnapshotMaxSize;
  readonly resizeQuality?: ResizeQuality;
}

export interface WorkerSoftwareBitmapSnapshot {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
}

function positiveFinite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function bitmapDimensions(
  bitmap: ImageBitmap,
  fallback: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } {
  return {
    width: positiveFinite(bitmap.width) ?? fallback.width,
    height: positiveFinite(bitmap.height) ?? fallback.height,
  };
}

function constrainedSnapshotSize(input: WorkerSoftwareBitmapSnapshotInput): WorkerSoftwareBitmapSnapshotMaxSize | null {
  const sourceWidth = positiveFinite(input.sourceWidth);
  const sourceHeight = positiveFinite(input.sourceHeight);
  const maxWidth = positiveFinite(input.maxSize?.width);
  const maxHeight = positiveFinite(input.maxSize?.height);
  if (!sourceWidth || !sourceHeight || !maxWidth || !maxHeight) return null;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
  if (scale >= 0.999) return null;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function getCanvas2dContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return context && 'drawImage' in context ? context : null;
}

function createResizeCanvas(width: number, height: number): {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} | null {
  const canvasWidth = Math.max(1, Math.round(width));
  const canvasHeight = Math.max(1, Math.round(height));
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(canvasWidth, canvasHeight)
    : typeof document !== 'undefined'
      ? document.createElement('canvas')
      : null;
  if (!canvas) return null;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = getCanvas2dContext(canvas);
  return context ? { canvas, context } : null;
}

async function createCanvasResizedBitmap(
  input: WorkerSoftwareBitmapSnapshotInput,
  constrained: WorkerSoftwareBitmapSnapshotMaxSize,
): Promise<WorkerSoftwareBitmapSnapshot | null> {
  const target = createResizeCanvas(constrained.width, constrained.height);
  if (!target) return null;
  try {
    target.context.drawImage(
      input.source as CanvasImageSource,
      0,
      0,
      constrained.width,
      constrained.height,
    );
    const bitmap = await createImageBitmap(target.canvas as ImageBitmapSource);
    return { bitmap, ...bitmapDimensions(bitmap, constrained) };
  } catch {
    return null;
  }
}

export async function createWorkerSoftwareBitmapSnapshot(
  input: WorkerSoftwareBitmapSnapshotInput,
): Promise<WorkerSoftwareBitmapSnapshot> {
  const constrained = constrainedSnapshotSize(input);
  if (constrained) {
    try {
      const bitmap = await createImageBitmap(input.source, {
        resizeWidth: constrained.width,
        resizeHeight: constrained.height,
        resizeQuality: input.resizeQuality ?? 'medium',
      });
      return { bitmap, ...bitmapDimensions(bitmap, constrained) };
    } catch {
      // Some engines support createImageBitmap but not resize options for videos.
    }
    const canvasResized = await createCanvasResizedBitmap(input, constrained);
    if (canvasResized) return canvasResized;
  }
  const bitmap = await createImageBitmap(input.source);
  return {
    bitmap,
    ...bitmapDimensions(bitmap, {
      width: Math.max(1, Math.round(input.sourceWidth)),
      height: Math.max(1, Math.round(input.sourceHeight)),
    }),
  };
}
