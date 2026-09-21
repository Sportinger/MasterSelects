import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
import { produceNodePreview } from '../../src/services/nodePreview/previewSources';
import { createDefaultPixelSortGraph } from '../../src/services/operators/pixelSortEffectGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect, Keyframe } from '../../src/types';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();

describe('Pixel Sort operator preview routing', () => {
  afterEach(() => { vi.restoreAllMocks(); useTimelineStore.setState(initial); });

  it('routes bound numeric defaults and keyframes through the compute-image preview adapter', () => {
    const effect: Effect = { id: 'pixel-sort-preview', type: 'pixel-sort', name: 'Pixel Sort', enabled: true,
      params: {}, operatorGraph: createDefaultPixelSortGraph() };
    const clip = createMockClip({ id: 'pixel-sort-preview-clip', effects: [effect], startTime: 0 });
    const property = 'effect.pixel-sort-preview.amount' as Keyframe['property'];
    const keys: Keyframe[] = [{ id: 'amount-0', clipId: clip.id, property, time: 0, value: .2, easing: 'linear' },
      { id: 'amount-2', clipId: clip.id, property, time: 2, value: .8, easing: 'linear' }];
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map([[clip.id, keys]]) });
    const nodes = buildEffectOperatorGraph(clip, effect).nodes;
    const request = (nodeId: string, time: number) => ({ key: nodeId, revision: '1', time, clipId: clip.id,
      node: nodes.find(node => node.id === nodeId)!, width: 164, height: 100, interval: 16, priority: 1 });
    expect(produceNodePreview(request('scale', 1))).toMatchObject({ status: 'live', controls: [{ value: 16 }] });
    expect(produceNodePreview(request('amount', 1))).toMatchObject({ status: 'live', controls: [{ value: .5 }] });
  });

  it('routes image ports to the existing texture tap', async () => {
    const effect: Effect = { id: 'pixel-sort-preview', type: 'pixel-sort', name: 'Pixel Sort', enabled: true,
      params: {}, operatorGraph: createDefaultPixelSortGraph() };
    const clip = createMockClip({ id: 'pixel-sort-preview-clip', effects: [effect] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'sorted')!;
    const port = node.outputs.find(candidate => candidate.id === 'image')!;
    const frame = { key: 'sorted-image', revision: '1', time: 0, status: 'live', label: 'Texture' } as const;
    const tap = vi.spyOn(nodePreviewTextureTap, 'request').mockResolvedValue(frame);
    await expect(produceNodePreview({ key: frame.key, revision: frame.revision, time: 0, clipId: clip.id, node, port,
      width: 164, height: 100, interval: 16, priority: 1 })).resolves.toEqual(frame);
    expect(tap).toHaveBeenCalledWith(`image-node:${effect.id}:sorted:output:image`, expect.anything());
  });
});
