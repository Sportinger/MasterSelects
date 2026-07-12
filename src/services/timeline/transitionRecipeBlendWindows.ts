import type { BlendMode } from '../../types/blendMode';
import type { TransitionRecipeBlendWindow } from '../../types/timelineCore';

const BLEND_MODES = new Set<BlendMode>([
  'normal', 'dissolve', 'dancing-dissolve',
  'darken', 'multiply', 'color-burn', 'classic-color-burn', 'linear-burn', 'darker-color',
  'add', 'lighten', 'screen', 'color-dodge', 'classic-color-dodge', 'linear-dodge', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'linear-light', 'vivid-light', 'pin-light', 'hard-mix',
  'difference', 'classic-difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
  'stencil-alpha', 'stencil-luma', 'silhouette-alpha', 'silhouette-luma', 'alpha-add',
]);

function isValidWindow(window: unknown): window is TransitionRecipeBlendWindow {
  if (!window || typeof window !== 'object') return false;
  const candidate = window as TransitionRecipeBlendWindow;
  return Number.isFinite(candidate.compStart) &&
    Number.isFinite(candidate.compEnd) &&
    candidate.compEnd > candidate.compStart &&
    typeof candidate.blendMode === 'string' &&
    BLEND_MODES.has(candidate.blendMode);
}

/** Resolves half-open parent-composition windows; the last matching valid window wins. */
export function resolveTransitionRecipeBlendMode(
  windows: readonly TransitionRecipeBlendWindow[] | undefined | null,
  parentCompositionTime: number,
  baseBlendMode: BlendMode,
): BlendMode {
  if (!Number.isFinite(parentCompositionTime) || !Array.isArray(windows)) return baseBlendMode;

  let blendMode = baseBlendMode;
  for (const window of windows) {
    if (isValidWindow(window) &&
      parentCompositionTime >= window.compStart &&
      parentCompositionTime < window.compEnd) {
      blendMode = window.blendMode;
    }
  }
  return blendMode;
}
