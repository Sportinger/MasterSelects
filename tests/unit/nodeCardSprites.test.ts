import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeCardSprites } from '../../src/components/panels/nodes/canvas/rendering/nodeCardSprites';
import type { CanvasNode, CanvasTheme } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';

class MockOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() { return { setTransform() {}, clearRect() {} }; }
}
const theme: CanvasTheme = { background: '#111', card: '#222', text: '#eee', muted: '#999', border: '#444', accent: '#39f' };
const node = { id: 'card', width: 240, height: 120 } as CanvasNode;
afterEach(() => vi.unstubAllGlobals());

describe('node card sprites', () => {
  it('reuses sharper sprites when zooming out, keeps overview headroom, and re-rasterizes beyond it', () => {
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
    const sprites = new NodeCardSprites(), paint = vi.fn();
    const sharp = sprites.sprite(node, 'v1', 1, theme, paint);
    expect(sprites.sprite(node, 'v1', 0.7, theme, paint)).toBe(sharp);
    expect(sprites.sprite(node, 'v1', 0.5, theme, paint)).toBe(sharp);
    expect(paint).toHaveBeenCalledTimes(1);
    const smaller = sprites.sprite(node, 'v1', 0.3, theme, paint);
    expect(paint).toHaveBeenCalledTimes(2);
    expect(smaller!.width).toBeLessThan(sharp!.width);
    // Overview sprites keep one octave of zoom-in headroom.
    expect(sprites.sprite(node, 'v1', 0.6, theme, paint)).toBe(smaller);
    sprites.sprite(node, 'v1', 0.9, theme, paint);
    expect(paint).toHaveBeenCalledTimes(3);
    sprites.sprite(node, 'v2', 0.9, theme, paint);
    expect(paint).toHaveBeenCalledTimes(4);
  });
});
