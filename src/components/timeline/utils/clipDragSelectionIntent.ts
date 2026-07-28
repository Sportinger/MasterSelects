export const CLIP_DRAG_INTENT_THRESHOLD_PX = 4;

export function hasClipDragIntent(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY)
    >= CLIP_DRAG_INTENT_THRESHOLD_PX;
}
