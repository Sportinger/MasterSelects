import { afterEach, describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import { useTimelineStore } from '../../src/stores/timeline';
import { hasFlockGraph, rendersFlock } from '../../src/services/flock/flockEffect';
import { flockMenuOperators } from '../../src/services/flock/flockMenuOperators';
import { operatorCategoryId } from '../../src/services/operators/operatorTaxonomy';
import { splitLayerEffects } from '../../src/engine/render/layerEffectStack';
import { buildFlockLayerSource } from '../../src/services/layerBuilder/layerBuilderFlockLayers';
import { restoredFlockDefinitionOf, withPersistedFlockingEffect } from '../../src/stores/timeline/serialization/flockDefinitionRestore';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const flocking = (patch: Partial<Effect> = {}): Effect => ({ id: 'fx', name: 'Flocking', type: 'flocking', enabled: true, params: {}, ...patch });

afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map(), isExporting: false }));

describe('Flocking effect', () => {
  it('renders the swarm of any clip whose Flocking effect is enabled and attached', () => {
    const flock = createFlockPresetDefinition();
    const image = createMockClip({ id: 'img', flock, effects: [flocking()] });
    expect(hasFlockGraph(image)).toBe(true);
    expect(rendersFlock(image)).toBe(true);
    expect(rendersFlock({ ...image, effects: [flocking({ enabled: false })] })).toBe(false);
    expect(rendersFlock({ ...image, effects: [flocking({ enabled: false, detached: true })] })).toBe(false);
    expect(hasFlockGraph({ ...image, effects: [] })).toBe(false);
    // Legacy flock hosts without the entry keep rendering until migrated.
    expect(rendersFlock({ ...image, effects: [], source: { type: 'flock' } })).toBe(true);
    expect(buildFlockLayerSource(image, 1, [], 'preview')?.flock?.clipId).toBe('img');
    expect(buildFlockLayerSource({ ...image, effects: [flocking({ enabled: false })] }, 1, [], 'preview')).toBeNull();
  });

  it('never touches the clip image in the 2D effect stack', () => {
    const stack = splitLayerEffects([flocking(), { id: 'b', name: 'Blur', type: 'gaussian-blur', enabled: true, params: {} }]);
    expect(stack.complexEffects?.map(effect => effect.type) ?? []).not.toContain('flocking');
    expect(splitLayerEffects([flocking()]).complexEffects).toBeUndefined();
  });

  it('creates one swarm per clip and removes its graph and keyframes with the effect', () => {
    const clip = createMockClip({ id: 'c', effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })],
      clipKeyframes: new Map([['c', [{ id: 'k', clipId: 'c', property: 'flock.node.rules.cohesion', time: 0, value: 1, easing: 'linear' }]]]) } as never);
    const id = useTimelineStore.getState().addClipEffect('c', 'flocking');
    expect(useTimelineStore.getState().addClipEffect('c', 'flocking')).toBe(id);
    const withEffect = useTimelineStore.getState().clips[0];
    expect(withEffect.effects.filter(effect => effect.type === 'flocking')).toHaveLength(1);
    expect(withEffect.flock?.nodes.length).toBeGreaterThan(0);
    useTimelineStore.getState().removeClipEffect('c', id);
    expect(useTimelineStore.getState().clips[0].flock).toBeUndefined();
    expect(useTimelineStore.getState().clipKeyframes.get('c')).toBeUndefined();
  });

  it('migrates legacy flock clips and restores the definition of any clip carrying the effect', () => {
    const flock = createFlockPresetDefinition();
    const legacy = withPersistedFlockingEffect({ id: 'old', sourceType: 'flock', flock, effects: [] });
    expect(legacy.effects).toEqual([expect.objectContaining({ id: 'old-flocking', type: 'flocking', enabled: true })]);
    expect(withPersistedFlockingEffect(legacy)).toBe(legacy);
    expect(restoredFlockDefinitionOf({ id: 'v', sourceType: 'video', flock, effects: [flocking()] })?.nodes).toHaveLength(flock.nodes.length);
    expect(restoredFlockDefinitionOf({ id: 'v', sourceType: 'video', flock, effects: [] })).toBeUndefined();
  });

  it('files every swarm node under a shared node category', () => {
    const operators = flockMenuOperators();
    expect(operators.length).toBeGreaterThan(30);
    for (const operator of operators) expect(operatorCategoryId(operator), operator.id).toBeDefined();
    expect(operatorCategoryId({ id: 'flock.emitter' })).toBe('particles');
    expect(operatorCategoryId({ id: 'flock.vortex' })).toBe('forces');
    expect(operatorCategoryId({ id: 'flock.render-points' })).toBe('output');
  });
});
