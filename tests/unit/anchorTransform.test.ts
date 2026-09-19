import { describe, expect, it } from 'vitest';

import { buildSceneWorldMatrix } from '../../src/engine/scene/SceneTransformUtils';
import { getInterpolatedClipTransform } from '../../src/utils/keyframeInterpolation';
import type { Keyframe } from '../../src/types/keyframes';
import type { ClipTransform } from '../../src/types/timelineCore';

function transformPoint(matrix: Float32Array, x: number, y: number, z: number) {
  return {
    x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  };
}

describe('anchor transforms', () => {
  it('maps the local anchor exactly onto the scene position', () => {
    const matrix = buildSceneWorldMatrix({
      position: { x: 4, y: -2, z: 7 },
      anchor: { x: 0.25, y: -0.5, z: 0.75 },
      rotationRadians: { x: 0.3, y: -0.7, z: 1.1 },
      rotationDegrees: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 3, z: 0.5 },
    });

    const point = transformPoint(matrix, 0.25, -0.5, 0.75);
    expect(point.x).toBeCloseTo(4, 5);
    expect(point.y).toBeCloseTo(-2, 5);
    expect(point.z).toBeCloseTo(7, 5);
  });

  it('interpolates all three anchor axes', () => {
    const base: ClipTransform = {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      anchor: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    const keyframes = [
      { id: 'x0', property: 'anchor.x', time: 0, value: 0, easing: 'linear' },
      { id: 'x1', property: 'anchor.x', time: 1, value: 1, easing: 'linear' },
      { id: 'y0', property: 'anchor.y', time: 0, value: 0, easing: 'linear' },
      { id: 'y1', property: 'anchor.y', time: 1, value: -1, easing: 'linear' },
      { id: 'z0', property: 'anchor.z', time: 0, value: 0, easing: 'linear' },
      { id: 'z1', property: 'anchor.z', time: 1, value: 0.5, easing: 'linear' },
    ] as Keyframe[];

    expect(getInterpolatedClipTransform(keyframes, 0.5, base).anchor).toEqual({
      x: 0.5,
      y: -0.5,
      z: 0.25,
    });
  });
});
