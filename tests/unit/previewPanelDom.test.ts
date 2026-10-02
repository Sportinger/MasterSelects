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
  it('includes the inline guide canvas for the existing Preview zoom and pinch handler', () => {
    const wrapper = document.createElement('div'), editor = document.createElement('div');
    editor.className = 'perspective-preview-editor';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    editor.appendChild(svg); wrapper.appendChild(editor);
    expect(isPreviewCanvasInteractionTarget(svg, null, wrapper, null)).toBe(true);
    expect(isPreviewCanvasInteractionTarget(wrapper, null, wrapper, null)).toBe(true);
  });
});
