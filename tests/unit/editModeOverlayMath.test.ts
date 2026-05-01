import { describe, expect, it } from 'vitest';
import {
  calculateLayerOverlayBounds,
  getLayerOverlayHandles,
  pointInLayerOverlayBounds,
  resolvePositionDeltaForCanvasDelta,
} from '../../src/components/preview/editModeOverlayMath';

const baseParams = {
  sourceWidth: 1920,
  sourceHeight: 1080,
  outputWidth: 1920,
  outputHeight: 1080,
  canvasWidth: 960,
  canvasHeight: 540,
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
};

describe('editModeOverlayMath', () => {
  it('matches the full canvas for an untransformed source with the same aspect ratio', () => {
    const bounds = calculateLayerOverlayBounds(baseParams);

    expect(bounds.x).toBeCloseTo(480);
    expect(bounds.y).toBeCloseTo(270);
    expect(bounds.corners.tl).toEqual({ x: 0, y: 0 });
    expect(bounds.corners.br).toEqual({ x: 960, y: 540 });
    expect(bounds.width).toBeCloseTo(960);
    expect(bounds.height).toBeCloseTo(540);
  });

  it('keeps position in the same transform space as the compositor after scaling', () => {
    const bounds = calculateLayerOverlayBounds({
      ...baseParams,
      position: { x: 0.2, y: -0.1 },
      scale: { x: 0.5, y: 0.5 },
    });

    expect(bounds.x).toBeCloseTo(576);
    expect(bounds.y).toBeCloseTo(243);
    expect(bounds.width).toBeCloseTo(480);
    expect(bounds.height).toBeCloseTo(270);
  });

  it('uses the inverse of the compositor rotation for the visible layer corners', () => {
    const bounds = calculateLayerOverlayBounds({
      ...baseParams,
      sourceWidth: 100,
      sourceHeight: 100,
      outputWidth: 100,
      outputHeight: 100,
      canvasWidth: 100,
      canvasHeight: 100,
      rotation: Math.PI / 2,
    });

    expect(bounds.corners.tl.x).toBeCloseTo(0);
    expect(bounds.corners.tl.y).toBeCloseTo(100);
    expect(bounds.corners.tr.x).toBeCloseTo(0);
    expect(bounds.corners.tr.y).toBeCloseTo(0);
    expect(bounds.rotation).toBeCloseTo(-Math.PI / 2);
  });

  it('matches the shader aspect-fit footprint for wide sources', () => {
    const bounds = calculateLayerOverlayBounds({
      ...baseParams,
      sourceWidth: 3840,
      sourceHeight: 1080,
    });

    expect(bounds.corners.tl.x).toBeCloseTo(0);
    expect(bounds.corners.tl.y).toBeCloseTo(135);
    expect(bounds.corners.br.x).toBeCloseTo(960);
    expect(bounds.corners.br.y).toBeCloseTo(405);
  });

  it('hit-tests the transformed polygon and exposes transformed handle positions', () => {
    const bounds = calculateLayerOverlayBounds({
      ...baseParams,
      position: { x: 0.1, y: 0.05 },
      scale: { x: 0.7, y: 0.6 },
      rotation: Math.PI / 8,
    });
    const handles = getLayerOverlayHandles(bounds);

    expect(pointInLayerOverlayBounds({ x: bounds.x, y: bounds.y }, bounds)).toBe(true);
    expect(pointInLayerOverlayBounds({ x: -100, y: -100 }, bounds)).toBe(false);
    expect(handles.t.x).toBeCloseTo((bounds.corners.tl.x + bounds.corners.tr.x) / 2);
    expect(handles.r.y).toBeCloseTo((bounds.corners.tr.y + bounds.corners.br.y) / 2);
  });

  it('converts mouse drag pixels back into compositor position space after scale and rotation', () => {
    const transformParams = {
      ...baseParams,
      position: { x: 0.2, y: -0.1 },
      scale: { x: 0.35, y: 0.8 },
      rotation: Math.PI / 7,
    };
    const baseBounds = calculateLayerOverlayBounds(transformParams);
    const xPlusBounds = calculateLayerOverlayBounds({
      ...transformParams,
      position: { x: transformParams.position.x + 1, y: transformParams.position.y },
    });
    const yPlusBounds = calculateLayerOverlayBounds({
      ...transformParams,
      position: { x: transformParams.position.x, y: transformParams.position.y + 1 },
    });
    const positionDelta = resolvePositionDeltaForCanvasDelta(baseBounds, xPlusBounds, yPlusBounds, { x: 37, y: -22 });
    const movedBounds = calculateLayerOverlayBounds({
      ...transformParams,
      position: {
        x: transformParams.position.x + positionDelta.x,
        y: transformParams.position.y + positionDelta.y,
      },
    });

    expect(movedBounds.x - baseBounds.x).toBeCloseTo(37);
    expect(movedBounds.y - baseBounds.y).toBeCloseTo(-22);
  });
});
