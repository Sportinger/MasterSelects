import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { applyLookToClip, stackFromClipEffects } from '../../src/effects/looks/applyLook';
import { lookPreviewEffects } from '../../src/effects/looks/lookEntryGraph';
import type { LookDefinition } from '../../src/effects/looks/types';
import { effectOperatorGraph, migrateLoadedEffectOperatorGraph, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { effectDefinitionNotes } from '../../src/services/operators/effectParamVisibility';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { evaluateImagePasses } from '../helpers/imageGraphPasses';
import { createLegacyHalftoneGraph } from '../../src/services/operators/legacyHalftoneGraph';
import { createEarlierRisoGraph } from '../../src/services/operators/risoEffectGraphs';
import { createDefaultDitherGraph } from '../../src/services/operators/ditherEffectGraphs';
import { createEarlierPaperPrintGraph } from '../../src/services/operators/paperPrintEffectGraph';
import { createDefaultHalftoneGraph } from '../../src/services/operators/halftoneEffectGraphs';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

type Rgba = [number, number, number, number];
// A picture with fine detail, so pattern sizes and per-pixel tone show in the output.
const picture = ([u, v]: [number, number]): Rgba => [.5 + .5 * Math.sin(u * 91), .5 + .5 * Math.cos(v * 57), (u + v) / 2, 1];
const graphless = (type: string, params: Record<string, unknown>): Effect => ({ id: 'fx', name: type, type: type as Effect['type'], enabled: true, params: params as Effect['params'] });
const hasNode = (graph: EffectOperatorGraph | undefined, id: string) => graph?.nodes.some(node => node.id === id) ?? false;

function renderAt(graph: EffectOperatorGraph, params: Record<string, unknown>, resolution: [number, number], type?: string): number[] {
  const plan = compileImageOperatorGraph(graph, params as never, type ? { parameterSchema: getEffect(type)!.params } : undefined);
  const values: number[] = [];
  for (const [x, y] of [[101, 57], [1203, 640], [2900, 1700], [3333, 99]]) {
    const uv: [number, number] = [(x % resolution[0] + .5) / resolution[0], (y % resolution[1] + .5) / resolution[1]];
    values.push(...evaluateImagePasses(plan, uv, resolution, picture, { timelineTimeSeconds: .5 }));
  }
  return values;
}
const expectSameRender = (a: number[], b: number[]) => a.forEach((value, index) => expect(value).toBeCloseTo(b[index], 9));

const custom = (stack: LookDefinition['stack']): LookDefinition => ({ id: 'mine', name: 'Mine', category: 'custom', tags: [], builtIn: false,
  thumbnail: { kind: 'generated' }, stack });

afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map(), isExporting: false }));

describe('print looks saved before the 2026-10-22 print review', () => {
  it('a graph-less 3.2.7 Halftone from a project file renders exactly the 3.2.7 graph, also at 4K', () => {
    for (const type of ['halftone', 'pattern-halftone'] as const) {
      const params = { scale: 12, angle: 30, amount: .8, colorA: '#101010', colorB: '#f4ecd8' };
      const loaded = migrateLoadedEffectOperatorGraph(graphless(type, params));
      expect(matchesEffectRecipe(loaded.operatorGraph!, createLegacyHalftoneGraph(type))).toBe(true);
      expect(hasNode(loaded.operatorGraph, 'frame-scale')).toBe(false);
      const merged = { ...getDefaultParams(type), ...loaded.params };
      expectSameRender(renderAt(loaded.operatorGraph!, merged, [3840, 2160], type), renderAt(createLegacyHalftoneGraph(type), merged, [3840, 2160], type));
      // The check is not vacuous: the current recipe draws something else there.
      expect(renderAt(createDefaultHalftoneGraph(type), merged, [3840, 2160], type)).not.toEqual(renderAt(createLegacyHalftoneGraph(type), merged, [3840, 2160], type));
    }
  });

  it.each([
    ['riso', { scale: 8, amount: .75, angle: 0, colorA: '#2046b3', colorB: '#ef476f' }, () => createEarlierRisoGraph('riso')],
    ['riso-glow', { scale: 8, amount: .75, angle: 0, speed: 1, colorA: '#2046b3', colorB: '#ef476f' }, () => createEarlierRisoGraph('riso-glow')],
    ['dither', { scale: 3, amount: .75, angle: 0, colorA: '#000000', colorB: '#ffffff' }, () => createDefaultDitherGraph('dither')],
    ['paper-print', { scale: 6, amount: .8, angle: 0, colorA: '#1c1917', colorB: '#f5f0e6' }, createEarlierPaperPrintGraph],
  ] as const)('a graph-less 3.2.7 %s keeps its earlier recipe in output pixels at 4K, from a project file and any other persisted entry', (type, params, earlier) => {
    for (const migrate of [migrateLoadedEffectOperatorGraph, migratePersistedEffectOperatorGraph]) {
      const loaded = migrate(graphless(type, params));
      expect(matchesEffectRecipe(loaded.operatorGraph!, earlier())).toBe(true);
      // Exactly as 3.2.7 drew it: no 1080p measure in the earlier recipe.
      expect(hasNode(loaded.operatorGraph, 'frame-scale')).toBe(false);
      expectSameRender(renderAt(loaded.operatorGraph!, loaded.params, [3840, 2160]), renderAt(earlier(), loaded.params, [3840, 2160]));
    }
  });

  it('a stored graph stays as saved, and a graph-less look in the running editor is the current recipe', () => {
    const saved = createLegacyHalftoneGraph('halftone');
    const loaded = migrateLoadedEffectOperatorGraph({ ...graphless('halftone', getDefaultParams('halftone')), operatorGraph: saved });
    expect(matchesEffectRecipe(loaded.operatorGraph!, saved)).toBe(true);
    // S1's untouched-graph check asks for the recipe with no parameters: it must be the current one.
    for (const type of ['riso', 'riso-glow', 'dither', 'paper-print', 'halftone']) {
      const current = effectOperatorGraph(graphless(type, getDefaultParams(type)));
      expect(effectOperatorGraph(graphless(type, {})).nodes.map(node => node.id), type).toEqual(current.nodes.map(node => node.id));
    }
    expect(hasNode(effectOperatorGraph(graphless('riso', {})), 'dark-share')).toBe(true);
  });

  it('a custom Look entry saved without a graph keeps the 3.2.7 graph in its thumbnail and on the clip, without the new controls', () => {
    const oldRiso = { effectId: 'riso', params: { scale: 8, amount: .75, colorA: '#2046b3', colorB: '#ef476f' }, enabled: true };
    const oldHalftone = { effectId: 'halftone', params: { scale: 14, angle: 45, amount: 1 }, enabled: true };
    const look = custom([oldRiso, oldHalftone]);
    const [riso, halftone] = lookPreviewEffects(look);
    expect(matchesEffectRecipe(riso.operatorGraph!, createEarlierRisoGraph('riso'))).toBe(true);
    expect(matchesEffectRecipe(halftone.operatorGraph!, createLegacyHalftoneGraph('halftone'))).toBe(true);
    expect(riso.params).not.toHaveProperty('dotSize');

    const clip = createMockClip({ id: 'c', effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] } as never);
    applyLookToClip(look, 'c');
    const [appliedRiso, appliedHalftone] = useTimelineStore.getState().clips[0].effects;
    expect(matchesEffectRecipe(appliedRiso.operatorGraph!, riso.operatorGraph!)).toBe(true);
    expect(matchesEffectRecipe(appliedHalftone.operatorGraph!, halftone.operatorGraph!)).toBe(true);
    expect(appliedRiso.params).not.toHaveProperty('dotSize');
    expect(getEffect('riso')!.paramWarnings?.(appliedRiso.params as never).join(' ')).toMatch(/saved before Dot Size/);
    // Built-in Looks follow the current recipe.
    expect(lookPreviewEffects({ ...look, builtIn: true })[0].operatorGraph).toBeUndefined();
  });

  it('an earlier graph draws in output pixels, so it gets no 1080p size notes', () => {
    // A 3.2.7 Dithering without Levels at 1280x720, Pixel Size 4: it renders 4 output pixels.
    const oldDither = { type: 'dither', params: { scale: 4, angle: 0, amount: .75 }, operatorGraph: createDefaultDitherGraph('dither') };
    expect(effectDefinitionNotes(oldDither, 1280, 720).join(' ')).toMatch(/saved before Levels/);
    expect(effectDefinitionNotes(oldDither, 1280, 720).join(' ')).not.toMatch(/renders 3|pixels on this/);
    // A stored 3.2.7 Halftone at 640x360 with Dot Size 2 renders 2 output pixels, not "thinner than one pixel".
    const oldHalftone = { type: 'halftone', params: { ...getDefaultParams('halftone'), scale: 2 }, operatorGraph: createLegacyHalftoneGraph('halftone') };
    expect(effectDefinitionNotes(oldHalftone, 640, 360).join(' ')).not.toMatch(/thinner than one pixel/);
    // The current recipe measures in 1080p pixels and still says so.
    expect(effectDefinitionNotes({ type: 'halftone', params: { ...getDefaultParams('halftone'), scale: 2 } }, 640, 360).join(' ')).toMatch(/thinner than one pixel/);
    expect(effectDefinitionNotes({ type: 'dither', params: { ...getDefaultParams('dither'), scale: 4 } }, 1280, 720).join(' ')).toMatch(/renders 3/);
  });

  it('a Look saved from a reopened project stores no known print recipe, only edited graphs, and stays a few KB', () => {
    const types = ['halftone', 'riso', 'dither', 'paper-print', 'riso-glow'];
    // A project save stores every print look's graph and a load keeps it (migratePersisted/migrateLoadedEffectOperatorGraph).
    const loaded = types.map(type => migrateLoadedEffectOperatorGraph(migratePersistedEffectOperatorGraph({ ...graphless(type, getDefaultParams(type)), id: type })));
    loaded.forEach(effect => expect(effect.operatorGraph).toBeDefined());
    const stack = stackFromClipEffects(loaded as never);
    stack.forEach((entry) => {
      expect(entry.operatorGraph).toBeUndefined();
      expect(entry.recipe).toBe('current');
      expect(JSON.stringify(entry).length).toBeLessThan(4096);
    });
    lookPreviewEffects(custom(stack)).forEach((effect, index) => {
      expect(matchesEffectRecipe(effectOperatorGraph(effect), effectOperatorGraph(loaded[index]))).toBe(true);
    });
    // The 3.2.7 graph is rebuilt from an unmarked graph-less entry.
    const [earlier] = stackFromClipEffects([{ type: 'riso', params: getDefaultParams('riso'), operatorGraph: createEarlierRisoGraph('riso') }]);
    expect(earlier.operatorGraph).toBeUndefined();
    expect(earlier.recipe).toBeUndefined();
    expect(matchesEffectRecipe(lookPreviewEffects(custom([earlier]))[0].operatorGraph!, createEarlierRisoGraph('riso'))).toBe(true);
    // An edited graph is stored, so the entry keeps the look it was saved with.
    const current = createDefaultHalftoneGraph('halftone');
    const edited = { ...current, nodes: current.nodes.map(node => node.id === 'own-weight' ? { ...node, constants: { value: 0.123 } } : node) };
    const [kept] = stackFromClipEffects([{ type: 'halftone', params: getDefaultParams('halftone'), operatorGraph: edited }]);
    expect(kept.operatorGraph && matchesEffectRecipe(kept.operatorGraph, edited)).toBe(true);
  });

  it('a Look saved from freshly added print looks (no graph yet) previews and applies their current recipe', () => {
    const types = ['halftone', 'riso', 'dither', 'paper-print', 'riso-glow'];
    const clip = createMockClip({ id: 'fresh', effects: [] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] } as never);
    for (const type of types) useTimelineStore.getState().addClipEffect('fresh', type);
    const fresh = useTimelineStore.getState().clips[0].effects;
    const stack = stackFromClipEffects(fresh as never);
    expect(stack.map(entry => entry.recipe)).toEqual(types.map(() => 'current'));
    const look = custom(stack);
    // The preview renders what the clip showed: no 3.2.7 graph, the current recipe with its 1080p measure.
    lookPreviewEffects(look).forEach((effect, index) => {
      expect(effect.operatorGraph).toBeUndefined();
      const shown = effectOperatorGraph(fresh[index] as Effect), previewed = effectOperatorGraph(effect);
      expect(matchesEffectRecipe(previewed, shown)).toBe(true);
      expect(hasNode(previewed, 'frame-scale')).toBe(true);
    });
    // Applying it gives effects that render like the originals and carry every current control.
    const target = createMockClip({ id: 'target', effects: [] });
    useTimelineStore.setState({ clips: [target], tracks: [createMockTrack({ id: target.trackId })] } as never);
    applyLookToClip(look, 'target');
    const applied = useTimelineStore.getState().clips[0].effects;
    applied.forEach((effect, index) => {
      expect(matchesEffectRecipe(effectOperatorGraph(effect), effectOperatorGraph(fresh[index] as Effect))).toBe(true);
      expect(getEffect(effect.type)!.paramWarnings?.(effect.params as never).join(' ') ?? '').not.toMatch(/saved before/);
    });
    expect(applied[1].params).toHaveProperty('dotSize');
  });
});
