import { describe, expect, it, vi } from 'vitest';
import type { ClipMask, Layer, TimelineClip } from '../../src/types';
import type { Keyframe } from '../../src/types/keyframes';
vi.mock('../../src/services/nodeGraph', () => ({ renderClipAINodesToCanvas: vi.fn() }));
import { addLayerBuilderMaskProperties, applyLayerBuilderMaskEditPreview } from '../../src/services/layerBuilder/layerBuilderLayerPostProcessing';

const mask: ClipMask = { id: 'protection', name: 'Protection', vertices: [], closed: true,
  opacity: 1, feather: 0, featherQuality: 50, inverted: false, mode: 'add', expanded: false,
  position: { x: 0, y: 0 }, enabled: true, visible: true, compositeEnabled: false };

describe('effect mask frame context', () => {
  it('feeds dragged geometry to effects without modifying cached layers or other clips', () => {
    const cached = { sourceClipId: 'clip', masks: [mask] } as Layer;
    const other = { sourceClipId: 'other', masks: [mask] } as Layer;
    const layers = [cached, other];
    const dragged = { ...mask, position: { x: 0.25, y: -0.1 } };
    const preview = { ownerId: 'drag', clipId: 'clip', mask: dragged };

    const rendered = applyLayerBuilderMaskEditPreview(layers, preview);
    expect(rendered[0].masks?.[0]).toBe(dragged);
    expect(rendered[1]).toBe(other);
    expect(cached.masks?.[0].position).toEqual({ x: 0, y: 0 });
    expect(applyLayerBuilderMaskEditPreview(layers, null)).toBe(layers);

    const next = applyLayerBuilderMaskEditPreview(layers, {
      ...preview, mask: { ...dragged, position: { x: 0.5, y: 0.2 } },
    });
    expect(next[0].masks?.[0].position.x).toBe(0.5);
    expect(rendered[0].masks?.[0].position.x).toBe(0.25);
  });

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
