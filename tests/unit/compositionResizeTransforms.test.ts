import { describe, expect, it } from 'vitest';

import type { MediaState } from '../../src/stores/mediaStore/types';
import { adjustClipTransformsOnResize } from '../../src/stores/mediaStore/slices/composition/resizeTransforms';
import type { Composition } from '../../src/stores/mediaStore/types';
import type { SerializableClip } from '../../src/types/timeline';
import { createMockClip, createMockKeyframe, createMockTransform } from '../helpers/mockData';

describe('composition resize transforms', () => {
  it('keeps layer scale and scale keyframes unchanged across aspect-ratio changes', () => {
    const clip = {
      ...createMockClip({
        id: 'clip-a',
        transform: createMockTransform({
          position: { x: 0.5, y: -0.25, z: 0 },
          scale: { all: 1.4, x: 0.75, y: 1.25 },
        }),
      }),
      keyframes: [
        createMockKeyframe({ id: 'pos-x', clipId: 'clip-a', property: 'position.x', value: 0.5 }),
        createMockKeyframe({ id: 'scale-x', clipId: 'clip-a', property: 'scale.x', value: 0.75 }),
        createMockKeyframe({ id: 'scale-y', clipId: 'clip-a', property: 'scale.y', value: 1.25 }),
      ],
    } as unknown as SerializableClip;
    const composition: Composition = {
      id: 'comp-a',
      name: 'Comp A',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 60,
      backgroundColor: '#000000',
      timelineData: {
        tracks: [],
        clips: [clip],
        playheadPosition: 0,
        duration: 60,
        zoom: 50,
        scrollX: 0,
        inPoint: null,
        outPoint: null,
        loopPlayback: false,
      },
    };
    const updates: Partial<Composition> = {};
    const get = () => ({
      activeCompositionId: 'another-comp',
      compositions: [composition],
    }) as unknown as MediaState;

    adjustClipTransformsOnResize(get, composition.id, 1920, 1080, 1080, 1920, updates);

    const resized = updates.timelineData?.clips[0];
    expect(resized?.transform.scale).toEqual(clip.transform.scale);
    expect(resized?.transform.position.x).toBeCloseTo(0.5 * (1920 / 1080));
    expect(resized?.transform.position.y).toBeCloseTo(-0.25 * (1080 / 1920));
    expect(resized?.keyframes?.find((keyframe) => keyframe.id === 'scale-x')?.value).toBe(0.75);
    expect(resized?.keyframes?.find((keyframe) => keyframe.id === 'scale-y')?.value).toBe(1.25);
  });
});
