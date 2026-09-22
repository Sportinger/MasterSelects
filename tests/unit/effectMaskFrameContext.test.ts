import { describe, expect, it, vi } from 'vitest';
import type { ClipMask, Layer, TimelineClip } from '../../src/types';
import type { Keyframe } from '../../src/types/keyframes';
vi.mock('../../src/services/nodeGraph', () => ({ renderClipAINodesToCanvas: vi.fn() }));
import { addLayerBuilderMaskProperties } from '../../src/services/layerBuilder/layerBuilderLayerPostProcessing';

const mask: ClipMask = { id: 'protection', name: 'Protection', vertices: [], closed: true,
  opacity: 1, feather: 0, featherQuality: 50, inverted: false, mode: 'add', expanded: false,
  position: { x: 0, y: 0 }, enabled: true, visible: true, compositeEnabled: false };

describe('effect mask frame context', () => {
  it('passes animated effect-only masks as an immutable frame snapshot', () => {
    const layer = {} as Layer;
    const clip = { id: 'clip', masks: [mask] } as TimelineClip;
    const keys = [0, 1].map((time): Keyframe => ({ id: `key-${time}`, clipId: 'clip', time,
      property: 'mask.protection.position.x', value: time, easing: 'linear' }));
    addLayerBuilderMaskProperties(layer, clip, 0.5, keys);
    expect(layer.masks?.[0].position.x).toBeCloseTo(0.5);
    expect(layer.masks?.[0].compositeEnabled).toBe(false);
    expect(mask.position.x).toBe(0);
    expect(layer.masks?.[0]).not.toBe(mask);
  });

  it('preserves transition-mapped masks instead of reevaluating them in the wrong time domain', () => {
    const mapped = [{ ...mask, position: { x: 0.7, y: 0 } }];
    const layer = { masks: mapped } as Layer;
    addLayerBuilderMaskProperties(layer, { id: 'clip', masks: [mask] } as TimelineClip, 0);
    expect(layer.masks).toBe(mapped);
  });
});
