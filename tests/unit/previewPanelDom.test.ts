import { describe, expect, it } from 'vitest';

import { isPreviewCanvasInteractionTarget } from '../../src/components/preview/previewPanelDom';

describe('isPreviewCanvasInteractionTarget', () => {
  it('includes the 2D edit overlay that sits above the preview canvas', () => {
    const canvasWrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    const editOverlay = document.createElement('canvas');
    const controls = document.createElement('button');
    canvasWrapper.appendChild(canvas);

    expect(isPreviewCanvasInteractionTarget(canvas, canvas, canvasWrapper, editOverlay)).toBe(true);
    expect(isPreviewCanvasInteractionTarget(editOverlay, canvas, canvasWrapper, editOverlay)).toBe(true);
    expect(isPreviewCanvasInteractionTarget(controls, canvas, canvasWrapper, editOverlay)).toBe(false);
  });
});
