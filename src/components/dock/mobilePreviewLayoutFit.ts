export const MOBILE_PORTRAIT_PREVIEW_WIDTH_RATIO = 0.5;

interface ResolveMobilePreviewSplitRatioParams {
  compositionHeight: number;
  compositionWidth: number;
  containerHeight: number;
  containerWidth: number;
  dividerSize: number;
  minimumPreviewHeight: number;
  minimumRemainingHeight: number;
  previewChromeHeight: number;
  previewWidthRatio: number;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clampRatio(value: number): number {
  return Math.max(0.1, Math.min(0.9, value));
}

/**
 * Resolves the vertical dock split that gives the Preview canvas its exact
 * fitted aspect-ratio height while leaving the remaining mobile panels usable.
 */
export function resolveMobilePreviewSplitRatio({
  compositionHeight,
  compositionWidth,
  containerHeight,
  containerWidth,
  dividerSize,
  minimumPreviewHeight,
  minimumRemainingHeight,
  previewChromeHeight,
  previewWidthRatio,
}: ResolveMobilePreviewSplitRatioParams): number | null {
  if (
    !isPositiveFinite(compositionHeight)
    || !isPositiveFinite(compositionWidth)
    || !isPositiveFinite(containerHeight)
    || !isPositiveFinite(containerWidth)
    || !isPositiveFinite(previewWidthRatio)
  ) {
    return null;
  }

  const safeDividerSize = Math.max(0, dividerSize);
  const halfDividerSize = safeDividerSize / 2;
  const previewWidthDividerOffset = previewWidthRatio < 1 ? halfDividerSize : 0;
  const availablePreviewWidth = Math.max(
    1,
    containerWidth * previewWidthRatio - previewWidthDividerOffset,
  );
  const desiredCanvasHeight = availablePreviewWidth
    * compositionHeight
    / compositionWidth;
  const desiredPreviewHeight = desiredCanvasHeight + Math.max(0, previewChromeHeight);
  const minimumFirstRatio = (
    Math.max(0, minimumPreviewHeight) + halfDividerSize
  ) / containerHeight;
  const maximumFirstRatio = 1 - (
    Math.max(0, minimumRemainingHeight) + halfDividerSize
  ) / containerHeight;

  if (minimumFirstRatio > maximumFirstRatio) {
    const combinedMinimumHeight = minimumPreviewHeight + minimumRemainingHeight;
    return clampRatio(combinedMinimumHeight > 0
      ? minimumPreviewHeight / combinedMinimumHeight
      : 0.5);
  }

  return clampRatio(Math.max(
    minimumFirstRatio,
    Math.min(
      maximumFirstRatio,
      (desiredPreviewHeight + halfDividerSize) / containerHeight,
    ),
  ));
}
