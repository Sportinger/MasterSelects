export interface RenderReferenceSize {
  width: number;
  height: number;
}

interface StoredRenderReferenceSize extends RenderReferenceSize {
  renderWidth: number;
  renderHeight: number;
}

const RENDER_REFERENCE_STATE_KEY = Symbol.for('masterselects.renderReferenceState');

export function resolveRenderReferenceSize(
  renderWidth: number,
  renderHeight: number,
  isExporting: boolean,
  exportCompositionSize?: RenderReferenceSize,
): RenderReferenceSize {
  if (isExporting) {
    return exportCompositionSize ?? { width: renderWidth, height: renderHeight };
  }

  const stored = (globalThis as typeof globalThis & {
    [RENDER_REFERENCE_STATE_KEY]?: StoredRenderReferenceSize;
  })[RENDER_REFERENCE_STATE_KEY];
  return stored?.renderWidth === renderWidth && stored.renderHeight === renderHeight
    ? { width: stored.width, height: stored.height }
    : { width: renderWidth, height: renderHeight };
}
