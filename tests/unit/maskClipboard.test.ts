import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import { createMaskEdgeFeatherProperty, createMaskNumericProperty, createMaskPathProperty } from '../../src/types/animationProperties';
import type { Keyframe } from '../../src/types/keyframes';
import type { ClipMask } from '../../src/types/masks';
import type { TimelineClip } from '../../src/types/timeline';
import { createMaskEdgeId } from '../../src/utils/maskEdgeFeathers';

const initialTimelineState = useTimelineStore.getState();

function clip(id: string, duration = 5, masks?: ClipMask[]): TimelineClip {
  return {
    id,
    trackId: 'video-1',
    name: id,
    file: new File([], `${id}.mp4`),
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    masks,
  };
}

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

describe('mask clipboard', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    useTimelineStore.setState({
      clips: [],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(),
      activeMaskId: null,
      selectedVertexIds: new Set(),
      clipboardMask: null,
    });
  });

  it('copies a mask and remaps its keyframes onto the selected target clip', () => {
    const sourceEdgeId = createMaskEdgeId('v1', 'v2');
    const sourceMask: ClipMask = {
      id: 'mask-a',
      name: 'Reveal',
      vertices: [vertex('v1', 0.1, 0.2), vertex('v2', 0.8, 0.2)],
      edgeFeathers: { [sourceEdgeId]: 18 },
      closed: true,
      opacity: 1,
      feather: 8,
      featherQuality: 50,
      inverted: false,
      mode: 'add',
      expanded: true,
      position: { x: 0, y: 0 },
      enabled: true,
      visible: true,
      outlineColor: '#ff9900',
    };
    const keyframes: Keyframe[] = [
      {
        id: 'kf-path',
        clipId: 'source',
        time: 1,
        property: createMaskPathProperty('mask-a'),
        value: 0,
        easing: 'linear',
        pathValue: { closed: true, vertices: [sourceMask.vertices[0], sourceMask.vertices[1], vertex('v-extra', 0.5, 0.7)] },
      },
      {
        id: 'kf-feather',
        clipId: 'source',
        time: 7,
        property: createMaskNumericProperty('mask-a', 'feather'),
        value: 24,
        easing: 'ease-in',
      },
      {
        id: 'kf-edge-feather',
        clipId: 'source',
        time: 3,
        property: createMaskEdgeFeatherProperty('mask-a', sourceEdgeId),
        value: 18,
        easing: 'linear',
      },
      {
        id: 'kf-opacity',
        clipId: 'source',
        time: 2,
        property: 'opacity',
        value: 0.5,
        easing: 'linear',
      },
    ];

    useTimelineStore.setState({
      clips: [clip('source', 10, [sourceMask]), clip('target', 5)],
      clipKeyframes: new Map([['source', keyframes]]),
    });

    useTimelineStore.getState().copyClipMask('source', 'mask-a');
    useTimelineStore.setState({ selectedClipIds: new Set(['target']) });
    useTimelineStore.getState().pasteClipMask();

    const target = useTimelineStore.getState().clips.find(candidate => candidate.id === 'target')!;
    const pastedMask = target.masks?.[0];
    expect(pastedMask?.id).toBeTruthy();
    expect(pastedMask?.id).not.toBe('mask-a');
    expect(pastedMask?.vertices.map(v => v.id)).not.toContain('v1');
    expect(pastedMask?.vertices.map(v => v.id)).not.toContain('v2');
    const pastedEdgeId = createMaskEdgeId(pastedMask!.vertices[0].id, pastedMask!.vertices[1].id);
    expect(pastedMask?.edgeFeathers).toEqual({
      [pastedEdgeId]: 18,
    });

    const pastedKeyframes = useTimelineStore.getState().clipKeyframes.get('target') ?? [];
    expect(pastedKeyframes).toHaveLength(3);
    expect(pastedKeyframes.map(k => k.property)).toContain(createMaskPathProperty(pastedMask!.id));
    expect(pastedKeyframes.map(k => k.property)).toContain(createMaskNumericProperty(pastedMask!.id, 'feather'));
    expect(pastedKeyframes.map(k => k.property)).toContain(createMaskEdgeFeatherProperty(pastedMask!.id, pastedEdgeId));

    const pathKeyframe = pastedKeyframes.find(k => k.pathValue)!;
    expect(pathKeyframe.pathValue?.vertices[0].id).toBe(pastedMask?.vertices[0].id);
    expect(pathKeyframe.pathValue?.vertices.map(v => v.id)).not.toContain('v-extra');

    const featherKeyframe = pastedKeyframes.find(k => k.property === createMaskNumericProperty(pastedMask!.id, 'feather'))!;
    expect(featherKeyframe.time).toBe(5);
    expect(useTimelineStore.getState().activeMaskId).toBe(pastedMask?.id);
  });

  it('removes a mask together with its keyframes', () => {
    const mask: ClipMask = {
      id: 'mask-a',
      name: 'Tracked',
      vertices: [vertex('v1', 0.1, 0.2), vertex('v2', 0.8, 0.2)],
      closed: true,
      opacity: 1,
      feather: 4,
      featherQuality: 50,
      inverted: false,
      mode: 'add',
      expanded: true,
      position: { x: 0, y: 0 },
      enabled: true,
      visible: true,
    };
    const keyframes: Keyframe[] = [
      { id: 'kf-path', clipId: 'source', time: 0, property: createMaskPathProperty('mask-a'), value: 0, easing: 'linear' },
      { id: 'kf-feather', clipId: 'source', time: 1, property: createMaskNumericProperty('mask-a', 'feather'), value: 12, easing: 'linear' },
      { id: 'kf-edge-feather', clipId: 'source', time: 1, property: createMaskEdgeFeatherProperty('mask-a', createMaskEdgeId('v1', 'v2')), value: 6, easing: 'linear' },
      { id: 'kf-opacity', clipId: 'source', time: 1, property: 'opacity', value: 0.5, easing: 'linear' },
    ];

    useTimelineStore.setState({
      clips: [clip('source', 5, [mask])],
      clipKeyframes: new Map([['source', keyframes]]),
      keyframeRecordingEnabled: new Set([
        `source:${createMaskPathProperty('mask-a')}`,
        `source:${createMaskNumericProperty('mask-a', 'feather')}`,
        `source:${createMaskEdgeFeatherProperty('mask-a', createMaskEdgeId('v1', 'v2'))}`,
        'source:opacity',
      ]),
      selectedKeyframeIds: new Set(['kf-path', 'kf-opacity']),
    });

    useTimelineStore.getState().removeMask('source', 'mask-a');

    const source = useTimelineStore.getState().clips.find(candidate => candidate.id === 'source')!;
    expect(source.masks).toEqual([]);
    expect(useTimelineStore.getState().clipKeyframes.get('source')).toEqual([keyframes[3]]);
    expect([...useTimelineStore.getState().keyframeRecordingEnabled]).toEqual(['source:opacity']);
    expect([...useTimelineStore.getState().selectedKeyframeIds]).toEqual(['kf-opacity']);
  });
});
