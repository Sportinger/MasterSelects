export interface NormalizedCanvasContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const contentBoundsByCanvas = new WeakMap<HTMLCanvasElement, Readonly<NormalizedCanvasContentBounds>>();

/** Associates runtime-only visible-pixel bounds with a generated canvas. */
export function setCanvasContentBounds(
  canvas: HTMLCanvasElement,
  bounds: NormalizedCanvasContentBounds | undefined,
): void {
  if (!bounds) {
    contentBoundsByCanvas.delete(canvas);
    return;
  }
  contentBoundsByCanvas.set(canvas, Object.freeze({ ...bounds }));
}

export function getCanvasContentBounds(
  canvas: HTMLCanvasElement | undefined,
): Readonly<NormalizedCanvasContentBounds> | undefined {
  return canvas ? contentBoundsByCanvas.get(canvas) : undefined;
}
