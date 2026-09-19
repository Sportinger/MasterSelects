function positiveFinite(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Scale factor that converts the compositor's aspect-fit footprint to native
 * source pixels. The output dimensions must be the unscaled reference
 * composition, never a quality-scaled render target. Multiplying the stored
 * clip scale by this value makes 1.0 mean one source pixel per composition
 * pixel.
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

/**
 * Stored uniform scale required to cover the whole composition. Parts of a
 * source with a different aspect ratio may extend beyond the frame.
 */
export function calculateFillToFrameScale(
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

  return Math.max(
    safeOutputWidth / safeSourceWidth,
    safeOutputHeight / safeSourceHeight,
  );
}

/** Independent axis scales that stretch the source to every composition edge. */
export function calculateStretchToFrameScale(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): { x: number; y: number } {
  const safeSourceWidth = positiveFinite(sourceWidth);
  const safeSourceHeight = positiveFinite(sourceHeight);
  const safeOutputWidth = positiveFinite(outputWidth);
  const safeOutputHeight = positiveFinite(outputHeight);
  if (!safeSourceWidth || !safeSourceHeight || !safeOutputWidth || !safeOutputHeight) {
    return { x: 1, y: 1 };
  }

  return {
    x: safeOutputWidth / safeSourceWidth,
    y: safeOutputHeight / safeSourceHeight,
  };
}
