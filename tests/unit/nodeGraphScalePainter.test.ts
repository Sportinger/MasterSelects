import { afterEach, describe, expect, it, vi } from 'vitest';
import { coveredCanvasCableRoutes, type CoverageCounters } from '../../src/components/panels/nodes/canvas/rendering/canvasCableCoverage';
import { CanvasSceneVisibility } from '../../src/components/panels/nodes/canvas/rendering/canvasSceneVisibility';
import { NodeCanvasPainter } from '../../src/components/panels/nodes/canvas/rendering/NodeCanvasPainter';
import { paintBase } from '../../src/components/panels/nodes/canvas/rendering/paintNodeCanvas';
import { takePaintPhases } from '../../src/components/panels/nodes/canvas/rendering/nodePaintProfile';
import { sampleCableRoute } from '../../src/components/panels/nodes/canvas/cableRoute';
import type { CanvasCable, CanvasNode, CanvasScene, CanvasTheme, CanvasView } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';

const view: CanvasView = { zoom: 1, panX: 0, panY: 0, width: 500, height: 400, ratio: 1 };
const theme: CanvasTheme = { background: '#111', card: '#222', text: '#fff', muted: '#aaa', border: '#444', accent: '#abc' };
const cable = (y: number): CanvasCable => ({ from: { x: 0, y }, to: { x: 800, y: 0 }, color: '#fff', highlighted: false, style: 'smart' });
const node = (id: string, x: number): CanvasNode => ({ id, x, y: 20, width: 100, height: 100, label: id,
  description: '', kind: 'effect', runtime: 'builtin', color: '#fff', selected: false, bypassed: false, bypassable: false, badges: [], ports: [] });
const empty: CanvasScene = { nodes: [], cables: [], groups: [], plugs: [] };
function context() {
  const methods = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  const target = { canvas: { width: 500, height: 400 } };
  return new Proxy(target, { get(object, key) {
    if (key in object) return Reflect.get(object, key);
    if (!methods.has(key)) methods.set(key, vi.fn(key === 'measureText' ? (value: string) => ({ width: value.length * 6 }) : () => undefined));
    return methods.get(key);
  } }) as unknown as CanvasRenderingContext2D;
}
function paths() {
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} bezierCurveTo() {} });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); takePaintPhases(); });

describe('viewport-bounded node painter', () => {
  it('queries narrow route legs, with near-linear counters at 300 and 1000 cables/covers', () => {
    const run = (count: number) => {
      const rects = Array.from({ length: count }, (_, i) => ({ x: 100, y: i * 100 + 10, width: 100, height: 60 }));
      const counters: CoverageCounters = { visits: 0, segments: 0, boundaries: 0, pieces: 0 };
      for (let i = 1; i <= count; i++) coveredCanvasCableRoutes({ ...cable(i * 100), occlusionPool: { rects, excluded: [] } },
        { x: -50, y: -50, width: 1000, height: count * 100 + 100 }, counters);
      return counters;
    };
    const small = run(300), large = run(1000);
    expect(large.visits).toBeLessThan(small.visits * 4.5);
    expect(large.segments).toBeLessThan(small.segments * 3.5);
    expect(large.pieces).toBeLessThan(small.pieces * 3.5);
  });
  it('preserves overlapping group depths and endpoint exclusions without plane partitions', () => {
    const value: CanvasCable = { ...cable(0), to: { x: 100, y: 0 }, occlusionPool: {
      rects: [{ x: 20, y: -10, width: 40, height: 20 }, { x: 40, y: -10, width: 40, height: 20 }], excluded: [],
    } };
    const viewport = { x: 10, y: -20, width: 80, height: 40 };
    const pieces = coveredCanvasCableRoutes(value, viewport);
    expect(pieces.map(p => p.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(pieces.map(p => [p.route.from.x, p.route.segments.at(-1)!.to.x])).toEqual([[10, 20], [20, 40], [40, 60], [60, 80], [80, 90]]);
    expect(coveredCanvasCableRoutes({ ...value, occlusionPool: { ...value.occlusionPool!, excluded: [0] } }, viewport).map(p => p.depth)).toEqual([0, 1, 0]);
  });
  it('keeps curved geometry curved after clipping and respects progressive appearance', () => {
    const value: CanvasCable = { ...cable(0), style: 'curved', to: { x: 100, y: 100 }, occlusions: [{ x: 30, y: 0, width: 40, height: 100 }] };
    const pieces = coveredCanvasCableRoutes(value, { x: 0, y: 0, width: 100, height: 100 });
    expect(pieces.map(p => p.depth)).toEqual([0, 1, 0]);
    for (const piece of pieces) expect(piece.route.segments[0].c1).toBeDefined();
    expect(pieces[1].route.from.x).toBeCloseTo(30, 6);
    expect(pieces[1].route.segments.at(-1)!.to.x).toBeCloseTo(70, 6);
    const partial = coveredCanvasCableRoutes({ ...value, appearance: 0.5 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(sampleCableRoute(partial.at(-1)!.route).at(-1)).toEqual({ x: 50, y: 50 });
  });
  it('paints only visible nodes/edges, including routes whose empty hull covers the screen', () => {
    paths();
    const scene: CanvasScene = { ...empty, nodes: [node('visible', 20), ...Array.from({ length: 1000 }, (_, i) => node(`far${i}`, 5000 + i * 200))],
      cables: [{ ...cable(30), to: { x: 200, y: 30 } }, ...Array.from({ length: 3000 }, (_, i) => ({ ...cable(5000 + i * 100),
        from: { x: -10000, y: 5000 + i * 100 }, to: { x: 2000, y: -10000 } }))] };
    const visible = new CanvasSceneVisibility(scene).visible(view);
    expect(visible.nodes).toHaveLength(1); expect(visible.cables).toHaveLength(1);
    const sprite = vi.fn(() => ({} as CanvasImageSource));
    paintBase(context(), scene, view, theme, false, sprite);
    expect(sprite).toHaveBeenCalledTimes(1);
    const phases = takePaintPhases();
    expect(phases?.find(p => p.name === 'paint-edges')?.count).toBe(1);
    expect(phases?.find(p => p.name === 'paint-nodes')?.count).toBe(1);
  });
  it('retains an offscreen branch center when its grip is visible at high zoom', () => {
    const scene: CanvasScene = { ...empty, branches: [{ id: 'grip', x: -25, y: 20, color: '#fff', selected: false }] };
    expect(new CanvasSceneVisibility(scene).visible({ ...view, zoom: 4 }).branches).toHaveLength(1);
  });
  it('never repaints the base for idle, hover, or 120 transport overlay frames', () => {
    paths();
    const base = context(), overlay = context(), painter = new NodeCanvasPainter(base, overlay);
    painter.update({ type: 'scene', scene: { ...empty, cables: [cable(20)] } });
    painter.update({ type: 'view', view, theme }); painter.draw(0);
    expect(base.clearRect).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 120; i++) {
      painter.update({ type: 'transport', transport: { playhead: i / 30, playing: true, active: true, visible: true, reducedMotion: false, sourceTimes: {} } });
      painter.draw(i * 1000 / 30);
    }
    painter.update({ type: 'hover', edgeId: 'hover' }); painter.draw(5000);
    painter.update({ type: 'transport', transport: { playhead: 4, playing: false, active: false, visible: true, reducedMotion: false, sourceTimes: {} } });
    painter.draw(6000);
    const calls = vi.mocked(base.clearRect).mock.calls.length;
    for (let i = 0; i < 120; i++) painter.draw(10000 + i * 1000);
    expect(calls).toBe(1); expect(base.clearRect).toHaveBeenCalledTimes(1);
    painter.dispose();
  });
});
