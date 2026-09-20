import { describe, expect, it } from 'vitest';
import { buildCanvasScene } from '../../src/components/panels/nodes/canvas/rendering/buildCanvasScene';
import { paintOverlay, type CurveActivity } from '../../src/components/panels/nodes/canvas/rendering/paintNodeCanvas';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';
import type { CanvasNode, CanvasTransport } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';
import { makeCanvasCable } from '../../src/components/panels/nodes/canvas/rendering/cableGeometry';

function fixture() {
  const clip = createMockClip({ id: 'curve-clip', startTime: 10, duration: 5 });
  const keys = [createMockKeyframe({ clipId: clip.id, property: 'scale.x', time: 0, value: 1, easing: 'linear' }),
    createMockKeyframe({ clipId: clip.id, property: 'scale.x', time: 5, value: 3, easing: 'linear' })];
  const node = { ...connectionFixture.nodes[0], binding: { kind: 'keyframe-node' as const, nodeId: 'curve' },
    outputs: [{ ...connectionFixture.nodes[0].outputs[0], metadata: { animationProperty: 'scale.x' } }],
    params: { targetClipId: clip.id, largePayload: 'private graph data'.repeat(10000) } };
  const options = { graph: { ...connectionFixture, nodes: [node], edges: [] }, nodes: [node], plugs: [],
    selection: new Set<string>(), selectedNodeId: null, selectedEdgeId: null, hoveredEdgeId: null,
    hoveredPort: null, draft: null, clips: [clip], keyframes: new Map([[clip.id, keys]]), sourceTime: () => 0 };
  return { options, scene: buildCanvasScene(options) };
}
describe('canvas animation values', () => {
  it('draws two equally spaced signal points using transport phase rather than wall-clock time', () => {
    const arcs: number[][] = [];
    const target = { canvas: { width: 1000, height: 700 }, arc: (...values: number[]) => arcs.push(values) };
    const ctx = new Proxy(target, { get: (o, key) => key in o ? o[key as keyof typeof o] : () => {} }) as unknown as CanvasRenderingContext2D;
    const cable = makeCanvasCable({ x: 0, y: 100 }, { x: 300, y: 100 }, '#fff');
    paintOverlay(ctx, { nodes: [], groups: [], plugs: [], cables: [cable] },
      { zoom: 1, panX: 0, panY: 0, width: 1000, height: 700, ratio: 1 },
      { background: '#111', card: '#222', text: '#fff', muted: '#aaa', border: '#444', accent: '#79b8fa' },
      { playhead: 0, active: true, playing: true, visible: true, reducedMotion: false, sourceTimes: {} }, 98765, new Map(), (300 / 140) / 4);
    expect(arcs).toHaveLength(2);
    expect(arcs[0][0]).toBeCloseTo(75); expect(arcs[1][0]).toBeCloseTo(225);
  });
  it('reuses curve samples on node moves and excludes graph payloads from worker messages', () => {
    const { options, scene } = fixture();
    const moved = buildCanvasScene({ ...options, nodes: options.nodes.map(n => ({ ...n, layout: { x: 200, y: 50 } })) });
    expect(moved.nodes[0].curve).toBe(scene.nodes[0].curve);
    expect(moved.nodes[0].x).toBe(200);
    expect(JSON.stringify(scene)).not.toContain('private graph data');
    expect(scene.nodes[0].curve?.keys).toHaveLength(2);
    const replacement = buildCanvasScene({ ...options, keyframes: new Map([['curve-clip', []]]) });
    expect(replacement.nodes[0].curve).not.toBe(scene.nodes[0].curve);
  });
  it('draws exact final values for forward/reverse seeks and clamps outside the clip', () => {
    const { scene } = fixture(), labels: string[] = [];
    const target = { canvas: { width: 1000, height: 700 }, measureText: () => ({ width: 10 }), fillText: (label: string) => labels.push(label) };
    const ctx = new Proxy(target, { get: (o, key) => key in o ? o[key as keyof typeof o] : () => {} }) as unknown as CanvasRenderingContext2D;
    const view = { zoom: 1, panX: 0, panY: 0, width: 1000, height: 700, ratio: 1 };
    const theme = { background: '#111', card: '#222', text: '#fff', muted: '#aaa', border: '#444', accent: '#79b8fa' };
    const transport: CanvasTransport = { playhead: 0, active: false, playing: false, visible: true, reducedMotion: true, sourceTimes: {} };
    const activity = new Map<string, CurveActivity>();
    for (const [playhead, expected] of [[12.5, '2'], [11.25, '1.5'], [20, '3'], [0, '1']]) {
      labels.length = 0;
      paintOverlay(ctx, scene, view, theme, { ...transport, playhead: Number(playhead) }, 0, activity);
      expect(labels).toEqual([expected]);
    }
    // Source-time curves use the resolved source time, not the UI's clip-local position.
    (scene.nodes[0] as CanvasNode).curve!.sourceTime = true;
    labels.length = 0;
    paintOverlay(ctx, scene, view, theme, { ...transport, playhead: 12.5, sourceTimes: { 'curve-clip': 5 } }, 0, activity);
    expect(labels).toEqual(['3']);
    labels.length = 0;
    paintOverlay(ctx, scene, view, theme, { ...transport, visible: false }, 0, activity);
    expect(labels).toHaveLength(0);
  });
});
