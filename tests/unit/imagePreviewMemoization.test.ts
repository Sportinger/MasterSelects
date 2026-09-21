import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockClip } from '../helpers/mockData';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { imageOperatorKnownValues, imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';
import * as owner from '../../src/services/operators/effectGraphOwner';
import * as compiler from '../../src/services/operators/imageOperatorGraph';
import { createDefaultFisheyeGraph } from '../../src/services/operators/fisheyeEffectGraph';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const effect: Effect = { id: 'fisheye', type: 'fisheye', name: 'Fisheye', enabled: true, params: { fieldOfView: 140 } };
  const clip = createMockClip({ id: 'preview-clip', effects: [effect] });
  const graph = buildEffectOperatorGraph(clip, effect);
  const request = (id: string, time = 0) => ({ key: id, revision: String(time), time, clipId: clip.id,
    node: graph.nodes.find(node => node.id === id)!, width: 80, height: 48, interval: 16, priority: 1 });
  return { effect, clip, request };
}

describe('image preview compilation reuse', () => {
  it('shares graph validation across Fisheye ports and reuses uniform results while navigating or retrying texture previews', () => {
    const { effect, clip, request } = fixture();
    const graph = vi.spyOn(owner, 'effectOperatorGraph'), lower = vi.spyOn(compiler, 'compileImageOperatorPreview');
    const first = imageOperatorValuePreview(request('field-of-view-radians'), clip, effect);
    expect(first?.drawing).toMatchObject({ kind: 'number', value: '2.4435' });
    const lowerCount = lower.mock.calls.length;
    expect(lowerCount).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) {
      imageOperatorValuePreview(request('field-of-view-radians', i), clip, effect);
      imageOperatorKnownValues(request('field-of-view-radians', i), clip, effect);
    }
    expect(lower).toHaveBeenCalledTimes(lowerCount);
    imageOperatorValuePreview(request('strength'), clip, effect);
    expect(graph).toHaveBeenCalledOnce();
  });

  it('invalidates parameter, graph and keyframe edits without retaining stale numeric controls', () => {
    const { effect, clip, request } = fixture();
    expect(imageOperatorValuePreview(request('field-of-view'), clip, effect)?.controls?.[0].value).toBe(140);
    effect.params.fieldOfView = 90;
    expect(imageOperatorValuePreview(request('field-of-view'), clip, effect)?.controls?.[0].value).toBe(90);
    effect.operatorGraph = createDefaultFisheyeGraph();
    effect.operatorGraph.nodes.find(node => node.id === 'one')!.constants!.value = 2;
    expect(imageOperatorValuePreview(request('one'), clip, effect)?.controls?.[0].value).toBe(2);
    effect.operatorGraph.nodes.find(node => node.id === 'one')!.constants!.value = 3;
    expect(imageOperatorValuePreview(request('one'), clip, effect)?.controls?.[0].value).toBe(3);
    const keys: Keyframe[] = [
      { id: 'a', clipId: clip.id, property: 'effect.fisheye.fieldOfView', time: 0, value: 90, easing: 'linear' },
      { id: 'b', clipId: clip.id, property: 'effect.fisheye.fieldOfView', time: 2, value: 180, easing: 'linear' },
    ];
    expect(imageOperatorValuePreview(request('field-of-view', 1), clip, effect, keys, 1)?.controls?.[0].value).toBe(135);
    expect(imageOperatorValuePreview(request('field-of-view', 2), clip, effect, keys, 2)?.controls?.[0].value).toBe(180);
    expect(imageOperatorValuePreview(request('field-of-view', 2), clip, effect, [], 2)?.controls?.[0].value).toBe(90);
  });
});
