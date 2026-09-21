import { describe, expect, it } from 'vitest';
import { CanvasSceneVisibility } from '../../src/components/panels/nodes/canvas/rendering/canvasSceneVisibility';
import type { CanvasScene } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';

const node = (id: string, x: number, y: number) => ({ id, x, y, width: 200, height: 100, label: id, description: '', kind: 'effect',
  runtime: '', color: '#fff', selected: false, bypassed: false, bypassable: false, badges: [], ports: [] });

describe('canvas scene visibility', () => {
  it('returns only viewport candidates while preserving painter order', () => {
    const scene: CanvasScene = {
      nodes: [node('left', -900, 0), node('visible-a', 10, 20), node('visible-b', 300, 30), node('right', 1400, 0)],
      groups: [{ x: -20, y: -20, width: 600, height: 300, label: 'visible', color: '#fff', collapsed: false, count: '' },
        { x: 2000, y: 0, width: 100, height: 100, label: 'hidden', color: '#fff', collapsed: false, count: '' }],
      cables: [{ from: { x: -100, y: 50 }, to: { x: 700, y: 50 }, color: '#fff', highlighted: false, points: [], distances: [], length: 800 },
        { from: { x: 1800, y: 0 }, to: { x: 2000, y: 0 }, color: '#fff', highlighted: false, points: [], distances: [], length: 200 }],
      plugs: [{ center: { x: 20, y: 40 }, tip: { x: 44, y: 40 }, input: false, color: '#fff', highlighted: false },
        { center: { x: 1800, y: 40 }, tip: { x: 1824, y: 40 }, input: false, color: '#fff', highlighted: false }],
    };
    const visible = new CanvasSceneVisibility(scene).visible({ zoom: 1, panX: 0, panY: 0, width: 640, height: 360, ratio: 1 });
    expect(visible.nodes.map(item => item.id)).toEqual(['visible-a', 'visible-b']);
    expect(visible.groups.map(item => item.label)).toEqual(['visible']);
    expect(visible.cables).toEqual([scene.cables[0]]);
    expect(visible.plugs).toEqual([scene.plugs[0]]);
  });

  it('accounts for zoom, pan, and long items without dropping intersections', () => {
    const scene: CanvasScene = { nodes: [node('target', 1000, 1000)], groups: [], plugs: [], cables: [
      { from: { x: -10000, y: 1050 }, to: { x: 10000, y: 1050 }, color: '#fff', highlighted: false, points: [], distances: [], length: 20000 },
    ] };
    const visible = new CanvasSceneVisibility(scene).visible({ zoom: 2, panX: -2000, panY: -2000, width: 500, height: 300, ratio: 1 });
    expect(visible.nodes.map(item => item.id)).toEqual(['target']);
    expect(visible.cables).toHaveLength(1);
  });

  it('bounds extreme queries and fails closed for non-finite geometry', () => {
    const scene: CanvasScene = { nodes: [node('valid', 0, 0), node('invalid', Number.NaN, 0)], groups: [], plugs: [], cables: [] };
    const index = new CanvasSceneVisibility(scene);
    expect(index.visible({ zoom: 1e-12, panX: 0, panY: 0, width: 640, height: 360, ratio: 1 }).nodes.map(item => item.id)).toEqual(['valid']);
    expect(index.visible({ zoom: Number.NaN, panX: 0, panY: 0, width: 640, height: 360, ratio: 1 }).nodes).toEqual([]);
  });
});
