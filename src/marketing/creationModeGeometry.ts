export function creationModeMaskRadius(
  viewportRadius: number,
  maskScaleX: number,
  maskScaleY: number,
): string {
  const maskRadiusX = viewportRadius / Math.max(maskScaleX, 0.01);
  const maskRadiusY = viewportRadius / Math.max(maskScaleY, 0.01);
  return `${maskRadiusX}px / ${maskRadiusY}px`;
}
