export function bumpCanvasVersion(canvas: HTMLCanvasElement): void {
  const current = Number(canvas.dataset.masterselectsVersion ?? 0);
  canvas.dataset.masterselectsVersion = String(Number.isFinite(current) ? current + 1 : 1);
}

export function markDynamicCanvasUpdated(canvas: HTMLCanvasElement, kind: string): void {
  canvas.dataset.masterselectsDynamic = kind;
  bumpCanvasVersion(canvas);
}

export function getCanvasVersion(canvas: HTMLCanvasElement | undefined): string {
  return canvas?.dataset.masterselectsVersion ?? '0';
}
