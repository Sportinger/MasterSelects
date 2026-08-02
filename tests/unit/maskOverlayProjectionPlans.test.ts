import { describe, expect, it } from 'vitest';
import {
  getLayerSourceSize,
  getProjectionParams,
  withClipProjectionTransform,
} from '../../src/components/preview/maskOverlay/maskOverlayProjectionPlans';
import { getMotionRenderSize } from '../../src/engine/motion/MotionTypes';
import { createDefaultMotionLayerDefinition } from '../../src/types/motionDesign';
import type { Layer } from '../../src/types/layers';
import type { ClipTransform } from '../../src/types/timelineCore';

function createLayer(): Layer {
  return {
    id: 'layer-1',
    name: 'Scaled video',
    sourceClipId: 'clip-1',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: {
      type: 'video',
      intrinsicWidth: 1920,
      intrinsicHeight: 1080,
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

function createTransform(): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0.12, y: -0.08, z: 0.25 },
    scale: { x: 0.5, y: 0.75, z: 2, all: 1.8 },
    rotation: { x: 10, y: -20, z: 45 },
  };
}

describe('maskOverlayProjectionPlans', () => {
  it('projects masks with the current clip transform including uniform scale', () => {
    const layer = createLayer();
    const projectionLayer = withClipProjectionTransform(layer, createTransform());
    const projectionParams = getProjectionParams(projectionLayer, 1280, 720);

    expect(projectionParams?.sourceWidth).toBe(1920);
    expect(projectionParams?.sourceHeight).toBe(1080);
    expect(projectionParams?.position).toEqual({ x: 0.12, y: -0.08, z: 0.25 });
    expect(projectionParams?.scale.x).toBeCloseTo(0.9);
    expect(projectionParams?.scale.y).toBeCloseTo(1.35);
    expect(projectionParams?.rotation).toEqual({
      x: (10 * Math.PI) / 180,
      y: (-20 * Math.PI) / 180,
      z: (45 * Math.PI) / 180,
    });
  });

  it('leaves the source layer unchanged when no clip transform is available', () => {
    const layer = createLayer();

    expect(withClipProjectionTransform(layer, undefined)).toBe(layer);
  });

  it('uses the motion render size, not the canvas, for motion shape layers', () => {
    const motion = createDefaultMotionLayerDefinition('shape');
    const layer: Layer = {
      ...createLayer(),
      source: { type: 'motion', motion },
    };

    const expected = getMotionRenderSize(motion);
    const sourceSize = getLayerSourceSize(layer, { width: 1280, height: 720 });

    expect(sourceSize).toEqual({ width: expected.width, height: expected.height });
    expect(sourceSize).not.toEqual({ width: 1280, height: 720 });
  });
});
