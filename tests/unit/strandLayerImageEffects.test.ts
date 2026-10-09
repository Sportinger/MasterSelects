import { describe, expect, it, vi } from 'vitest';
import type { Effect, Layer, TimelineClip } from '../../src/types';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { TransformCache } from '../../src/services/layerBuilder/TransformCache';
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ clipKeyframes: new Map() }) } }));
vi.mock('../../src/services/layerBuilder/FrameContext', () => ({ getClipTimeInfo: () => ({ clipLocalTime: 3 }) }));
import { buildLayerBuilderStrandsLayers, buildStrandsOverlayLayers } from '../../src/services/layerBuilder/layerBuilderStrandsLayers';
import { strandPostProjectionEffects } from '../../src/services/operators/geometry/strandsLayerSource';
import { createWaveStrandsGraph } from '../../src/services/operators/geometry/weaveGraph';

const fx = (id: string, type = 'glow'): Effect => ({ id, type, name: id, enabled: true, params: { amount: 1 } });
const weave: Effect = { ...fx('weave', 'weave'), operatorGraph: createWaveStrandsGraph() };
const glow = fx('glow');
const clip = { id: 'clip', name: 'Yarn', startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
  effects: [weave, glow] } as TimelineClip;
const base: Layer = { id: 'base', name: 'Yarn', visible: true, opacity: .6, blendMode: 'normal',
  position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
  source: { type: 'solid', color: '#00000000' }, effects: [weave, glow] };

describe('generated strand image stacks', () => {
  it('keeps only enabled downstream image effects in their original order', () => {
    const before = fx('before'), disabled = { ...fx('disabled'), enabled: false }, detached = { ...fx('detached'), detached: true };
    const effects = [before, weave, glow, disabled, detached, fx('sound', 'audio-volume'), fx('second-weave', 'weave'), fx('flock', 'flocking'), fx('blur', 'gaussian-blur')];
    const snapshot = structuredClone(effects);
    expect(strandPostProjectionEffects(effects, weave.id).map(effect => effect.id)).toEqual(['glow', 'blur']);
    expect(strandPostProjectionEffects(effects, 'missing')).toEqual([]);
    expect(effects).toEqual(snapshot);
  });
  it('uses the interpolated preview stack at the same clip-local time as geometry', () => {
    const animated = { ...glow, params: { amount: 3.5 } };
    const getInterpolatedEffects = vi.fn(() => [weave, animated]);
    const ctx = { activeCompId: 'comp', getInterpolatedEffects, getInterpolatedTransform: () => base } as unknown as FrameContext;
    const transformCache = { getTransform: (_key: string, transform: unknown) => transform } as TransformCache;
    const result = buildLayerBuilderStrandsLayers({ clip, layerIndex: 1, ctx, transformCache });
    expect(getInterpolatedEffects).toHaveBeenCalledWith('clip', 3);
    expect(result).toHaveLength(1);
    expect(result[0].effects).toEqual([animated]);
    expect(result[0].opacity).toBe(.6);
  });
  it('retains sampled effects for nested and export overlays without altering the base layer', () => {
    const animated = { ...glow, params: { amount: 4.5 } };
    const layer = { ...base, effects: [weave, animated] };
    const result = buildStrandsOverlayLayers(layer, clip, 4, []);
    expect(result).toHaveLength(1);
    expect(result[0].effects).toEqual([animated]);
    expect(result[0].source?.type).toBe('strands');
    expect(layer.effects).toEqual([weave, animated]);
    expect(buildStrandsOverlayLayers(result[0], clip, 4, [])).toEqual([]);
  });
});
