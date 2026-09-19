/** Map a visible timeline interval back to the clip's trimmed source window. */
export function getTimelineClipCanvasVisibleSourceRange(
  geometry: { inPoint: number; outPoint: number },
  visibleStartRatio: number,
  visibleEndRatio: number,
  reversed = false,
): { inPoint: number; outPoint: number } {
  const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
  // A reversed clip's left edge shows its source out-point. Reverse the
  // visible window before the thumbnail cache reverses the sample order.
  return reversed
    ? {
      inPoint: geometry.outPoint - sourceSpan * visibleEndRatio,
      outPoint: geometry.outPoint - sourceSpan * visibleStartRatio,
    }
    : {
      inPoint: geometry.inPoint + sourceSpan * visibleStartRatio,
      outPoint: geometry.inPoint + sourceSpan * visibleEndRatio,
    };
}
