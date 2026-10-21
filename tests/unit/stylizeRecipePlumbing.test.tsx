import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import StylizeRecipeNote from '../../src/effects/stylize/StylizeRecipeNote';
import { applyLookToClip, stackFromClipEffects } from '../../src/effects/looks/applyLook';
import { migratePersistedLooks } from '../../src/effects/looks/lookStore';
import type { LookDefinition } from '../../src/effects/looks/types';
import { handleUpdateEffect } from '../../src/services/aiTools/handlers/effects';
import { migrateLoadedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectDefinitionNotes } from '../../src/services/operators/effectParamVisibility';
import { createStylizeRecipeGraph, isEarlierStylizeGraph, STYLIZE_RECIPE_UPDATES } from '../../src/services/operators/stylizeRecipes';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); });

/** A stylize effect as loaded from a project saved before 2026-10-21 (graphless: the earlier recipe). */
const earlier = (type: string, params: Record<string, unknown> = {}): Effect =>
  migrateLoadedEffectOperatorGraph({ id: `${type}-saved`, name: type, type: type as Effect['type'], enabled: true, params: { ...getDefaultParams(type), ...params } as Effect['params'] });
const current = (type: string, params: Record<string, unknown> = {}): Effect =>
  ({ id: `${type}-new`, name: type, type: type as Effect['type'], enabled: true, params: { ...getDefaultParams(type), ...params } as Effect['params'], operatorGraph: createStylizeRecipeGraph(type) });
function withClip(effects: Effect[], keyframes: Keyframe[] = []) {
  const clip = createMockClip({ id: 'stylize-clip', effects });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map(keyframes.length ? [[clip.id, keyframes]] : []) });
  return clip.id;
}

describe('limit notes follow the recipe an effect runs', () => {
  it('gives an earlier Vignette or Scanlines no notes of the current recipe (they would report clamps that do not happen)', () => {
    expect(effectDefinitionNotes(current('vignette', { roundness: 1.5 }), 1920, 1080).join(' ')).toMatch(/used as 1/);
    expect(effectDefinitionNotes(earlier('vignette', { roundness: 1.5 }), 1920, 1080)).toEqual([]);
    expect(effectDefinitionNotes(current('scanlines', { opacity: 2, density: 12 }), 640, 360).length).toBeGreaterThan(0);
    expect(effectDefinitionNotes(earlier('scanlines', { opacity: 2, density: 12 }), 640, 360)).toEqual([]);
  });

  it('tells tools which version an earlier effect runs instead of a false clamp note', async () => {
    const clipId = withClip([earlier('vignette', { roundness: 1.5 }), earlier('scanlines'), current('vignette', { roundness: 1.5 })]);
    const update = async (effectId: string, params: Record<string, unknown>) =>
      ((await handleUpdateEffect({ clipId, effectId, params }, useTimelineStore.getState())).data as { warnings?: string[] }).warnings ?? [];
    const vignette = await update('vignette-saved', { amount: 0.6 });
    expect(vignette).toEqual([STYLIZE_RECIPE_UPDATES.vignette!.toolNote]);
    expect(vignette.join(' ')).not.toMatch(/used as 1/);
    expect(await update('scanlines-saved', { opacity: 1.5 })).toEqual([STYLIZE_RECIPE_UPDATES.scanlines!.toolNote]);
    expect((await update('vignette-new', { amount: 0.6 })).join(' ')).toMatch(/Roundness 1.5 is outside 0–1/);
  });
});

describe('Custom Looks keep the recipe their stylize effects were saved with', () => {
  it('records an earlier recipe, migrates Looks saved before recipes were recorded, and applies the earlier recipe again', () => {
    const stack = stackFromClipEffects([earlier('glow', { amount: 5, radius: 1 }), current('vignette'), { type: 'brightness', params: { amount: 0.2 } }]);
    expect(stack.map(entry => entry.recipe)).toEqual(['earlier', undefined, undefined]);

    const saved: LookDefinition = { id: 'custom-old', name: 'Old', category: 'custom', thumbnail: { kind: 'generated' }, tags: [], builtIn: false,
      stack: [{ effectId: 'glow', params: { amount: 5, radius: 1 }, enabled: true }, { effectId: 'posterize', params: { levels: 4 }, enabled: true },
        { effectId: 'brightness', params: {}, enabled: true }] };
    expect(migratePersistedLooks({ customLooks: [saved] }, 0).customLooks[0].stack.map(entry => entry.recipe)).toEqual(['earlier', undefined, undefined]);
    expect(migratePersistedLooks({ customLooks: [saved] }, 1).customLooks[0].stack.map(entry => entry.recipe)).toEqual([undefined, undefined, undefined]);

    const clipId = withClip([]);
    applyLookToClip({ ...saved, stack: [{ ...saved.stack[0], recipe: 'earlier' }, { effectId: 'vignette', params: { roundness: 0.5 }, enabled: true }] }, clipId);
    const [glow, vignette] = useTimelineStore.getState().clips[0].effects;
    expect(isEarlierStylizeGraph('glow', glow.operatorGraph)).toBe(true);
    expect(glow.params).toMatchObject({ amount: 5, radius: 1 });
    expect(isEarlierStylizeGraph('vignette', vignette.operatorGraph)).toBe(false);
  });
});

describe('Use the new … (StylizeRecipeNote)', () => {
  it('switches to the current recipe, resets the values and removes their keyframes (one history batch)', () => {
    const glow = earlier('glow', { amount: 5, radius: 2 });
    const keyframe = (time: number, value: number): Keyframe => ({ id: `k${time}`, clipId: 'stylize-clip', time, property: `effect.${glow.id}.radius`, value, easing: 'linear' } as Keyframe);
    const clipId = withClip([glow], [keyframe(0, 1), keyframe(1, 3)]);
    render(<StylizeRecipeNote clipId={clipId} effectInstanceId={glow.id} effectId="glow" params={glow.params} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: STYLIZE_RECIPE_UPDATES.glow!.label }));
    const state = useTimelineStore.getState(), updated = state.clips[0].effects[0];
    expect(isEarlierStylizeGraph('glow', updated.operatorGraph)).toBe(false);
    expect(updated.params).toMatchObject(STYLIZE_RECIPE_UPDATES.glow!.resetParams!);
    expect((state.clipKeyframes.get(clipId) ?? []).filter(item => item.property.endsWith('.radius'))).toEqual([]);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
