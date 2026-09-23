/** Pan the half-opacity point inside the feather ramp, keeping its endpoints fixed. */
export function maskFeatherAlpha(alpha: number, balance = 0): number {
  if (alpha <= 0) return 0;
  if (alpha >= 1) return 1;
  const pan = Number.isFinite(balance) ? Math.max(-100, Math.min(100, balance)) : 0;
  if (pan === 0) return alpha;
  // Positive balance moves the contour outward, toward lower input alpha.
  // Leave an endpoint margin to avoid a discontinuous ramp at full pan.
  const midpoint = .5 - .475 * pan / 100;
  return alpha * (1 - midpoint) / (alpha * (1 - midpoint) + (1 - alpha) * midpoint);
}

export function applyMaskFeatherBalance(pixels: Uint8ClampedArray, balance: number): void {
  if (!Number.isFinite(balance) || balance === 0) return;
  const table = Uint8ClampedArray.from({ length: 256 }, (_, index) => maskFeatherAlpha(index / 255, balance) * 255);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = table[pixels[i]];
}

/** Show only the transition band, with red strongest at its inner edge. */
export function maskFeatherGuideAlpha(alpha: number, balance = 0): number {
  if (alpha <= 0 || alpha >= 1) return 0;
  return .5 * maskFeatherAlpha(alpha, balance);
}
