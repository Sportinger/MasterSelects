// Typed values of an effect control may go past its slider up to its render range (EffectParam.renderMin and
// renderMax), as the card's typed field allows: the Keyframe node, the agent's keyframe tool (property
// authoring) and the Nodes-tab value (setOperatorParameter) use that range, and a cyclic control (wraps) none.
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { setAnimatedOperatorParameter } from '../../src/services/operators/effectGraphEditing';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { propertyRegistry } from '../../src/services/properties';
import { validatePropertyAuthoringValue } from '../../src/services/properties/propertyAuthoring';
import { keyframeNodeParameters } from '../../src/services/nodeGraph/keyframeNodeParameters';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
const effect = (type: string): Effect => migratePersistedEffectOperatorGraph({ id: `${type}-fx`, name: type, type: type as Effect['type'], enabled: true, params: getDefaultParams(type) });

describe('render range on every typed write path', () => {
  it('Temperature (slider -1..1, render -4..4) takes 3 everywhere and stops past 4', () => {
    const definition = getEffect('temperature')!.params.temperature;
    expect([definition.min, definition.max, definition.renderMin, definition.renderMax]).toEqual([-1, 1, -4, 4]);
    const fx = effect('temperature'), clip = createMockClip({ id: 'range-clip', effects: [fx] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const path = `effect.${fx.id}.temperature`;
    const descriptor = propertyRegistry.getAllDescriptors(clip).find(item => item.path === path)!;
    expect(descriptor.ui).toMatchObject({ min: -1, max: 1, renderMin: -4, renderMax: 4 });
    expect(validatePropertyAuthoringValue(descriptor, 3)).toBe(3);
    expect(validatePropertyAuthoringValue(descriptor, -3.5)).toBe(-3.5);
    expect(() => validatePropertyAuthoringValue(descriptor, 4.5)).toThrow('must be at most 4');
    // The Keyframe node's slider stays one slider range; its typed keys go to the render range.
    expect(keyframeNodeParameters(clip).find(item => item.property === path)).toMatchObject({ min: -1, max: 1, hardMin: -4, hardMax: 4 });
    setAnimatedOperatorParameter(clip.id, fx.id, 'temperature', 'value', 3);
    expect(useTimelineStore.getState().clips[0].effects[0].params.temperature).toBe(3);
    expect(() => setAnimatedOperatorParameter(clip.id, fx.id, 'temperature', 'value', 5)).toThrow('outside its supported range');
  });

  it('a cyclic control (Hue Shift) has no typed limit in the Keyframe node, a control without a render range keeps its slider limits', () => {
    const hue = effect('hue-shift'), opacityClip = createMockClip({ id: 'hue-clip', effects: [hue] });
    const parameters = keyframeNodeParameters(opacityClip);
    const shift = parameters.find(item => item.property === `effect.${hue.id}.shift`)!;
    expect(shift.wraps).toBe(true);
    expect(shift.hardMin).toBeUndefined();
    expect(shift.hardMax).toBeUndefined();
    expect(parameters.find(item => item.property === 'opacity')).toMatchObject({ min: 0, max: 1, hardMin: 0, hardMax: 1 });
  });
});
