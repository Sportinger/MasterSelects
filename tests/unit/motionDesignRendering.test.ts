import { describe, expect, it } from 'vitest';
import type { ClipTransform, Keyframe, TimelineClip } from '../../src/types';
import {
  createDefaultMotionLayerDefinition,
  createStrokeAppearance,
} from '../../src/types/motionDesign';
import { createMotionUniformArray } from '../../src/engine/motion/MotionBuffers';
import { getMotionRenderSize } from '../../src/engine/motion/MotionTypes';
import { getInterpolatedMotionLayer } from '../../src/utils/motionInterpolation';
import { createTestTimelineStore } from '../helpers/storeFactory';

function makeTransform(): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function makeMotionClip(motion = createDefaultMotionLayerDefinition('shape')): TimelineClip {
  return {
    id: 'motion-clip',
    trackId: 'video-1',
    name: 'Motion',
    file: new File([], 'motion.msmotion'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'motion-shape', naturalDuration: 5 },
    motion,
    transform: makeTransform(),
    effects: [],
    isLoading: false,
  };
}

describe('motion design rendering helpers', () => {
  it('sizes motion render targets with outside stroke padding', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      size: { w: 100, h: 50 },
    });
    motion.appearance?.items.push({
      ...createStrokeAppearance({ r: 1, g: 0, b: 0, a: 1 }),
      visible: true,
      width: 12,
      alignment: 'outside',
    });

    expect(getMotionRenderSize(motion)).toEqual({
      width: 124,
      height: 74,
      strokePadding: 12,
    });
  });

  it('packs shape, fill, and stroke values into renderer uniforms', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      primitive: 'ellipse',
      size: { w: 100, h: 50 },
      fillColor: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
    });
    motion.appearance?.items.push({
      ...createStrokeAppearance({ r: 1, g: 0, b: 0, a: 1 }),
      visible: true,
      width: 8,
      alignment: 'center',
    });

    const uniforms = createMotionUniformArray(motion, getMotionRenderSize(motion));

    expect(Array.from(uniforms.slice(0, 6))).toEqual([100, 50, 108, 58, 0, 1]);
    expect(Array.from(uniforms.slice(8, 12))).toEqual([0.25, 0.5, 0.75, 1]);
    expect(Array.from(uniforms.slice(16, 19))).toEqual([8, 1, 0]);
  });

  it('interpolates numeric motion properties through the property registry', () => {
    const clip = makeMotionClip(createDefaultMotionLayerDefinition('shape', {
      size: { w: 100, h: 50 },
    }));
    const keyframes: Keyframe[] = [
      {
        id: 'kf-1',
        clipId: clip.id,
        time: 0,
        property: 'shape.size.w',
        value: 100,
        easing: 'linear',
      },
      {
        id: 'kf-2',
        clipId: clip.id,
        time: 2,
        property: 'shape.size.w',
        value: 300,
        easing: 'linear',
      },
    ];

    const interpolated = getInterpolatedMotionLayer(clip, keyframes, 1);

    expect(interpolated?.shape?.size.w).toBe(200);
    expect(clip.motion?.shape?.size.w).toBe(100);
  });

  it('converts solid clips to motion rectangle clips while keeping timeline identity', () => {
    const store = createTestTimelineStore();
    const clipId = store.getState().addSolidClip('video-1', 2, '#336699', 4, true);

    expect(clipId).toBeTruthy();
    const convertedId = store.getState().convertSolidToMotionShape(clipId!);
    const converted = store.getState().clips.find((clip) => clip.id === clipId);
    const fill = converted?.motion?.appearance?.items[0];

    expect(convertedId).toBe(clipId);
    expect(converted?.source?.type).toBe('motion-shape');
    expect(converted?.startTime).toBe(2);
    expect(converted?.duration).toBe(4);
    expect(converted?.motion?.shape?.primitive).toBe('rectangle');
    expect(fill?.kind).toBe('color-fill');
    if (fill?.kind === 'color-fill') {
      expect(fill.color.r).toBeCloseTo(0.2, 3);
      expect(fill.color.g).toBeCloseTo(0.4, 3);
      expect(fill.color.b).toBeCloseTo(0.6, 3);
    }
  });
});
