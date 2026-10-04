import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/types/layers';
import {
  COMPOSITOR_UNIFORM_FLOAT_COUNT,
  writeLayerUniformData,
} from '../../src/engine/pipeline/compositor/uniforms';
import {
  clearTextCanvasFrame,
  drawCanvasSource,
  getCanvasSourceSize,
  getTextCanvasTextureRect,
  setTextCanvasFrame,
} from '../../src/services/text/textCanvasFrameRegistry';

function canvasOfSize(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function layer(): Layer {
  return {
    id: 'text', name: 'Text', visible: true, opacity: 1, blendMode: 'normal', source: null, effects: [],
    position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
  };
}

describe('cropped text canvas frames', () => {
  it('reports the composition-sized source and where the crop sits inside it', () => {
    const canvas = canvasOfSize(400, 100);
    setTextCanvasFrame(canvas, { frameWidth: 3440, frameHeight: 1440, x: 860, y: 720 });

    expect(getCanvasSourceSize(canvas)).toEqual({ width: 3440, height: 1440 });
    expect(getTextCanvasTextureRect(canvas)).toEqual({
      x: 860 / 3440, y: 720 / 1440, width: 400 / 3440, height: 100 / 1440,
    });

    clearTextCanvasFrame(canvas);
    expect(getCanvasSourceSize(canvas)).toEqual({ width: 400, height: 100 });
    expect(getTextCanvasTextureRect(canvas)).toBeUndefined();
  });

  it('draws a crop at its offset when the source is drawn into a smaller target', () => {
    const canvas = canvasOfSize(400, 100);
    setTextCanvasFrame(canvas, { frameWidth: 3440, frameHeight: 1440, x: 860, y: 720 });
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;

    drawCanvasSource(ctx, canvas, 0, 0, 172, 72);

    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 43, 36, 20, 5);
  });

  it('draws an uncropped canvas over the whole target', () => {
    const canvas = canvasOfSize(1920, 1080);
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;

    drawCanvasSource(ctx, canvas, 0, 0, 160, 90);

    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 160, 90);
  });
});

describe('compositor texture rect uniforms', () => {
  const write = (textureRect?: { x: number; y: number; width: number; height: number }) => {
    const data = new Float32Array(COMPOSITOR_UNIFORM_FLOAT_COUNT);
    writeLayerUniformData(layer(), 1, 1, false, data, new Uint32Array(data.buffer), undefined, 1, undefined, textureRect);
    return Array.from(data.slice(32, 36));
  };

  it('covers the whole source by default', () => {
    expect(write()).toEqual([0, 0, 1, 1]);
  });

  it('carries a cropped texture rect', () => {
    expect(write({ x: 0.25, y: 0.5, width: 0.125, height: 0.0625 })).toEqual([0.25, 0.5, 0.125, 0.0625]);
  });
});
