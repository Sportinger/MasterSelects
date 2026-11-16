import { describe, expect, it } from 'vitest';
import { DEFAULT_COLOR_WINDOW_PARAMS } from '../../src/types/colorWindow';
import { colorWindowOutline, dragColorWindow, nodesSharingWindow, readColorWindow } from '../../src/components/preview/colorWindowOverlay/colorWindowGeometry';

const node = (id: string, params: Record<string, number>) => ({ id, type: 'primary', params }) as never;

describe('color window overlay geometry', () => {
  it('outlines the window at its edge and at both ends of the soft edge', () => {
    const window = { ...DEFAULT_COLOR_WINDOW_PARAMS, windowShape: 1, windowX: 0.5, windowY: 0.25, windowWidth: 0.6, windowHeight: 0.3 };
    const edge = colorWindowOutline(window, 1, 8);
    expect(edge[0]).toEqual({ x: 0.8, y: 0.25 });
    expect(edge[2]!.y).toBeCloseTo(0.4);
    expect(colorWindowOutline(window, 1.3, 8)[0]!.x).toBeCloseTo(0.89);
    const box = colorWindowOutline({ ...window, windowShape: 2 }, 1, 8);
    expect(box[0]).toEqual({ x: 0.2, y: 0.1 });
    expect(box).toHaveLength(8);
  });

  it('drags position and size and moves an inside/outside pair together', () => {
    const window = { ...DEFAULT_COLOR_WINDOW_PARAMS, windowShape: 1 };
    const moved = dragColorWindow(window, 'move', { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.4 });
    expect(moved.windowX).toBeCloseTo(0.6);
    expect(moved.windowY).toBeCloseTo(0.4);
    expect(dragColorWindow(window, 'width', { x: 0, y: 0 }, { x: 0.9, y: 0 }).windowWidth).toBeCloseTo(0.8);
    const shared = { windowShape: 1, windowX: 0.5, windowY: 0.25, windowWidth: 0.6, windowHeight: 0.3 };
    const nodes = [node('outside', { ...shared, windowOutside: 1 }), node('inside', shared), node('plain', {}), node('other', { ...shared, windowX: 0.4 })];
    expect(nodesSharingWindow(nodes, readColorWindow(nodes[1]!)).map(n => (n as { id: string }).id)).toEqual(['outside', 'inside']);
  });
});
