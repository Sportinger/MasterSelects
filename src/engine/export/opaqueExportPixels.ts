/**
 * Match output.wgsl's normal output: keep the compositor RGB and present it
 * opaquely over black. RGB already contains layer coverage. Feeding its alpha
 * to ImageData/VideoFrame would apply that coverage a second time.
 * Keep the host's readback intact for alpha-capable consumers.
 */
export function opaqueExportPixels(pixels: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(pixels);
  for (let i = 3; i < output.length; i += 4) output[i] = 255;
  return output;
}
