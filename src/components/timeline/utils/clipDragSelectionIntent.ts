// Keep ordinary click jitter separate from an intentional clip move. Six CSS
// pixels still feels immediate for a real drag while tolerating small hand
// movement between pointer-down and pointer-up.
export const CLIP_DRAG_INTENT_THRESHOLD_PX = 6;

export function hasClipDragIntent(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY)
    >= CLIP_DRAG_INTENT_THRESHOLD_PX;
}
