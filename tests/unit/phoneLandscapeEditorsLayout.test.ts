import { describe, expect, it } from 'vitest';
import { bestMultiPreviewGrid } from '../../src/components/preview/MultiPreviewPhoneGrid';
import { phoneFittedNodeViewport } from '../../src/components/panels/nodes/canvas/useNodePhoneAutoFit';
import { FIT_MARGIN } from '../../src/components/panels/nodes/canvas/canvasGeometry';

describe('phone Multicam grid arrangement', () => {
  it('puts four portrait angles in one row on a landscape phone', () => {
    expect(bestMultiPreviewGrid(4, 860, 300, 9 / 16)).toEqual({ columns: 4, rows: 1 });
  });

  it('stacks four 16:9 angles in one column on a tall portrait area', () => {
    expect(bestMultiPreviewGrid(4, 400, 900, 16 / 9)).toEqual({ columns: 1, rows: 4 });
  });

  it('keeps 2x2 for 16:9 angles in a 16:9 area', () => {
    expect(bestMultiPreviewGrid(4, 1600, 900, 16 / 9)).toEqual({ columns: 2, rows: 2 });
  });

  it('falls back to 16:9 for a broken aspect instead of producing NaN tiles', () => {
    const shape = bestMultiPreviewGrid(4, 1600, 900, Number.NaN);
    expect(shape.columns * shape.rows).toBeGreaterThanOrEqual(4);
  });
});

describe('phone node graph auto-fit', () => {
  it('fits the whole graph and centres it in the free axis', () => {
    const bounds = { left: 0, top: 0, right: 400, bottom: 100 };
    const view = phoneFittedNodeViewport(bounds, 800, 400);
    const graphWidth = 400 * view.zoom, graphHeight = 100 * view.zoom;
    expect(graphWidth).toBeLessThanOrEqual(800 - 2 * FIT_MARGIN + 0.01);
    expect(view.panX).toBeCloseTo((800 - graphWidth) / 2, 0);
    expect(view.panY).toBeCloseTo((400 - graphHeight) / 2, 0);
  });

  it('keeps every node of a wide graph on screen (off-screen cards are not mounted)', () => {
    const bounds = { left: 100, top: 50, right: 4100, bottom: 250 };
    const view = phoneFittedNodeViewport(bounds, 600, 300);
    expect(view.panX + bounds.left * view.zoom).toBeGreaterThanOrEqual(FIT_MARGIN - 0.01);
    expect(view.panX + bounds.right * view.zoom).toBeLessThanOrEqual(600 - FIT_MARGIN + 0.01);
  });
});
