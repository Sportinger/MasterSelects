import { describe, expect, it } from 'vitest';
import {
  imageOperatorPreviewPrefix,
  imageOperatorPreviewStage,
  isImageOperatorTextureSignal,
  parseImageOperatorPreviewStage,
} from '../../src/services/nodePreview/imageOperatorPreviewStages';

describe('image operator preview stage contract', () => {
  it('round-trips effect, node and concrete port identity', () => {
    const target = { effectId: 'invert:one', nodeId: 'split/rgb', portId: 'alpha value', direction: 'output' as const };
    const stage = imageOperatorPreviewStage(target);
    expect(stage.startsWith(imageOperatorPreviewPrefix(target.effectId))).toBe(true);
    expect(parseImageOperatorPreviewStage(stage)).toEqual(target);
  });

  it('rejects unrelated and malformed stages', () => {
    expect(parseImageOperatorPreviewStage('effect:invert')).toBeUndefined();
    expect(parseImageOperatorPreviewStage('image-node:effect:node:side:port')).toBeUndefined();
    expect(parseImageOperatorPreviewStage('image-node:effect:node:output')).toBeUndefined();
  });

  it('routes every compiler-owned image/vector field but not geometry', () => {
    for (const signal of ['image', 'rgb', 'alpha', 'number', 'vec2', 'vec3', 'vec4']) {
      expect(isImageOperatorTextureSignal(`operator:${signal}`)).toBe(true);
    }
    expect(isImageOperatorTextureSignal('operator:geometry')).toBe(false);
  });
});
