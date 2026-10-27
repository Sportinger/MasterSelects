import { afterEach, describe, expect, it } from 'vitest';

import {
  detectPhoneCropRatio, NO_CROP, phoneRatioCrop, phoneTransformPropertyValue, readPhoneTransform, resetPhoneTransform, setPhoneCropEdge,
} from '../../src/components/mobileSkin/crop/phoneCropGeometry';
import { readPhoneCrop, writePhoneCrop, writePhoneTransform } from '../../src/components/mobileSkin/crop/phoneCropCommands';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const PORTRAIT = { width: 360, height: 640 };
const COMP = { width: 1080, height: 1920 };

describe('phone crop geometry', () => {
  it('crops the largest centred area of a ratio', () => {
    expect(phoneRatioCrop(PORTRAIT, 1)).toEqual({ left: 0, right: 0, top: 140, bottom: 140, softness: 0 });
    const wide = phoneRatioCrop({ width: 1920, height: 1080 }, 1, 5);
    expect(wide).toEqual({ left: 420, right: 420, top: 0, bottom: 0, softness: 5 });
    expect(phoneRatioCrop(PORTRAIT, 9 / 16)).toEqual(NO_CROP);
  });

  it('recognises a ratio crop, a free crop and no crop', () => {
    expect(detectPhoneCropRatio(phoneRatioCrop(PORTRAIT, 4 / 5), PORTRAIT)).toBe('4:5');
    expect(detectPhoneCropRatio({ ...NO_CROP, left: 10 }, PORTRAIT)).toBe('free');
    expect(detectPhoneCropRatio(NO_CROP, PORTRAIT)).toBeNull();
  });

  it('keeps at least 1 % of the picture when an edge is dragged into the opposite one', () => {
    const values = setPhoneCropEdge({ ...NO_CROP, right: 300 }, 'left', 95, PORTRAIT);
    expect(values.left).toBeCloseTo(360 * 0.99 - 300, 6);
  });

  it('maps transform values to the stored property values of the desktop inspector', () => {
    const values = readPhoneTransform({
      opacity: 0.5, blendMode: 'normal', position: { x: 0.5, y: -0.25, z: 0 }, scale: { all: 2, x: -3, y: 3 }, rotation: { x: 0, y: 0, z: 15 },
    }, COMP);
    expect(values).toMatchObject({ x: 270, y: -240, scale: 2, scaleX: 3, scaleY: 3, rotation: 15, opacity: 0.5, flipH: true, flipV: false });
    expect(phoneTransformPropertyValue('position.x', values, COMP)).toBeCloseTo(0.5, 9);
    expect(phoneTransformPropertyValue('scale.x', values, COMP)).toBe(-3);
    expect(phoneTransformPropertyValue('scale.y', { ...values, flipV: true }, COMP)).toBe(-3);
    const reset = resetPhoneTransform(values);
    expect(reset).toMatchObject({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, scaleX: 3 });
  });
});

describe('phone crop commands', () => {
  const original = useTimelineStore.getState();
  afterEach(() => useTimelineStore.setState(original, true));

  it('writes the inspector crop mask, reads it back and removes it when empty', () => {
    useTimelineStore.setState({ clips: [createMockClip({ id: 'c', trackId: 't' })], tracks: [createMockTrack({ id: 't', type: 'video' })], clipKeyframes: new Map() });
    writePhoneCrop('c', phoneRatioCrop(PORTRAIT, 1, 4), PORTRAIT);
    const clip = useTimelineStore.getState().clips[0];
    expect(clip.masks).toHaveLength(1);
    expect(clip.masks![0]).toMatchObject({ purpose: 'crop', mode: 'intersect', feather: 4 });
    const read = readPhoneCrop(clip, PORTRAIT);
    expect(read.enabled).toBe(true);
    expect(read.values.top).toBeCloseTo(140, 6);
    writePhoneCrop('c', NO_CROP, PORTRAIT);
    expect(useTimelineStore.getState().clips[0].masks).toHaveLength(0);
  });

  it('writes only the touched transform keys through setPropertyValue', () => {
    useTimelineStore.setState({ clips: [createMockClip({ id: 'c', trackId: 't' })], tracks: [createMockTrack({ id: 't', type: 'video' })], clipKeyframes: new Map() });
    const before = useTimelineStore.getState().clips[0].transform;
    const values = { ...readPhoneTransform(before, COMP), flipH: true, opacity: 0.25, x: 540 };
    writePhoneTransform('c', values, new Set(['scale.x', 'opacity'] as const), COMP);
    const after = useTimelineStore.getState().clips[0].transform;
    expect(after.scale.x).toBe(-Math.abs(before.scale.x || 1));
    expect(after.opacity).toBe(0.25);
    expect(after.position.x).toBe(before.position.x);
  });
});
