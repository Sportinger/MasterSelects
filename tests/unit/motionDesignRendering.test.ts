import { describe, expect, it } from 'vitest';
import type { ClipTransform, Keyframe, TimelineClip } from '../../src/types';
import {
  createDefaultMotionLayerDefinition,
  createStrokeAppearance,
} from '../../src/types/motionDesign';
import { createMotionInstanceArray, createMotionUniformArray } from '../../src/engine/motion/MotionBuffers';
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

    expect(getMotionRenderSize(motion)).toMatchObject({
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

  it('sizes and packs grid replicator instances for motion shapes', () => {
    const motion = createDefaultMotionLayerDefinition('shape', {
      size: { w: 100, h: 50 },
    });
    if (motion.replicator?.layout.mode === 'grid') {
      motion.replicator.enabled = true;
      motion.replicator.layout.count = { x: 3, y: 2 };
      motion.replicator.layout.spacing = { x: 50, y: 80 };
      motion.replicator.offset.opacity = 0.75;
    }

    const size = getMotionRenderSize(motion);
    const instances = createMotionInstanceArray(size);

    expect(size).toMatchObject({
      width: 200,
      height: 130,
      replicator: {
        enabled: true,
        countX: 3,
        countY: 2,
        spacingX: 50,
        spacingY: 80,
        instanceCount: 6,
      },
    });
    expect(Array.from(instances)).toEqual([
      -50, -40, 1, 0,
      0, -40, 0.75, 0,
      50, -40, 0.5625, 0,
      -50, 40, 0.421875, 0,
      0, 40, 0.31640625, 0,
      50, 40, 0.2373046875, 0,
    ]);
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

  it('adds rectangle and ellipse motion shape clips only on video tracks', () => {
    const store = createTestTimelineStore();
    const rectangleId = store.getState().addMotionShapeClip('video-1', 1, {
      primitive: 'rectangle',
      duration: 3,
      size: { w: 320, h: 180 },
      name: 'Motion Rectangle',
    });
    const ellipseId = store.getState().addMotionShapeClip('video-1', 4, {
      primitive: 'ellipse',
      duration: 2,
      name: 'Motion Ellipse',
    });
    const invalidId = store.getState().addMotionShapeClip('audio-1', 0, {
      primitive: 'rectangle',
    });

    const rectangle = store.getState().clips.find((clip) => clip.id === rectangleId);
    const ellipse = store.getState().clips.find((clip) => clip.id === ellipseId);

    expect(rectangleId).toBeTruthy();
    expect(ellipseId).toBeTruthy();
    expect(invalidId).toBeNull();
    expect(rectangle?.source?.type).toBe('motion-shape');
    expect(rectangle?.motion?.shape?.primitive).toBe('rectangle');
    expect(rectangle?.motion?.shape?.size).toEqual({ w: 320, h: 180 });
    expect(rectangle?.startTime).toBe(1);
    expect(rectangle?.duration).toBe(3);
    expect(ellipse?.name).toBe('Motion Ellipse');
    expect(ellipse?.motion?.shape?.primitive).toBe('ellipse');
    expect(store.getState().clips).toHaveLength(2);
  });
});
