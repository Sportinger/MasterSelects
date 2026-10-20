import { describe, expect, it } from 'vitest';
import {
  guidePositionAtPoint,
  guideScreenOffset,
  isGuideRemovalPoint,
  type GuideViewport,
} from '../../src/components/preview/previewGuideMath';
import { resolveLayerMoveSnapDelta } from '../../src/components/preview/editModeSnapping';
import { getGuideSnapPoints } from '../../src/services/compositionGuides';
import type { Layer } from '../../src/types/layers';
import type { LayerOverlayBounds } from '../../src/components/preview/editModeOverlayMath';

// A 1920x1080 composition shown at half size, 100 px into the preview.
const viewport: GuideViewport = {
  canvasInContainer: { x: 100, y: 50, width: 960, height: 540 },
  containerSize: { width: 1200, height: 700 },
  compositionWidth: 1920,
  compositionHeight: 1080,
};

describe('preview guides', () => {
  it('maps guide positions between composition pixels and the preview', () => {
    expect(guideScreenOffset('vertical', 960, viewport)).toBe(580);
    expect(guideScreenOffset('horizontal', 540, viewport)).toBe(320);
    expect(guidePositionAtPoint('vertical', { x: 580.4, y: 0 }, viewport, false)).toBe(961);
    expect(guidePositionAtPoint('horizontal', { x: 0, y: 30 }, viewport, false)).toBe(-40);
  });

  it('snaps to the canvas edges and center only with Shift', () => {
    // 3 screen px from the center line (x 580) is within the 8 px snap distance.
    expect(guidePositionAtPoint('vertical', { x: 583, y: 0 }, viewport, false)).toBe(966);
    expect(guidePositionAtPoint('vertical', { x: 583, y: 0 }, viewport, true)).toBe(960);
    expect(guidePositionAtPoint('horizontal', { x: 0, y: 594 }, viewport, true)).toBe(1080);
    expect(guidePositionAtPoint('horizontal', { x: 0, y: 400 }, viewport, true)).toBe(700);
  });

  it('removes a guide dropped on its own ruler or outside the preview', () => {
    expect(isGuideRemovalPoint('horizontal', { x: 400, y: 10 }, viewport.containerSize, 18)).toBe(true);
    expect(isGuideRemovalPoint('horizontal', { x: 10, y: 300 }, viewport.containerSize, 18)).toBe(false);
    expect(isGuideRemovalPoint('vertical', { x: 10, y: 300 }, viewport.containerSize, 18)).toBe(true);
    expect(isGuideRemovalPoint('vertical', { x: 400, y: 900 }, viewport.containerSize, 18)).toBe(true);
  });

  it('rejects an unusable viewport', () => {
    expect(guidePositionAtPoint('vertical', { x: 10, y: 0 }, { ...viewport, compositionWidth: 0 }, false)).toBeNull();
  });
});

describe('layer snapping to guides', () => {
  const box = (left: number, top: number, size: number): LayerOverlayBounds => ({
    corners: {
      tl: { x: left, y: top },
      tr: { x: left + size, y: top },
      br: { x: left + size, y: top + size },
      bl: { x: left, y: top + size },
    },
  }) as LayerOverlayBounds;
  const layer = { id: 'a', visible: true, source: {} } as unknown as Layer;
  const other = { id: 'b', visible: true, source: {} } as unknown as Layer;
  const bounds = (target: Layer, _w: number, _h: number, pos?: { x: number; y: number }) => (
    target.id === 'a' ? box(pos?.x ?? 0, pos?.y ?? 0, 50) : box(300, 300, 50)
  );
  const base = {
    layer,
    layers: [layer, other],
    canvasSize: { width: 960, height: 540 },
    threshold: 5,
    calculateLayerBounds: bounds,
  };

  it('snaps layer edges to guides without Shift', () => {
    const guideSnapPoints = getGuideSnapPoints([
      { id: 'v', orientation: 'vertical', position: 200 },
      { id: 'h', orientation: 'horizontal', position: 100 },
    ]);
    expect(guideSnapPoints).toEqual({ x: [200], y: [100] });
    const delta = resolveLayerMoveSnapDelta({
      ...base,
      candidatePosition: { x: 147, y: 98 },
      guideSnapPoints,
      snapToLayout: false,
    });
    // Right edge 197 -> 200; top edge 98 -> 100.
    expect(delta).toEqual({ x: 3, y: 2 });
  });

  it('adds canvas and layer targets only with Shift', () => {
    const candidatePosition = { x: 297, y: 120 };
    expect(resolveLayerMoveSnapDelta({ ...base, candidatePosition, snapToLayout: false })).toEqual({ x: 0, y: 0 });
    expect(resolveLayerMoveSnapDelta({ ...base, candidatePosition, snapToLayout: true }).x).toBe(3);
  });
});
