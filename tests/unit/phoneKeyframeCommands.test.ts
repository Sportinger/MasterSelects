import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PHONE_KEYFRAME_PROPERTIES, adjacentPhoneKeyTime, listPhoneKeyedProperties, phoneDiamondState, phoneKeyframePropertyLabel,
  resolvePhoneKeyframeTarget, togglePhoneKeyframeAtPlayhead,
} from '../../src/components/mobileSkin/keyframe/phoneKeyframeCommands';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Keyframe } from '../../src/types/keyframes';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const key = (id: string, property: string, time: number, value = 0): Keyframe =>
  ({ id, clipId: 'v', property: property as Keyframe['property'], time, value, easing: 'linear' });

describe('phone keyframe diamond', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [createMockTrack({ id: 'video-1', type: 'video' }), createMockTrack({ id: 'audio-1', type: 'audio' })],
      clips: [
        createMockClip({ id: 'v', trackId: 'video-1', startTime: 1, duration: 4, transform: { opacity: 0.8, blendMode: 'normal', position: { x: 0.2, y: -0.1, z: 0 }, anchor: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1.5 }, rotation: { x: 0, y: 0, z: 30 } } }),
        createMockClip({ id: 'a', trackId: 'audio-1', startTime: 1, duration: 4 }),
      ],
      clipKeyframes: new Map(),
      selectedClipIds: new Set(['v']),
      primarySelectedClipId: 'v',
      playheadPosition: 3,
      isExporting: false,
    });
  });
  afterEach(() => {
    useTimelineStore.setState({ clips: [], clipKeyframes: new Map(), selectedClipIds: new Set(), primarySelectedClipId: null });
  });

  it('adds one key per transform property with the shown values, then removes them on the second tap', () => {
    expect(togglePhoneKeyframeAtPlayhead()).toEqual({ ok: true, message: 'Keyframe added' });
    const keys = useTimelineStore.getState().clipKeyframes.get('v')!;
    expect(keys.map((k) => [k.property, k.time, k.value]).toSorted()).toEqual([
      ['opacity', 2, 0.8], ['position.x', 2, 0.2], ['position.y', 2, -0.1], ['rotation.z', 2, 30], ['scale.x', 2, 1.5], ['scale.y', 2, 1.5],
    ].toSorted());
    expect(phoneDiamondState(keys, useTimelineStore.getState().clips[0], 3)).toBe('on');
    expect(phoneDiamondState(keys, useTimelineStore.getState().clips[0], 3.5)).toBe('off');
    expect(phoneDiamondState(keys, useTimelineStore.getState().clips[0], 9)).toBe('outside');

    expect(togglePhoneKeyframeAtPlayhead()).toEqual({ ok: true, message: `Removed ${PHONE_KEYFRAME_PROPERTIES.length} keyframes` });
    expect(useTimelineStore.getState().clipKeyframes.get('v') ?? []).toEqual([]);
  });

  it('refuses with a reason instead of silently doing nothing', () => {
    useTimelineStore.setState({ playheadPosition: 8 });
    expect(togglePhoneKeyframeAtPlayhead()).toMatchObject({ ok: false, message: expect.stringMatching(/playhead onto/) });
    useTimelineStore.setState({ selectedClipIds: new Set(['a']), primarySelectedClipId: 'a' });
    expect(resolvePhoneKeyframeTarget()).toMatchObject({ ok: false, reason: expect.stringMatching(/Audio/) });
    useTimelineStore.setState({ selectedClipIds: new Set(), primarySelectedClipId: null });
    expect(resolvePhoneKeyframeTarget()).toMatchObject({ ok: false, reason: expect.stringMatching(/Select a clip/) });
  });
});

describe('phone keyframe sheet helpers', () => {
  const keys = [key('1', 'opacity', 0), key('2', 'opacity', 2), key('3', 'position.x', 1), key('4', 'text.fontSize', 3), key('5', 'effect.e1.amount', 1)];

  it('lists keyed properties transform-first with readable labels', () => {
    const list = listPhoneKeyedProperties(keys, { effects: [{ id: 'e1', name: 'Blur' } as never] });
    expect(list.map((group) => [group.label, group.keys.length])).toEqual([
      ['Position X', 1], ['Opacity', 2], ['Blur · amount', 1], ['Text font size', 1],
    ]);
    expect(phoneKeyframePropertyLabel('rotation.z')).toBe('Rotation');
  });

  it('finds the previous and next distinct key time', () => {
    expect(adjacentPhoneKeyTime(keys, 1, 1)).toBe(2);
    expect(adjacentPhoneKeyTime(keys, 1, -1)).toBe(0);
    expect(adjacentPhoneKeyTime(keys, 0, -1)).toBeNull();
    expect(adjacentPhoneKeyTime(keys, 3, 1)).toBeNull();
  });
});
