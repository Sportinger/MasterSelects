import { afterEach, describe, expect, it } from 'vitest';
import { lookEntryOriginalGraph, lookThumbnailEffects } from '../../src/effects/looks/lookStackEffects';
import { applyLookToClip } from '../../src/effects/looks/applyLook';
import { STARTER_LOOKS } from '../../src/effects/looks/starterLooks';
import type { LookDefinition } from '../../src/effects/looks/types';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { createLegacyCrtScreenGraph } from '../../src/services/operators/legacyCrtScreenGraph';
import { createLegacyHoloGraph } from '../../src/services/operators/legacyHoloGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { getDefaultParams, getEffect } from '../../src/effects';

const custom = (stack: LookDefinition['stack']): LookDefinition => ({ id: 'mine', name: 'Mine', category: 'custom', tags: [], builtIn: false,
  thumbnail: { kind: 'generated' }, stack });
// A custom Look saved before the 2026-10 analog rebuild: parameters only, none of the new recipe's.
const OLD_CRT = { effectId: 'crt-screen', params: { scale: 3, amount: .7 }, enabled: true };
const OLD_HOLO = { effectId: 'holo', params: { amount: .7, scale: 16 }, enabled: true };

afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map(), isExporting: false }));

describe('Look entries saved before the analog rebuild', () => {
  it('keep their original graph; new entries and built-in Looks follow the current recipe', () => {
    expect(matchesEffectRecipe(lookEntryOriginalGraph(custom([OLD_CRT]), OLD_CRT)!, createLegacyCrtScreenGraph())).toBe(true);
    expect(lookEntryOriginalGraph(custom([]), { effectId: 'crt-screen', params: { amount: .7, lineCount: 240 } })).toBeUndefined();
    expect(lookEntryOriginalGraph({ builtIn: true }, OLD_CRT)).toBeUndefined();
    expect(lookEntryOriginalGraph(custom([]), { effectId: 'gaussian-blur', params: { radius: 3 } })).toBeUndefined();
  });

  it('render their thumbnail with the same graph that applying them gives the clip', () => {
    const look = custom([OLD_CRT, OLD_HOLO, { effectId: 'glitch', params: { amount: .5, density: .3 }, enabled: true }]);
    const [crt, holo, glitch] = lookThumbnailEffects(look);
    expect(matchesEffectRecipe(crt.operatorGraph!, createLegacyCrtScreenGraph())).toBe(true);
    expect(matchesEffectRecipe(holo.operatorGraph!, createLegacyHoloGraph())).toBe(true);
    expect(glitch.operatorGraph).toBeUndefined();
    expect(crt.params).toMatchObject({ scale: 3, amount: .7 });

    const clip = createMockClip({ id: 'c', effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] } as never);
    applyLookToClip(look, 'c');
    const applied = useTimelineStore.getState().clips[0].effects;
    expect(matchesEffectRecipe(applied[0].operatorGraph!, crt.operatorGraph!)).toBe(true);
    expect(matchesEffectRecipe(applied[1].operatorGraph!, holo.operatorGraph!)).toBe(true);
    expect(applied[2].operatorGraph && matchesEffectRecipe(applied[2].operatorGraph, createLegacyCrtScreenGraph())).toBeFalsy();
  });

  it('carry no rebuilt-recipe parameters, so no note talks about controls their graph does not have', () => {
    // An old CRT Look on a 720 x 480 composition: the new recipe would warn about fine lines and mask stripes.
    const look = custom([OLD_CRT]);
    const [thumbnail] = lookThumbnailEffects(look);
    const clip = createMockClip({ id: 'c', effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] } as never);
    applyLookToClip(look, 'c');
    const [applied] = useTimelineStore.getState().clips[0].effects;
    const definition = getEffect('crt-screen')!;
    for (const params of [thumbnail.params, applied.params]) {
      expect(params).toMatchObject({ scale: 3, amount: .7 });
      expect(params).not.toHaveProperty('lineCount');
      expect(params).not.toHaveProperty('maskSize');
      expect('paramWarnings' in definition ? definition.paramWarnings?.(params as never, 720, 480) ?? [] : []).toEqual([]);
    }
    // A current CRT effect at that size does get the notes (the check above is not vacuous).
    const current = 'paramWarnings' in definition ? definition.paramWarnings?.({ ...getDefaultParams('crt-screen'), lineCount: 240, maskSize: .5 }, 720, 480) ?? [] : [];
    expect(current.length).toBeGreaterThan(0);
  });

  it('built-in analog Looks carry the new recipe parameters', () => {
    for (const look of STARTER_LOOKS) for (const entry of look.stack) expect(lookThumbnailEffects(look).every(effect => !effect.operatorGraph), `${look.id} ${entry.effectId}`).toBe(true);
  });
});
