import type { CompositionGuide } from '../../types/compositionGuides';
import { resolveAxisSnapDelta } from './editModeSnapping';

type GuideOrientation = CompositionGuide['orientation'];

export interface GuideViewport {
  /** Screen rect of the composition inside the preview, in CSS pixels. */
  canvasInContainer: { x: number; y: number; width: number; height: number };
  containerSize: { width: number; height: number };
  compositionWidth: number;
  compositionHeight: number;
}

export interface PreviewPoint {
  x: number;
  y: number;
}

/** Screen distance within which Shift snaps a dragged guide to the canvas edges or center. */
export const GUIDE_SNAP_SCREEN_PX = 8;

function axisScale(orientation: GuideOrientation, viewport: GuideViewport): number {
  return orientation === 'vertical'
    ? viewport.canvasInContainer.width / viewport.compositionWidth
    : viewport.canvasInContainer.height / viewport.compositionHeight;
}

/** Offset of a guide along its axis in preview container pixels. */
export function guideScreenOffset(orientation: GuideOrientation, position: number, viewport: GuideViewport): number {
  const origin = orientation === 'vertical' ? viewport.canvasInContainer.x : viewport.canvasInContainer.y;
  return origin + position * axisScale(orientation, viewport);
}

/**
 * Composition pixel position for a pointer in container pixels, rounded to
 * whole pixels. With `snap`, it snaps to the canvas edges and center.
 */
export function guidePositionAtPoint(
  orientation: GuideOrientation,
  point: PreviewPoint,
  viewport: GuideViewport,
  snap: boolean,
): number | null {
  const scale = axisScale(orientation, viewport);
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const origin = orientation === 'vertical' ? viewport.canvasInContainer.x : viewport.canvasInContainer.y;
  const raw = ((orientation === 'vertical' ? point.x : point.y) - origin) / scale;
  if (!Number.isFinite(raw)) return null;
  if (snap) {
    const extent = orientation === 'vertical' ? viewport.compositionWidth : viewport.compositionHeight;
    const delta = resolveAxisSnapDelta([raw], [0, extent / 2, extent], GUIDE_SNAP_SCREEN_PX / scale);
    if (delta !== 0) return Math.round(raw + delta);
  }
  return Math.round(raw);
}

/**
 * A guide released over its own ruler or outside the preview is removed,
 * like dragging a guide back into the ruler in Photoshop.
 */
export function isGuideRemovalPoint(
  orientation: GuideOrientation,
  point: PreviewPoint,
  containerSize: GuideViewport['containerSize'],
  rulerSize: number,
): boolean {
  if (point.x < 0 || point.y < 0 || point.x > containerSize.width || point.y > containerSize.height) return true;
  return orientation === 'horizontal' ? point.y < rulerSize : point.x < rulerSize;
}
