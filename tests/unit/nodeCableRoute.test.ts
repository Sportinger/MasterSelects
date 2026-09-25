import { describe, expect, it } from 'vitest';
import { cableRoute, cableRouteBounds, cableRouteMidpoint, cableRouteSvg, sampleCableRoute } from '../../src/components/panels/nodes/canvas/cableRoute';
import { getConnectionPath } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { applyNodeDrag } from '../../src/components/panels/nodes/canvas/rendering/canvasNodeDrag';
import type { CanvasScene } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';

const from = { x: 0, y: 0 }, to = { x: 400, y: 200 }, back = { x: -300, y: 40 };

describe('node cable routes', () => {
  it('keeps the default bezier unchanged', () => {
    expect(getConnectionPath(from, to)).toBe('M 0 0 C 168 0, 232 200, 400 200');
    expect(cableRouteSvg(cableRoute(from, to))).toBe(getConnectionPath(from, to));
  });

  it('routes angular cables through one vertical lane with hard corners', () => {
    const route = cableRoute(from, to, 'angular');
    expect(route.segments.every(segment => !segment.c1)).toBe(true);
    expect(route.segments.map(segment => segment.to)).toEqual([{ x: 200, y: 0 }, { x: 200, y: 200 }, to]);
    // Backward links leave and enter horizontally and wrap below both ports.
    const loop = sampleCableRoute(cableRoute(from, back, 'angular'));
    expect(loop[1]).toEqual({ x: 36, y: 0 });
    expect(Math.max(...loop.map(point => point.y))).toBeGreaterThan(back.y);
    expect(loop.at(-2)).toEqual({ x: back.x - 36, y: back.y });
  });

  it('rounds smart corners without leaving the orthogonal lane', () => {
    const route = cableRoute(from, to, 'smart');
    expect(route.segments.filter(segment => segment.c1)).toHaveLength(2);
    const bounds = cableRouteBounds(route);
    expect(bounds).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(route.segments.at(-1)!.to).toEqual(to);
    // Corner radii never exceed half of a short leg, so nearly level links stay smooth.
    const level = cableRoute(from, { x: 400, y: 10 }, 'smart');
    expect(cableRouteBounds(level).height).toBeLessThanOrEqual(10);
    expect(cableRouteMidpoint(route).point).toEqual({ x: 200, y: 100 });
  });
});

describe('worker node drag overrides', () => {
  const scene: CanvasScene = {
    nodes: [{ id: 'a', x: 0, y: 0 } as CanvasScene['nodes'][number], { id: 'b', x: 500, y: 0 } as CanvasScene['nodes'][number]],
    cables: [{ id: 'e', fromNode: 'a', toNode: 'b', from: { x: 184, y: 40 }, to: { x: 500, y: 40 }, color: '#fff', highlighted: false }],
    plugs: [{ id: 'e:output', center: { x: 180, y: 40 }, tip: { x: 184, y: 40 }, input: false, color: '#fff', highlighted: false },
      { id: 'e:input', center: { x: 504, y: 40 }, tip: { x: 500, y: 40 }, input: true, color: '#fff', highlighted: false }],
    groups: [],
  };

  it('moves dragged cards with their cable ends and plugs only', () => {
    const dragged = applyNodeDrag(scene, scene, { nodeIds: ['a'], dx: 10, dy: 20 });
    expect(dragged.nodes.find(node => node.id === 'a')).toMatchObject({ x: 10, y: 20 });
    expect(dragged.nodes.find(node => node.id === 'b')).toMatchObject({ x: 500, y: 0 });
    expect(dragged.cables[0]).toMatchObject({ from: { x: 194, y: 60 }, to: { x: 500, y: 40 } });
    expect(dragged.plugs.find(plug => plug.id === 'e:output')!.center).toEqual({ x: 190, y: 60 });
    expect(dragged.plugs.find(plug => plug.id === 'e:input')!.center).toEqual({ x: 504, y: 40 });
  });

  it('paints a dragged card even when its original position was culled', () => {
    const visible = { ...scene, nodes: [scene.nodes[1]], cables: [], plugs: [] };
    expect(applyNodeDrag(visible, scene, { nodeIds: ['a'], dx: 5, dy: 0 }).nodes.map(node => node.id)).toEqual(['b', 'a']);
  });
});
