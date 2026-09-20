import { describe, expect, it, vi } from 'vitest';
import { NodePreviewScheduler } from '../../src/services/nodePreview/NodePreviewScheduler';
import { nodePreviewKey, type PreviewFrame, type PreviewRequest } from '../../src/services/nodePreview/previewTypes';
import { cloneClipNodeGraph } from '../../src/services/nodeGraph/clipGraphProjectionState';
import type { NodeGraphNode } from '../../src/types/nodeGraph';

const node: NodeGraphNode = { id: 'source', label: 'Source', kind: 'source', runtime: 'builtin', inputs: [], outputs: [], layout: { x: 0, y: 0 } };
const request = (key: string, revision = '1'): PreviewRequest => ({ key, revision, clipId: 'clip', node, time: 0, width: 128, height: 72, interval: 100, priority: 0 });
const result = (r: PreviewRequest): PreviewFrame => ({ key: r.key, revision: r.revision, time: r.time, status: 'live', label: 'Source' });

describe('node preview work budgets', () => {
  it('accepts bounded asynchronous latency during playback but rejects a seek or an edit', async () => {
    let finish!: (frame: PreviewFrame) => void;
    const publish = vi.fn(), scheduler = new NodePreviewScheduler(() => new Promise(resolve => finish = resolve), publish, () => 0);
    const first = { ...request('image', 'frame-0'), continuity: 'play-1', time: 1 };
    scheduler.setRequests([first]); scheduler.tick(0);
    scheduler.setRequests([{ ...first, revision: 'frame-1', time: 1.15 }]); finish(result(first)); await Promise.resolve();
    expect(publish).toHaveBeenCalledOnce();
    scheduler.tick(200);
    scheduler.setRequests([{ ...first, revision: 'seek', continuity: 'play-2', time: 4 }]);
    finish(result(first)); await Promise.resolve(); expect(publish).toHaveBeenCalledOnce();
  });
  it('keeps only current requests, caps concurrency and closes late results after scrubbing', async () => {
    const jobs: Array<{ request: PreviewRequest; resolve: (frame: PreviewFrame) => void }> = [];
    const publish = vi.fn();
    const scheduler = new NodePreviewScheduler(r => new Promise(resolve => jobs.push({ request: r, resolve })), publish, () => 0);
    scheduler.setRequests(Array.from({ length: 1000 }, (_, i) => request(String(i)))); scheduler.tick(0);
    expect(jobs).toHaveLength(2); expect(scheduler.stats.inFlight).toBe(2);
    scheduler.setRequests([request('0', 'latest')]);
    const close = vi.fn(); jobs[0].resolve({ ...result(jobs[0].request), bitmap: { close } as unknown as ImageBitmap });
    jobs[1].resolve(result(jobs[1].request)); await Promise.resolve();
    expect(publish).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); expect(scheduler.stats.discarded).toBe(2);
    scheduler.tick(200); expect(jobs).toHaveLength(3); expect(jobs[2].request.revision).toBe('latest');
    scheduler.dispose(); jobs[2].resolve({ ...result(jobs[2].request), bitmap: { close } as unknown as ImageBitmap }); await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(2); expect(publish).not.toHaveBeenCalled();
  });
  it('deduplicates shared sources and does no work for unchanged paused frames', () => {
    const produce = vi.fn(result), scheduler = new NodePreviewScheduler(produce, vi.fn(), () => 0);
    scheduler.setRequests([request('shared'), request('shared')]); scheduler.tick(0);
    for (let i = 1; i < 120; i++) scheduler.tick(i * 33);
    expect(produce).toHaveBeenCalledOnce(); expect(scheduler.unsettled).toBe(false);
    scheduler.setRequests([]); expect(scheduler.stats.requested).toBe(0);
  });
  it.each([16, 64, 128])('fairly services %i visible previews while bounding pixel throughput', count => {
    const publish = vi.fn(), scheduler = new NodePreviewScheduler(result, publish, () => 0);
    const requests = Array.from({ length: count }, (_, i) => ({ ...request(String(i)), priority: i === 0 ? 2 : 0 }));
    scheduler.setRequests(requests);
    for (let time = 0; time < 3000; time += 32) scheduler.tick(time);
    expect(new Set(publish.mock.calls.map(([frame]) => frame.key)).size).toBe(count);
    expect(scheduler.stats.pixels).toBeLessThanOrEqual(262144 + 3 * 2_000_000);
    expect(scheduler.stats.inFlight).toBe(0);
  });
  it('shares source images across domain nodes while keeping depth and audio separate', () => {
    const source = { ...node, binding: { kind: 'clip-source' as const }, outputs: [{ id: 'video', label: 'Video', direction: 'output' as const, type: 'texture' as const }] };
    const inner = { ...node, id: 'inner-source', binding: { kind: 'effect-operator' as const, effectId: 'cables', nodeId: 'source', operator: 'media.source' }, outputs: [{ ...source.outputs[0], id: 'image', metadata: { semanticKind: 'operator:image' } }] };
    expect(nodePreviewKey('clip', source)).toBe(nodePreviewKey('clip', inner));
    expect(nodePreviewKey('other', source)).not.toBe(nodePreviewKey('clip', source));
  });
  it('clones durable viewer preferences without aliasing history snapshots', () => {
    const graph = { version: 1 as const, nodes: [], previews: { enabled: false, nodes: { source: { enabled: true, portId: 'video' } } } };
    const clone = cloneClipNodeGraph(graph)!;
    expect(clone.previews).toEqual(graph.previews);
    clone.previews!.nodes.source.enabled = false;
    expect(graph.previews.nodes.source.enabled).toBe(true);
  });
});
