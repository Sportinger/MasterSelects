export interface DepthFrame {
  width: number;
  height: number;
  values: Float32Array;
  milliseconds: number;
}
export interface DepthRange { low: number; high: number }
/** Preserve source aspect; model patch size is 14. Bounded even for panoramas. */
export function depthInputSize(width: number, height: number, edge: number) {
  if (!(width > 0 && height > 0) || ![280, 518].includes(edge)) throw new Error('Invalid depth input size.');
  const scale = edge / Math.max(width, height);
  return { width: Math.max(28, Math.round(width * scale / 14) * 14), height: Math.max(28, Math.round(height * scale / 14) * 14) };
}
/** Robust relative inverse depth: white is near, black is far. No metric units. */
export function normalizeDepth(values: Float32Array, previous?: DepthRange, smoothing = 0): { pixels: Uint8Array; range: DepthRange } {
  if (!values.length || !values.every(Number.isFinite)) throw new Error('The model returned invalid depth values.');
  const sorted = values.toSorted();
  let low = sorted[Math.floor((sorted.length - 1) * 0.02)], high = sorted[Math.floor((sorted.length - 1) * 0.98)];
  // Smooth only the range, not moving geometry. Reset on large range discontinuities.
  const weight = Math.max(0, Math.min(0.95, smoothing));
  if (previous && Math.abs(low - previous.low) + Math.abs(high - previous.high) < Math.max(1e-5, previous.high - previous.low) * 2) {
    low = previous.low * weight + low * (1 - weight); high = previous.high * weight + high * (1 - weight);
  }
  const span = high - low;
  return { pixels: Uint8Array.from(values, value => span > 1e-6 ? Math.round(Math.max(0, Math.min(1, (value - low) / span)) * 255) : 128), range: { low, high } };
}
export function depthImage(pixels: Uint8Array, width: number, height: number, invert = false): ImageData {
  if (pixels.length !== width * height) throw new Error('Invalid depth map dimensions.');
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) { const v = invert ? 255 - pixels[i] : pixels[i]; rgba.set([v, v, v, 255], i * 4); }
  return new ImageData(rgba, width, height);
}
