export type ImageDerivativeMode = 'auto' | 'fine' | 'coarse';

/** Evaluates the four fragment centers of the 2x2 quad containing pixelCoordinate. */
export function evaluateImageDerivativeQuad(
  pixelCoordinate: readonly [number, number],
  resolution: readonly [number, number],
  mode: ImageDerivativeMode,
  autoMode: Exclude<ImageDerivativeMode, 'auto'> | undefined,
  evaluate: (uv: [number, number]) => number,
): [number, number] {
  const resolvedMode = mode === 'auto' ? autoMode : mode;
  if (!resolvedMode) throw new Error('Automatic image derivatives require an explicit fine or coarse CPU policy.');
  const left = Math.floor(pixelCoordinate[0] / 2) * 2;
  const top = Math.floor(pixelCoordinate[1] / 2) * 2;
  const at = (x: number, y: number) => evaluate([(x + 0.5) / resolution[0], (y + 0.5) / resolution[1]]);
  const topLeft = at(left, top), topRight = at(left + 1, top);
  const bottomLeft = at(left, top + 1), bottomRight = at(left + 1, top + 1);
  if (resolvedMode === 'coarse') return [topRight - topLeft, bottomLeft - topLeft];
  return [pixelCoordinate[1] % 2 ? bottomRight - bottomLeft : topRight - topLeft,
    pixelCoordinate[0] % 2 ? bottomRight - topRight : bottomLeft - topLeft];
}
