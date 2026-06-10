export interface GaussianSplatRenderTargetSummary {
  width: number;
  height: number;
  centerPixel: [number, number, number, number];
  nonTransparentSampled: number;
  nonBlackSampled: number;
}

const BYTES_PER_PIXEL = 4;

export interface RenderTargetReadbackLayout {
  bytesPerPixel: number;
  unalignedBytesPerRow: number;
  bytesPerRow: number;
  bufferSize: number;
}

export function buildRenderTargetReadbackLayout(width: number, height: number): RenderTargetReadbackLayout {
  const unalignedBytesPerRow = width * BYTES_PER_PIXEL;
  const bytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
  return {
    bytesPerPixel: BYTES_PER_PIXEL,
    unalignedBytesPerRow,
    bytesPerRow,
    bufferSize: bytesPerRow * height,
  };
}

export function summarizeRenderTargetPixels(
  src: Uint8Array,
  width: number,
  height: number,
  layout: RenderTargetReadbackLayout,
): Omit<GaussianSplatRenderTargetSummary, 'width' | 'height'> {
  const pixels = new Uint8Array(width * height * layout.bytesPerPixel);

  for (let y = 0; y < height; y += 1) {
    const srcOffset = y * layout.bytesPerRow;
    const dstOffset = y * layout.unalignedBytesPerRow;
    pixels.set(src.subarray(srcOffset, srcOffset + layout.unalignedBytesPerRow), dstOffset);
  }

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const centerIndex = (centerY * width + centerX) * layout.bytesPerPixel;
  const centerPixel: [number, number, number, number] = [
    pixels[centerIndex] ?? 0,
    pixels[centerIndex + 1] ?? 0,
    pixels[centerIndex + 2] ?? 0,
    pixels[centerIndex + 3] ?? 0,
  ];

  let nonTransparentSampled = 0;
  let nonBlackSampled = 0;
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 64));
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = (y * width + x) * layout.bytesPerPixel;
      const r = pixels[index] ?? 0;
      const g = pixels[index + 1] ?? 0;
      const b = pixels[index + 2] ?? 0;
      const a = pixels[index + 3] ?? 0;
      if (a > 0) nonTransparentSampled++;
      if (r > 0 || g > 0 || b > 0) nonBlackSampled++;
    }
  }

  return {
    centerPixel,
    nonTransparentSampled,
    nonBlackSampled,
  };
}
