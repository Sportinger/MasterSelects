type Bounds = { left: number; right: number; top: number; bottom: number };

/** Place beside the owning card so details never cover its sockets when space permits. */
export function placePortTooltip(anchor: Bounds, card: Bounds, width: number, height: number,
  viewport: { width: number; height: number }, direction: 'input' | 'output') {
  const gap = 12, margin = 8;
  const clampX = (x: number) => Math.max(margin, Math.min(viewport.width - width - margin, x));
  const clampY = (y: number) => Math.max(margin, Math.min(viewport.height - height - margin, y));
  const left = card.left - width - gap, right = card.right + gap;
  const fitsLeft = left >= margin, fitsRight = right + width <= viewport.width - margin;
  if ((direction === 'input' && fitsLeft) || (!fitsRight && fitsLeft)) return { left, top: clampY(anchor.top) };
  if (fitsRight) return { left: right, top: clampY(anchor.top) };
  const above = card.top - height - gap, below = card.bottom + gap;
  return { left: clampX(anchor.left), top: clampY(above >= margin ? above : below) };
}
