import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import { createMaskEdgeFeatherProperty } from '../../src/types/animationProperties';
import type { ClipMask } from '../../src/types/masks';
import type { TimelineClip } from '../../src/types/timeline';
import { createMaskEdgeId } from '../../src/utils/maskEdgeFeathers';
import { evaluateCompositionClipMasks } from '../../src/services/compositionRender/keyframeEvaluation';

const initialTimelineState = useTimelineStore.getState();

function vertex(id: string, x: number, y: number) {
  return {
    id,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none' as const,
  };
}

function mask(): ClipMask {
  return {
    id: 'mask-a',
    name: 'Reveal',
    vertices: [vertex('v1', 0, 0), vertex('v2', 1, 0), vertex('v3', 1, 1), vertex('v4', 0, 1)],
    closed: true,
    opacity: 1,
    feather: 0,
    featherQuality: 50,
    inverted: false,
    mode: 'add',
    expanded: true,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: true,
  };
}

function clip(masks: ClipMask[]): TimelineClip {
  return {
    id: 'clip-a',
    trackId: 'video-1',
    name: 'clip-a',
    file: new File([], 'clip-a.mp4'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    masks,
  };
}

describe('mask edge feather', () => {
  it('edits and records feather offset and balance without changing the editable path', () => {
    const activeMask = mask();
    useTimelineStore.setState({ clips: [clip([activeMask])], playheadPosition: 1 });
    for (const [name, value] of [['featherOffset', -80], ['featherBalance', 4]] as const) {
      const property = `mask.mask-a.${name}` as const;
      useTimelineStore.getState().setPropertyValue('clip-a', property, value);
      expect(useTimelineStore.getState().clips[0].masks?.[0][name]).toBe(value);
      useTimelineStore.getState().toggleKeyframeRecording('clip-a', property);
      useTimelineStore.getState().setPropertyValue('clip-a', property, value + 1);
      expect(useTimelineStore.getState().clipKeyframes.get('clip-a')).toEqual(expect.arrayContaining([
        expect.objectContaining({ property, time: 1, value: value + 1 }),
      ]));
    }
    expect(useTimelineStore.getState().clips[0].masks?.[0].vertices).toEqual(activeMask.vertices);
  });
  it('animates contour offset and balance identically in direct and nested rendering', () => {
    const activeMask = mask();
    const keyframes = (['featherOffset', 'featherBalance'] as const).flatMap((name) => [
      { id: `${name}-0`, clipId: 'clip-a', property: `mask.mask-a.${name}` as const, time: 0, value: name === 'featherOffset' ? -80 : 1, easing: 'linear' as const },
      { id: `${name}-2`, clipId: 'clip-a', property: `mask.mask-a.${name}` as const, time: 2, value: name === 'featherOffset' ? 80 : 5, easing: 'linear' as const },
    ]);
    useTimelineStore.setState({ clips: [clip([activeMask])], clipKeyframes: new Map([['clip-a', keyframes]]) });
    const direct = useTimelineStore.getState().getInterpolatedMasks('clip-a', 1)!;
    expect(direct[0]).toMatchObject({ featherOffset: 0, featherBalance: 3, feather: 0 });
    expect(evaluateCompositionClipMasks([activeMask], keyframes, 1)).toEqual(direct);
  });
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    useTimelineStore.setState({
      clips: [],
      clipKeyframes: new Map(),
      keyframeRecordingEnabled: new Set(),
      selectedVertexIds: new Set(),
      selectedMaskEdgeId: null,
      maskFeatherPreviewEnabled: true,
      maskFeatherPreview: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selects a single edge separately from vertices', () => {
    useTimelineStore.setState({ selectedVertexIds: new Set(['v1']) });

    const edgeId = createMaskEdgeId('v1', 'v2');
    useTimelineStore.getState().selectMaskEdge(edgeId);

    expect(useTimelineStore.getState().selectedMaskEdgeId).toBe(edgeId);
    expect(useTimelineStore.getState().selectedVertexIds.size).toBe(0);
  });

  it('stores edge feather values and removes zero-valued entries', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1234);
    const activeMask = mask();
    const edgeId = createMaskEdgeId('v1', 'v2');
    useTimelineStore.setState({ clips: [clip([activeMask])] });

    useTimelineStore.getState().setMaskEdgeFeather('clip-a', 'mask-a', edgeId, 14);

    const updatedMask = useTimelineStore.getState().clips[0].masks?.[0];
    expect(updatedMask?.edgeFeathers).toEqual({ [edgeId]: 14 });
    expect(useTimelineStore.getState().maskFeatherPreview).toEqual({
      maskId: 'mask-a',
      edgeId,
      changedAt: 1234,
    });

    useTimelineStore.getState().setMaskEdgeFeather('clip-a', 'mask-a', edgeId, 0);
    expect(useTimelineStore.getState().clips[0].masks?.[0].edgeFeathers).toBeUndefined();
  });

  it('keeps the red feather guide on by default and suppresses previews when disabled', () => {
    expect(initialTimelineState.maskFeatherPreviewEnabled).toBe(true);

    useTimelineStore.getState().showMaskFeatherPreview('mask-a');
    expect(useTimelineStore.getState().maskFeatherPreview?.maskId).toBe('mask-a');

    useTimelineStore.getState().setMaskFeatherPreviewEnabled(false);
    expect(useTimelineStore.getState().maskFeatherPreviewEnabled).toBe(false);
    expect(useTimelineStore.getState().maskFeatherPreview).toBeNull();

    useTimelineStore.getState().showMaskFeatherPreview('mask-a');
    expect(useTimelineStore.getState().maskFeatherPreview).toBeNull();
  });

  it('interpolates edge feather keyframes', () => {
    const activeMask = mask();
    const edgeId = createMaskEdgeId('v1', 'v2');
    const property = createMaskEdgeFeatherProperty('mask-a', edgeId);
    useTimelineStore.setState({
      clips: [clip([activeMask])],
      clipKeyframes: new Map([[
        'clip-a',
        [
          { id: 'kf-a', clipId: 'clip-a', property, time: 0, value: 10, easing: 'linear' },
          { id: 'kf-b', clipId: 'clip-a', property, time: 2, value: 30, easing: 'linear' },
        ],
      ]]),
    });

    const interpolatedMask = useTimelineStore.getState().getInterpolatedMasks('clip-a', 1)?.[0];

    expect(interpolatedMask?.edgeFeathers?.[edgeId]).toBeCloseTo(20);
  });

  it('records edge feather changes through setPropertyValue', () => {
    const activeMask = mask();
    const edgeId = createMaskEdgeId('v1', 'v2');
    const property = createMaskEdgeFeatherProperty('mask-a', edgeId);
    useTimelineStore.setState({ clips: [clip([activeMask])], playheadPosition: 1 });

    useTimelineStore.getState().toggleKeyframeRecording('clip-a', property);
    useTimelineStore.getState().setPropertyValue('clip-a', property, 22);

    const keyframe = useTimelineStore.getState().clipKeyframes.get('clip-a')?.[0];
    expect(keyframe).toMatchObject({ property, time: 1, value: 22 });
  });
});
