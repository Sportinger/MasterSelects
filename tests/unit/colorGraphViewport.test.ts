import { describe, expect, it } from 'vitest';

import {
  getColorGraphFitViewport,
  getColorGraphOriginalSizeAnchorPosition,
  getColorGraphOriginalSizeViewport,
  type ColorGraphBounds,
} from '../../src/components/panels/color/colorGraphViewport';
import type { ColorEditorNode } from '../../src/components/panels/color/colorEditorTypes';

const bounds: ColorGraphBounds = {
  left: 100,
  top: 50,
  right: 500,
  bottom: 250,
};

describe('color graph viewport geometry', () => {
  it('places the input and output anchors at the current panel edges', () => {
    const input = {
      id: 'input', type: 'input', name: 'Input', enabled: true,
      params: {}, position: { x: 100, y: 80 },
    } satisfies ColorEditorNode;
    const output = {
      id: 'output', type: 'output', name: 'Output', enabled: true,
      params: {}, position: { x: 500, y: 80 },
    } satisfies ColorEditorNode;

    expect(getColorGraphOriginalSizeAnchorPosition(input, 1000)).toEqual({ x: 8, y: 80 });
    expect(getColorGraphOriginalSizeAnchorPosition(output, 1000)).toEqual({ x: 978, y: 80 });
    expect(getColorGraphOriginalSizeAnchorPosition(output, 700)).toEqual({ x: 678, y: 80 });
    expect(getColorGraphOriginalSizeAnchorPosition(
      { ...input, id: 'source', type: 'source' },
      1000,
    )).toEqual({ x: 8, y: 80 });
    expect(getColorGraphOriginalSizeAnchorPosition(
      { ...output, id: 'alpha', type: 'alpha-output' },
      1000,
    )).toEqual({ x: 978, y: 80 });
  });

  it('accounts for the current viewport when pinning anchors during resize', () => {
    const output = {
      id: 'output', type: 'output', name: 'Output', enabled: true,
      params: {}, position: { x: 500, y: 80 },
    } satisfies ColorEditorNode;

    expect(getColorGraphOriginalSizeAnchorPosition(
      output,
      1000,
      { x: 100, y: 0, zoom: 2 },
    )).toEqual({ x: 439, y: 80 });
  });

  it('does not move editable nodes when restoring Original Size', () => {
    const grade = {
      id: 'grade', type: 'primary', name: 'Corrector', enabled: true,
      params: {}, position: { x: 320, y: 120 },
    } satisfies ColorEditorNode;

    expect(getColorGraphOriginalSizeAnchorPosition(grade, 1000)).toBeNull();
  });

  it('restores 100 percent zoom without changing the current pan position', () => {
    expect(getColorGraphOriginalSizeViewport({ x: 137, y: -64, zoom: 0.58 })).toEqual({
      x: 137,
      y: -64,
      zoom: 1,
    });
  });

  it('keeps Zoom to Window fitted independently from Original Size', () => {
    expect(getColorGraphFitViewport(bounds, 300, 200)).toEqual({
      x: -3,
      y: 24,
      zoom: 0.51,
    });
  });
});
