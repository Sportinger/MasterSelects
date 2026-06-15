import { describe, expect, it } from 'vitest';

import { spinZoom } from '../../src/transitions/spinZoom';
import { zoomBlur } from '../../src/transitions/zoomBlur';
import { zoomIn } from '../../src/transitions/zoomIn';
import { zoomOut } from '../../src/transitions/zoomOut';

describe('zoom transition definitions', () => {
  it('defines serializable zoom in and zoom out recipes', () => {
    expect(zoomIn).toMatchObject({
      id: 'zoom-in',
      name: 'Zoom In',
      category: 'zoom',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Zoom into the incoming clip with a clean geometric dissolve',
    });
    expect(zoomOut).toMatchObject({
      id: 'zoom-out',
      name: 'Zoom Out',
      category: 'zoom',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Zoom out of the outgoing clip into the incoming clip',
    });

    expect(JSON.parse(JSON.stringify(zoomIn.recipe))).toEqual(zoomIn.recipe);
    expect(JSON.parse(JSON.stringify(zoomOut.recipe))).toEqual(zoomOut.recipe);
    expect(zoomIn.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      scaleX: { from: 1.18, to: 1 },
      scaleY: { from: 1.18, to: 1 },
      curve: 'ease-out',
    });
    expect(zoomOut.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      scaleX: { from: 0.86, to: 1 },
      scaleY: { from: 0.86, to: 1 },
      curve: 'ease-out',
    });
  });

  it('defines a serializable spin zoom recipe', () => {
    expect(spinZoom).toMatchObject({
      id: 'spin-zoom',
      name: 'Spin Zoom',
      category: 'zoom',
      defaultDuration: 1.2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Zoom through the cut with a restrained rotational push',
    });

    expect(JSON.parse(JSON.stringify(spinZoom.recipe))).toEqual(spinZoom.recipe);
    expect(spinZoom.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      rotateZ: { from: -0.18, to: 0 },
      scaleX: { from: 1.14, to: 1 },
      scaleY: { from: 1.14, to: 1 },
      curve: 'ease-out',
    });
  });

  it('defines a serializable zoom blur recipe through transition-scoped effects', () => {
    expect(zoomBlur).toMatchObject({
      id: 'zoom-blur',
      name: 'Zoom Blur',
      category: 'zoom',
      defaultDuration: 1.15,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Push through the cut with zoom blur on both clips',
    });

    expect(JSON.parse(JSON.stringify(zoomBlur.recipe))).toEqual(zoomBlur.recipe);
    expect(zoomBlur.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      scaleX: { from: 1.16, to: 1 },
      scaleY: { from: 1.16, to: 1 },
      curve: 'ease-out',
    });
    expect(zoomBlur.recipe).toContainEqual({
      kind: 'effect',
      target: 'incoming',
      effectType: 'zoom-blur',
      effectName: 'Zoom Blur',
      params: {
        amount: { from: 0.46, to: 0 },
        centerX: 0.5,
        centerY: 0.5,
        samples: 32,
      },
      startProgress: 0.38,
      endProgress: 1,
      curve: 'ease-out',
    });
  });
});
