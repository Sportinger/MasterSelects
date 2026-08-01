import { describe, expect, it } from 'vitest';

import { buildLayerSyncMotionShape } from '../../src/components/timeline/utils/layerSyncMotionShape';
import type { Keyframe, TimelineClip } from '../../src/types';

function motionShapeClip(): TimelineClip {
  return {
    id: 'motion-shape-clip',
    trackId: 'video-1',
    name: 'Animated rectangle',
    file: new File([], 'shape.msmotion'),
    startTime: 0,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    source: { type: 'motion-shape', naturalDuration: 2 },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    motion: {
      version: 1,
      kind: 'shape',
      shape: { primitive: 'rectangle', size: { w: 320, h: 90 }, cornerRadius: 12 },
    },
  };
}

describe('paused-preview Motion Shape layer sync', () => {
  it('publishes a real motion source with clip identity and evaluated transform', () => {
    const clip = motionShapeClip();
    const keyframes: Keyframe[] = [{
      id: 'shape-width',
      clipId: clip.id,
      property: 'shape.size.w',
      time: 0,
      value: 320,
      easing: 'linear',
    }, {
      id: 'shape-width-end',
      clipId: clip.id,
      property: 'shape.size.w',
      time: 1,
      value: 480,
      easing: 'linear',
    }];

    const layer = buildLayerSyncMotionShape({
      clip,
      clipLocalTime: 0.5,
      effects: [],
      keyframes,
      layerIndex: 2,
      trackVisible: true,
      transform: {
        opacity: 0.75,
        blendMode: 'screen',
        position: { x: 0.25, y: -0.5, z: 0 },
        scale: { x: 1.5, y: 0.8 },
        rotation: { x: 0, y: 0, z: 90 },
      },
    });

    expect(layer).toMatchObject({
      id: 'timeline_layer_2',
      sourceClipId: clip.id,
      visible: true,
      opacity: 0.75,
      blendMode: 'screen',
      position: { x: 0.25, y: -0.5, z: 0 },
      scale: { x: 1.5, y: 0.8 },
    });
    expect(layer?.rotation).toMatchObject({ z: Math.PI / 2 });
    expect(layer?.source?.type).toBe('motion');
    expect(layer?.source?.motion?.kind).toBe('shape');
    expect(layer?.source?.motion?.shape?.size.w).toBe(400);
  });

  it('refuses non-motion and malformed motion clips', () => {
    const clip = motionShapeClip();
    const base = {
      clipLocalTime: 0,
      effects: [],
      keyframes: [],
      layerIndex: 0,
      trackVisible: true,
      transform: clip.transform,
    };

    expect(buildLayerSyncMotionShape({
      ...base,
      clip: { ...clip, source: { type: 'solid' } },
    })).toBeNull();
    expect(buildLayerSyncMotionShape({
      ...base,
      clip: { ...clip, motion: undefined },
    })).toBeNull();
  });
});
