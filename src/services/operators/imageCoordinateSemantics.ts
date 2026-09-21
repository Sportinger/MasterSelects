export function imageIntegerCellOrigin(pixel: readonly [number, number], size: number): [number, number] {
  if (!pixel.every(Number.isFinite) || !Number.isFinite(size)) throw new Error('Integer cell coordinates must be finite.');
  const pixelF32 = pixel.map(Math.fround) as [number, number], sizeF32 = Math.fround(size);
  const integerPixel = pixelF32.map(Math.trunc) as [number, number];
  if (integerPixel.some(value => value < 0 || value >= 0x80000000)
    || !Number.isInteger(sizeF32) || sizeF32 < 1 || sizeF32 >= 0x80000000) {
    throw new Error('Integer cell coordinates must fit positive i32 image coordinates.');
  }
  return integerPixel.map(value => Math.trunc(value / sizeF32) * sizeF32) as [number, number];
}
