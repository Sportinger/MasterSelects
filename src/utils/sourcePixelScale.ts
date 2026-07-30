function positiveFinite(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Scale factor that converts the compositor's aspect-fit footprint to native
 * source pixels. Multiplying the stored clip scale by this value makes 1.0
 * mean one source pixel per composition pixel.
 */
export function calculateSourcePixelScale(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): number {
  const safeSourceWidth = positiveFinite(sourceWidth);
  const safeSourceHeight = positiveFinite(sourceHeight);
  const safeOutputWidth = positiveFinite(outputWidth);
  const safeOutputHeight = positiveFinite(outputHeight);
  if (!safeSourceWidth || !safeSourceHeight || !safeOutputWidth || !safeOutputHeight) {
    return 1;
  }

  const sourceAspect = safeSourceWidth / safeSourceHeight;
  const outputAspect = safeOutputWidth / safeOutputHeight;
  return sourceAspect >= outputAspect
    ? safeSourceWidth / safeOutputWidth
    : safeSourceHeight / safeOutputHeight;
}

/**
 * Stored uniform scale required to fit the whole source inside the composition
 * after 1.0 has been defined as native source size.
 */
export function calculateFitToFrameScale(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): number {
  return 1 / calculateSourcePixelScale(
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
  );
}
