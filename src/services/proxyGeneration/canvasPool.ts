export interface CanvasSlot {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

export function createCanvasSlot(width: number, height: number, errorMessage: string): CanvasSlot {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(errorMessage);
  }
  return { canvas, ctx };
}

export function createCanvasPool(size: number, width: number, height: number): CanvasSlot[] {
  return Array.from({ length: size }, () =>
    createCanvasSlot(width, height, 'Failed to create proxy canvas context')
  );
}
