import { describe, it, expect, vi } from 'vitest';
import { NodePreviewPainter } from '../../src/components/panels/nodes/previews/NodePreviewPainter';
import type { PreviewFrame } from '../../src/services/nodePreview/previewTypes';
import type { CanvasScene, CanvasView } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';
import { getNodeHeight, getPortCenter } from '../../src/components/panels/nodes/canvas/canvasGeometry';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import { previewExtraHeight } from '../../src/components/panels/nodes/previews/previewGeometry';

function context() {
  const calls = { clearRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), setTransform: vi.fn() };
  return new Proxy({ canvas: { width: 800, height: 600 }, ...calls }, { get(target, key) { return key in target ? target[key as keyof typeof target] : vi.fn(); } }) as unknown as CanvasRenderingContext2D;
}
const view: CanvasView = { width: 800, height: 600, ratio: 1, zoom: 1, panX: 0, panY: 0 };
const scene: CanvasScene = { nodes: [{ id: 'source', x: 0, y: 0, width: 184, height: 250, kind: 'source', label: 'Source', description: '', runtime: 'builtin', color: '#fff', selected: false, bypassed: false, bypassable: false, badges: [], ports: [], preview: { key: 'source', x: 10, y: 126, width: 164, height: 114, label: 'Image' } }], cables: [], plugs: [], groups: [] };
const frame = (key = 'source', close = vi.fn()): PreviewFrame => ({ key, revision: '1', time: 0, label: 'Source', status: 'live', bitmap: { width: 160, height: 90, close } as unknown as ImageBitmap });

describe('shared preview atlas', () => {
  it('never allocates or rasterizes an atlas tile for numeric or text viewers', () => {
    const output = context(), factory = vi.fn(() => context()), painter = new NodePreviewPainter(output, factory);
    painter.receive([{ key: 'source', revision: '1', time: 0, status: 'live', label: 'Number', drawing: { kind: 'number', value: '1.2', caption: 'Height' } },
      { key: 'camera', revision: '1', time: 0, status: 'live', label: 'Camera', drawing: { kind: 'text', lines: ['FOV: 50'] } }]);
    painter.draw(scene, view);
    expect(factory).not.toHaveBeenCalled(); expect(painter.size).toBe(0);
    expect(output.fillText).toHaveBeenCalledWith('1.2', expect.any(Number), expect.any(Number), expect.any(Number));
  });
  it('draws inline operands and sampled results at their own ports, including when only the top of a node is visible', () => {
    const output = context(), painter = new NodePreviewPainter(output, () => context());
    const numeric: CanvasScene = { ...scene, nodes: [{ ...scene.nodes[0], height: 900,
      preview: { ...scene.nodes[0].preview!, text: true, y: 858 },
      ports: [{ id: 'a', x: 7, y: 80, label: 'A', type: '', color: '#fff', input: true },
        { id: 'value', x: 177, y: 122, label: 'Value', type: '', color: '#fff', input: false }] }] };
    const sample: PreviewFrame = { key: 'source', revision: '1', time: 0, status: 'live', label: 'Center cell', presentation: 'text',
      controls: [{ portId: 'a', label: 'A', value: 2, defaultValue: 0, target: { clipId: 'c', effectId: 'e', nodeId: 'n', parameter: 'a' } }],
      values: [{ portId: 'a', direction: 'input', value: 99 }, { portId: 'value', direction: 'output', value: 4.25 }] };
    painter.receive([sample]); painter.draw(numeric, view);
    expect(output.fillText).toHaveBeenCalledWith('2', 83, 94, 64);
    expect(output.fillText).toHaveBeenCalledWith('4.25', 166, 136, 64);
    expect(vi.mocked(output.fillText).mock.calls.some(call => call[0] === '99')).toBe(false);
    painter.receive([{ ...sample, values: [{ portId: 'value', direction: 'output', value: 8 }] }]); painter.draw(numeric, view);
    expect(output.fillText).toHaveBeenCalledWith('8', 166, 136, 64);
    painter.invalidate(); painter.draw(numeric, { ...view, zoom: 0.5, panX: 40 });
    expect(output.setTransform).toHaveBeenLastCalledWith(0.5, 0, 0, 0.5, 40, 0);
    vi.mocked(output.fillText).mockClear(); painter.retain(new Set()); painter.draw(numeric, view);
    expect(output.fillText).not.toHaveBeenCalled();
  });
  it('reuses existing image pixels across zoom tiers without requiring another producer frame', () => {
    const output = context(), atlases: CanvasRenderingContext2D[] = [];
    const painter = new NodePreviewPainter(output, () => { const atlas = context(); atlases.push(atlas); return atlas; });
    painter.resolution(0.2, 1);
    painter.receive([frame()]); painter.draw(scene, view);
    for (const zoom of [0.5, 1]) {
      painter.resolution(zoom, 1); painter.draw(scene, { ...view, zoom });
      expect(painter.size).toBe(1);
      expect(atlases.at(-1)!.drawImage).toHaveBeenCalledOnce();
      expect(atlases.at(-2)!.canvas.width).toBe(1);
    }
    painter.resolution(0.2, 1); painter.invalidate(); painter.draw(scene, { ...view, zoom: 0.2 });
    expect(atlases).toHaveLength(3);
    expect(output.drawImage).toHaveBeenCalledTimes(4);
  });
  it('rasterizes once, closes transferred frames immediately, and reuses the atlas when panning', () => {
    const output = context(), atlas = context(), factory = vi.fn(() => atlas), close = vi.fn();
    const painter = new NodePreviewPainter(output, factory);
    painter.receive([frame('source', close)]); painter.draw(scene, view);
    expect(close).toHaveBeenCalledOnce(); expect(atlas.drawImage).toHaveBeenCalledOnce(); expect(factory).toHaveBeenCalledOnce();
    const painted = vi.mocked(output.drawImage).mock.calls.length;
    painter.draw(scene, view); expect(output.drawImage).toHaveBeenCalledTimes(painted);
    painter.invalidate(); painter.draw(scene, { ...view, panX: 60 });
    expect(output.drawImage).toHaveBeenCalledTimes(painted + 1); expect(atlas.drawImage).toHaveBeenCalledOnce();
    painter.dispose(); expect(atlas.canvas.width).toBe(1);
  });
  it('bounds memory across 1000 distinct frames and releases the atlas when all viewers are hidden', () => {
    const atlas = context(), factory = vi.fn(() => atlas), close = vi.fn(), painter = new NodePreviewPainter(context(), factory);
    for (let i = 0; i < 1000; i++) painter.receive([frame(String(i), close)]);
    expect(painter.size).toBe(128); expect(factory).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledTimes(1000);
    expect(atlas.canvas.width * atlas.canvas.height * 4).toBeLessThanOrEqual(32 * 1024 * 1024);
    painter.retain(new Set()); expect(painter.size).toBe(0); expect(atlas.canvas.height).toBe(1);
  });
  it('packs more than 1000 tiny previews into the same bounded atlas at overview zoom', () => {
    const atlas = context(), painter = new NodePreviewPainter(context(), () => atlas);
    painter.resolution(0.2, 1);
    for (let i = 0; i < 1000; i++) painter.receive([frame(String(i))]);
    expect(painter.size).toBe(1000);
    expect(atlas.canvas.width * atlas.canvas.height * 4).toBe(32 * 1024 * 1024);
    painter.resolution(1, 1);
    expect(painter.size).toBe(1000);
  });
  it('adds preview space without moving port endpoints', () => {
    const node = connectionFixture.nodes[0], expanded = { ...node, preview: { enabled: true, requested: true, key: 'source' } };
    expect(getNodeHeight(expanded)).toBe(getNodeHeight(node) + previewExtraHeight(expanded));
    const port = node.outputs[0];
    expect(getPortCenter(expanded, port.id, 'output')).toEqual(getPortCenter(node, port.id, 'output'));
  });
  it.each([9 / 16, 16 / 9, 1, 2.39])('preserves image aspect ratio %f in the node viewport', ratio => {
    const output = context(), painter = new NodePreviewPainter(output, () => context());
    const image = frame(); image.bitmap = { width: 144 * ratio, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    painter.receive([image]); painter.draw(scene, view);
    const call = vi.mocked(output.drawImage).mock.calls[0] as unknown as number[];
    expect(call[7] / call[8]).toBeCloseTo(ratio, 5);
    expect(call[7]).toBeLessThanOrEqual(164); expect(call[8]).toBeLessThanOrEqual(82);
  });
});
