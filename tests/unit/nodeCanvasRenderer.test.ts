import { describe, expect, it, vi, afterEach } from 'vitest';
import { NodeCanvasPainter } from '../../src/components/panels/nodes/canvas/rendering/NodeCanvasPainter';
import { paintBase, paintOverlay } from '../../src/components/panels/nodes/canvas/rendering/paintNodeCanvas';
import { cableArcLengths, makeCanvasCable, signalPosition } from '../../src/components/panels/nodes/canvas/rendering/cableGeometry';
import { bufferedCanvasView, canvasPixelRatio, createNodeCanvasRuntime } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasRuntime';
import { buildCanvasScene } from '../../src/components/panels/nodes/canvas/rendering/buildCanvasScene';
import { getConnectionPlugs } from '../../src/components/panels/nodes/canvas/connectionPlugs';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { CanvasMessage, CanvasScene, CanvasTransport, CanvasTheme, CanvasView } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';
import { dragUpdatesFirst } from '../../src/components/panels/nodes/canvas/rendering/canvasNodeDrag';

vi.mock('../../src/components/panels/nodes/canvas/rendering/paintNodeCanvas', () => ({ paintBase: vi.fn(), paintOverlay: vi.fn() }));
const view: CanvasView = { zoom: 1, panX: 0, panY: 0, width: 1000, height: 700, ratio: 2 };
const theme: CanvasTheme = { background: '#111', card: '#222', text: '#fff', muted: '#aaa', border: '#444', accent: '#79b8fa' };
const scene: CanvasScene = { nodes: [], cables: [], groups: [], plugs: [] };
const transport: CanvasTransport = { playhead: 0, active: true, playing: true, visible: true, reducedMotion: false, sourceTimes: {} };
const context = () => ({ canvas: { width: 1, height: 1 } }) as CanvasRenderingContext2D;
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('node canvas frame ownership', () => {
  it('caches the static layer across transport frames, but repaints immediately for pan and edits', () => {
    const base = context(), overlay = context(), painter = new NodeCanvasPainter(base, overlay);
    painter.update({ type: 'scene', scene }); painter.update({ type: 'view', view, theme }); painter.update({ type: 'transport', transport });
    painter.draw(0);
    for (let frame = 1; frame <= 120; frame++) {
      painter.update({ type: 'transport', transport: { ...transport, playhead: frame / 30 } }); painter.draw(frame * 1000 / 30);
    }
    expect(paintBase).toHaveBeenCalledTimes(1); expect(paintOverlay).toHaveBeenCalledTimes(121);
    expect(base.canvas.width).toBe(2000); expect(overlay.canvas.height).toBe(1400);
    painter.update({ type: 'view', view: { ...view, panX: 100 }, theme }); painter.draw(5000);
    painter.update({ type: 'scene', scene }); painter.draw(5001);
    expect(paintBase).toHaveBeenCalledTimes(3);
  });
  it('holds a dropped card at its release point until the committed scene moves it, also within one batch', () => {
    const card = { id: 'n', x: 0, y: 0, width: 200, height: 100, label: 'N', description: '', kind: 'effect', runtime: 'builtin',
      color: '#fff', selected: false, bypassed: false, bypassable: false, badges: [], ports: [] };
    const at = (x: number): CanvasScene => ({ ...scene, nodes: [{ ...card, x }] });
    const painted = () => (vi.mocked(paintBase).mock.calls.at(-1)![1] as CanvasScene).nodes.find(node => node.id === 'n')!.x;
    const painter = new NodeCanvasPainter(context(), context());
    painter.update({ type: 'scene', scene: at(0) }); painter.update({ type: 'view', view, theme });
    painter.update({ type: 'drag', drag: { nodeIds: ['n'], dx: 80, dy: 0 } }); painter.draw(0);
    expect(painted()).toBe(80);
    painter.update({ type: 'drag', drag: null, hold: true }); painter.draw(1);
    expect(painted()).toBe(80);
    painter.update({ type: 'scene', scene: at(0) }); painter.draw(2); // unrelated scene: still held
    expect(painted()).toBe(80);
    painter.update({ type: 'scene', scene: at(80) }); painter.draw(3); // committed: no double offset
    expect(painted()).toBe(80);
    painter.update({ type: 'drag', drag: { nodeIds: ['n'], dx: 40, dy: 0 } });
    for (const message of dragUpdatesFirst<CanvasMessage>([{ type: 'scene', scene: at(120) }, { type: 'drag', drag: null, hold: true }])) {
      painter.update(message as Exclude<CanvasMessage, { type: 'init' | 'presented' }>);
    }
    painter.draw(4);
    expect(painted()).toBe(120);
  });
  it('stops decorative frames when paused, offscreen, hidden or motion is reduced; final values still draw', () => {
    const painter = new NodeCanvasPainter(context(), context());
    painter.update({ type: 'scene', scene }); painter.update({ type: 'view', view, theme });
    for (const state of [{ ...transport, active: false }, { ...transport, visible: false }, { ...transport, reducedMotion: true }]) {
      painter.update({ type: 'transport', transport: state }); expect(painter.animated).toBe(false); painter.draw(0);
      const count = vi.mocked(paintOverlay).mock.calls.length;
      painter.draw(33); expect(paintOverlay).toHaveBeenCalledTimes(count);
    }
    painter.update({ type: 'transport', transport }); expect(painter.animated).toBe(true);
  });
  it('bounds backing stores on extreme monitor sizes and high pixel ratios', () => {
    for (const [width, height, dpr] of [[1920, 1080, 3], [10000, 5000, 2], [3840, 2160, 2], [0, 0, 1]]) {
      const ratio = canvasPixelRatio(width, height, dpr);
      expect(width * ratio).toBeLessThanOrEqual(4096); expect(height * ratio).toBeLessThanOrEqual(4096);
      expect(width * height * ratio ** 2).toBeLessThanOrEqual(8_000_001);
      const buffered = bufferedCanvasView({ ...view, width, height }, dpr);
      expect(buffered.width * buffered.ratio).toBeLessThanOrEqual(4096);
      expect(buffered.height * buffered.ratio).toBeLessThanOrEqual(4096);
      expect(buffered.width * buffered.height * buffered.ratio ** 2).toBeLessThanOrEqual(8_000_001);
    }
  });
  it('paints nodes beyond every viewport edge before a delayed pan frame arrives', () => {
    const options = { graph: connectionFixture, nodes: connectionFixture.nodes, plugs: [], selection: new Set<string>(),
      selectedNodeId: null, selectedEdgeId: null, hoveredEdgeId: null, hoveredPort: null, draft: null,
      clips: [], keyframes: new Map(), sourceTime: () => 0 };
    const node = buildCanvasScene(options).nodes[0];
    const edgeScene = { ...scene, nodes: [
      { ...node, id: 'left', x: -180, y: 300, width: 60, height: 60 },
      { ...node, id: 'right', x: 1120, y: 300, width: 60, height: 60 },
      { ...node, id: 'top', x: 400, y: -180, width: 60, height: 60 },
      { ...node, id: 'bottom', x: 400, y: 820, width: 60, height: 60 },
      { ...node, id: 'distant', x: 5000, y: 5000, width: 60, height: 60 },
    ] };
    const painter = new NodeCanvasPainter(context(), context());
    painter.update({ type: 'scene', scene: edgeScene });
    painter.update({ type: 'view', view: bufferedCanvasView(view, 2), theme });
    painter.draw(0);
    const painted = vi.mocked(paintBase).mock.calls.at(-1)![1];
    expect(painted.nodes.map(node => node.id)).toEqual(['left', 'right', 'top', 'bottom']);
  });
});

describe('canvas geometry uses the same interaction endpoints', () => {
  it('draws fan-out grips and cables exactly at the DOM hit targets, excluding an unplugged edge', () => {
    const graph = connectionFixture, nodes = graph.nodes, plugs = getConnectionPlugs(graph.edges, new Map(nodes.map(n => [n.id, n])));
    const options = { graph, nodes, plugs, selection: new Set<string>(), selectedNodeId: null, selectedEdgeId: null,
      hoveredEdgeId: null, hoveredPort: null, draft: null, clips: [], keyframes: new Map(), sourceTime: () => 0 };
    const result = buildCanvasScene(options);
    expect(result.plugs.map(p => p.tip)).toEqual(plugs.map(p => p.tip));
    const output = plugs.find(p => p.edge.id === 'surface-link' && p.port.direction === 'output')!;
    const input = plugs.find(p => p.edge.id === 'surface-link' && p.port.direction === 'input')!;
    expect(result.cables[0]).toMatchObject({ from: output.tip, to: input.tip });
    const reconnect = buildCanvasScene({ ...options, draft: { nodeId: 'Source', portId: 'out', direction: 'output', type: 'video',
      compatibilityKey: 'video', pointerId: 1, start: output.center, end: { x: 400, y: 400 }, moved: true, reconnectEdgeId: 'surface-link' } });
    expect(reconnect.cables.filter(c => !c.draft)).toHaveLength(1);
    expect(reconnect.cables.find(c => c.draft)?.from).toEqual(output.tip);
    expect(reconnect.plugs.some(p => p.center === input.center)).toBe(false);
  });
  it.each([[0, 400], [400, 0], [0, 60]])('moves from output to input even for folded cables (%s -> %s)', (x, toX) => {
    const cable = makeCanvasCable({ x, y: 0 }, { x: toX, y: 200 }, '#fff');
    expect(signalPosition(cable, 0)).toEqual(cable.from);
    expect(signalPosition(cable, 1)).toEqual(cable.to);
    const samples = cableArcLengths(cable);
    expect(samples.distances.every((n, i) => !i || n >= samples.distances[i - 1])).toBe(true);
    expect(cableArcLengths(cable)).toBe(samples);
    expect(cable).not.toHaveProperty('points');
  });
});

describe('worker delivery and failure recovery', () => {
  function setup() {
    vi.useFakeTimers();
    const host = document.createElement('div'), ready = vi.fn(), viewReady = vi.fn();
    const messages: unknown[] = [];
    const workers: Array<{ onmessage?: (event: { data: { type: string; revision?: number; bitmap?: ImageBitmap } }) => void; onerror?: () => void; terminate: ReturnType<typeof vi.fn> }> = [];
    const transferFromImageBitmap = vi.fn();
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: { type: string; revision?: number; bitmap?: ImageBitmap } }) => void; onerror?: () => void;
      terminate = vi.fn(); constructor() { workers.push(this); } postMessage(message: unknown) { messages.push(message); }
    });
    vi.stubGlobal('OffscreenCanvas', class {});
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value: vi.fn(() => ({})) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, type: string) {
      if (type === 'bitmaprenderer') return { transferFromImageBitmap } as unknown as ImageBitmapRenderingContext;
      return { canvas: this, setTransform: vi.fn(), clearRect: vi.fn() } as unknown as CanvasRenderingContext2D;
    });
    const runtime = createNodeCanvasRuntime(host, ready, viewReady);
    runtime.update({ type: 'scene', scene }); runtime.update({ type: 'view', view, theme });
    return { host, ready, viewReady, messages, workers, runtime, transferFromImageBitmap };
  }
  it('delivers the latest pointer view without waiting for another animation frame', async () => {
    const s = setup();
    for (let i = 0; i < 40; i++) s.runtime.update({ type: 'view', view: { ...view, panX: i }, theme });
    await Promise.resolve();
    expect(s.messages.filter(m => (m as { type: string }).type === 'view')).toEqual([{ type: 'view', view: { ...view, panX: 39 }, theme }]);
    expect(s.ready).not.toHaveBeenCalled();
    const bitmap = { width: 10, height: 8, close: vi.fn() } as unknown as ImageBitmap;
    s.workers[0].onmessage?.({ data: { type: 'frame', bitmap } });
    expect(s.transferFromImageBitmap).toHaveBeenCalledWith(bitmap);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(s.messages).toContainEqual({ type: 'presented' });
    expect(s.ready).toHaveBeenCalledWith(true);
    s.runtime.dispose(); expect(s.workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('acknowledges the exact viewport revision after the worker paints it', () => {
    const s = setup();
    const bitmap = { width: 10, height: 8, close: vi.fn() } as unknown as ImageBitmap;
    s.workers[0].onmessage?.({ data: { type: 'frame', bitmap, revision: 17 } });
    expect(s.viewReady).toHaveBeenCalledWith(17);
    s.runtime.dispose();
  });
  it('replaces transferred surfaces and redraws current state using software after worker failure', async () => {
    const s = setup(), original = s.host.firstElementChild;
    await Promise.resolve(); s.workers[0].onerror?.(); vi.advanceTimersByTime(20);
    expect(s.host.firstElementChild).not.toBe(original); expect(s.host.dataset.renderer).toBe('software');
    expect(paintBase).toHaveBeenCalled(); expect(s.workers[0].terminate).toHaveBeenCalledOnce();
    s.runtime.dispose(); expect(s.host.children).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('falls back if startup never acknowledges a frame and leaves no callbacks after disposal', async () => {
    const s = setup(); await Promise.resolve(); vi.advanceTimersByTime(5020);
    expect(s.host.dataset.renderer).toBe('software'); s.runtime.dispose();
    const count = vi.mocked(paintBase).mock.calls.length;
    s.runtime.update({ type: 'scene', scene }); vi.advanceTimersByTime(10000);
    expect(paintBase).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
  });
});
