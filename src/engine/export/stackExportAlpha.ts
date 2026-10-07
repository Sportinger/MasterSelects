/** Match output.wgsl mode 2 for compositor readback: RGB above alpha-as-luma. */
export function stackExportAlpha(pixels: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const result = new Uint8ClampedArray(pixels.length * 2);
  for (let i = 0; i < pixels.length; i += 4) {
    result[i] = pixels[i]; result[i + 1] = pixels[i + 1]; result[i + 2] = pixels[i + 2]; result[i + 3] = 255;
    const bottom = pixels.length + i, alpha = pixels[i + 3];
    result[bottom] = alpha; result[bottom + 1] = alpha; result[bottom + 2] = alpha; result[bottom + 3] = 255;
  }
  return result;
}
