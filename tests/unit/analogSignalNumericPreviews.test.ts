import { afterEach, describe, expect, it } from 'vitest';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';
import { createDefaultAnalogSignalGraph } from '../../src/services/operators/analogSignalGraph';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import { createMockClip } from '../helpers/mockData';
import { createMockTrack } from '../helpers/mockData';
import { produceNodePreview } from '../../src/services/nodePreview/previewSources';
import { useTimelineStore } from '../../src/stores/timeline';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));

function preview(nodeId: string, effect: Effect, time = 0, keys: Keyframe[] = []) {
  const clip = createMockClip({ id: 'analog-preview-clip', effects: [effect] });
  const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === nodeId)!;
  return imageOperatorValuePreview({ key: nodeId, revision: '1', time, clipId: clip.id, node,
    width: 164, height: 100, interval: 16, priority: 1 }, clip, effect, keys, time);
}

describe('Analog Signal generic numeric previews', () => {
  it('uses canonical owner metadata for an editable display parameter', () => {
    const effect: Effect = { id: 'analog-preview', name: 'Analog Signal Lab', type: 'analog-signal-lab', enabled: true,
      params: { amount: .35 }, operatorGraph: createDefaultAnalogSignalGraph() };
    expect(preview('display-amount', effect)).toMatchObject({ status: 'live', controls: [{
      label: 'Mix', value: .35, defaultValue: 1, min: 0, max: 1, step: .01,
      target: { clipId: 'analog-preview-clip', effectId: 'analog-preview', nodeId: 'display-amount', parameter: 'value' },
    }], values: [{ portId: 'value', direction: 'output', value: .35 }] });
  });

  it('evaluates connected uniform scalar math but does not invent image-derived values', () => {
    const effect: Effect = { id: 'analog-preview', name: 'Analog Signal Lab', type: 'analog-signal-lab', enabled: true,
      params: { amount: .7 }, operatorGraph: createDefaultAnalogSignalGraph() };
    expect(preview('display-amount-clamp', effect)?.drawing).toMatchObject({ kind: 'number', value: '0.7' });
    expect(preview('display-signal-clamp', effect)?.drawing).toMatchObject({ kind: 'number', value: '1' });
    expect(preview('display-brightness', effect)).toBeUndefined();
  });

  it('samples bound display values at the requested composition time', () => {
    const effect: Effect = { id: 'analog-preview', name: 'Analog Signal Lab', type: 'analog-signal-lab', enabled: true,
      params: { amount: 0 }, operatorGraph: createDefaultAnalogSignalGraph() };
    const keys: Keyframe[] = [
      { id: 'amount-0', clipId: 'analog-preview-clip', property: 'effect.analog-preview.amount', time: 0, value: 0, easing: 'linear' },
      { id: 'amount-2', clipId: 'analog-preview-clip', property: 'effect.analog-preview.amount', time: 2, value: 1, easing: 'linear' },
    ];
    expect(preview('display-amount-clamp', effect, 1, keys)?.drawing).toMatchObject({ kind: 'number', value: '0.5' });
  });

  it('routes Analog generic values through the shared preview source before stage diagnostics', () => {
    const effect: Effect = { id: 'analog-preview', name: 'Analog Signal Lab', type: 'analog-signal-lab', enabled: true,
      params: { amount: .4 }, operatorGraph: createDefaultAnalogSignalGraph() };
    const clip = createMockClip({ id: 'analog-preview-clip', effects: [effect] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'display-amount')!;
    expect(produceNodePreview({ key: 'routed-amount', revision: '1', time: 0, clipId: clip.id, node,
      width: 164, height: 100, interval: 16, priority: 1 })).toMatchObject({ status: 'live', controls: [{ value: .4 }] });
  });
});
