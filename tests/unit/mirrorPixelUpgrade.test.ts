import { afterEach, describe, expect, it } from 'vitest';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { effectOperatorCompileContext, effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph } from '../../src/services/operators/imageOperatorGraph';
import { getDefaultEffectParams } from '../../src/stores/timeline/utils';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { packOperatorCompositions } from '../../src/services/operators/operatorComposition';
import { effectRecipeFingerprint } from '../../src/services/operators/recipeFingerprint';
import { isNeutralEffect } from '../../src/services/operators/neutralEffects';
import {
  createLegacyBlockifyGraph, createLegacyBlockMosaicGraph, createLegacyKaleidoscopeGraph, createLegacyMirrorGraph, createLegacyPixelateGraph,
  createLegacyRgbSplitGraph,
} from '../../src/services/operators/legacyMirrorPixelEffectGraphs';
import { createDefaultKaleidoscopeGraph, createDefaultMirrorGraph, createDefaultRgbSplitGraph } from '../../src/services/operators/mirrorRecipes';
import { createDefaultBlockifyGraph, createDefaultBlockMosaicGraph, createDefaultPixelateGraph } from '../../src/services/operators/cellGridRecipes';
import { getEffect } from '../../src/effects';
import { applyLookToClip } from '../../src/effects/looks/applyLook';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { createImagePassEvaluator } from '../helpers/imageGraphPasses';
import { buildEffectMaterializationFromRecipe } from '../../src/services/timeline/transitionCompositionRecipeTemplate';
import { kaleidoscope as kaleidoscopeTransition } from '../../src/transitions/kaleidoscope';

type Case = [Effect['type'], () => EffectOperatorGraph, () => EffectOperatorGraph, Record<string, number | boolean | string>, Record<string, number | string>];
const cases: Case[] = [
  ['kaleidoscope', createLegacyKaleidoscopeGraph, createDefaultKaleidoscopeGraph, { segments: 7, rotation: .4 }, { shape: 'frame', edges: 'clamp' }],
  ['mirror', createLegacyMirrorGraph, createDefaultMirrorGraph, { horizontal: true, vertical: true }, {}],
  ['rgb-split', createLegacyRgbSplitGraph, createDefaultRgbSplitGraph, { amount: .02, angle: 1.2 }, { edges: 'clamp' }],
  ['pixelate', createLegacyPixelateGraph, createDefaultPixelateGraph, { size: 10 }, {}],
  ['blockify', createLegacyBlockifyGraph, createDefaultBlockifyGraph, { scale: 16, amount: .75, angle: 0, colorA: '#111827', colorB: '#f8fafc' }, { levels: 8 }],
  ['block-mosaic', createLegacyBlockMosaicGraph, createDefaultBlockMosaicGraph, { scale: 22, amount: .75, angle: 0, colorA: '#111827', colorB: '#f8fafc', speed: 1 }, { grout: 1 }],
];

/** A graph as projects saved it: packed compositions, folders and a moved layout. */
function savedForm(graph: EffectOperatorGraph): EffectOperatorGraph {
  const packed = packOperatorCompositions(recognizeOperatorCompositions(graph));
  return { ...packed, effectPresentationRules: 1, groups: [...(packed.groups ?? []), { id: 'organized-all', label: 'All',
    color: '#6b99bd', nodeIds: packed.nodes.filter(node => node.id !== 'frame' && node.id !== 'output').map(node => node.id), collapsedByDefault: true }],
    layout: Object.fromEntries(packed.nodes.map(node => [node.id, { x: 11, y: 13 }])) };
}
const effect = (type: Effect['type'], params: Effect['params'], operatorGraph?: EffectOperatorGraph): Effect =>
  ({ id: `${type}-saved`, name: type, type, enabled: true, params, ...(operatorGraph ? { operatorGraph } : {}) });

afterEach(() => useTimelineStore.setState({ clips: [], tracks: [], isExporting: false }));

describe('saved mirror and pixel effects', () => {
  it('recognizes the shipped pre-review recipes by their frozen fingerprints', () => {
    // Computed from the recipes as they shipped; a changed legacy builder would stop recognizing saved graphs.
    expect(Object.fromEntries(cases.map(([type, legacy]) => [type, effectRecipeFingerprint(legacy())]))).toEqual({
      kaleidoscope: '1858ce40aeb7d7', mirror: '5de5aa829984a', 'rgb-split': '90f1099ea13f0', pixelate: 'b0fea7b32e5ba',
      blockify: '1adad3b9221ab6', 'block-mosaic': 'fa93b67cde71a',
    });
  });

  it.each(cases)('moves an untouched saved %s to the current recipe and fills the new controls that keep its look', (type, legacy, current, params, legacyParams) => {
    const migrated = migratePersistedEffectOperatorGraph(effect(type, { ...params }, savedForm(legacy())));
    expect(matchesEffectRecipe(migrated.operatorGraph!, current())).toBe(true);
    expect(migrated.params).toEqual({ ...params, ...legacyParams });
    const again = migratePersistedEffectOperatorGraph(migrated);
    expect(again.params).toEqual(migrated.params);
    expect(matchesEffectRecipe(again.operatorGraph!, current())).toBe(true);
  });

  it.each(cases)('keeps an edited saved %s graph and its parameters as the user left them', (type, legacy, _current, params) => {
    const edited = legacy();
    edited.nodes.push({ id: 'user-note', operator: 'math.sin.scalar', operatorVersion: 1, bindings: {} });
    const migrated = migratePersistedEffectOperatorGraph(effect(type, { ...params }, edited));
    expect(migrated.params).toEqual(params);
    expect(effectOperatorGraph(migrated).nodes.some(node => node.id === 'user-note')).toBe(true);
  });

  it.each(cases)('leaves a new %s (every default filled in) on its own values', (type, _legacy, current, params) => {
    const fresh = { ...getDefaultEffectParams(type), ...params };
    const migrated = migratePersistedEffectOperatorGraph(effect(type, fresh));
    expect(matchesEffectRecipe(migrated.operatorGraph!, current())).toBe(true);
    expect(migrated.params).toEqual(fresh);
  });

  it.each(cases)('gives a %s saved before effects owned a graph the values that keep its look', (type, _legacy, current, params, legacyParams) => {
    const migrated = migratePersistedEffectOperatorGraph(effect(type, { ...params }));
    expect(matchesEffectRecipe(migrated.operatorGraph!, current())).toBe(true);
    expect(migrated.params).toEqual({ ...params, ...legacyParams });
  });

  /** Read UV of a recipe: the source encodes UV in rgb, so the straight output is the position it read. */
  const readUv = (graph: EffectOperatorGraph, type: string, params: Record<string, unknown>, uv: [number, number]) => {
    const owner = { type, params }, plan = compileImageOperatorGraph(graph, effectOperatorParams(owner), effectOperatorCompileContext(owner));
    return createImagePassEvaluator(plan, [1920, 1080], ([u, v]) => [u, v, .3, 1])(uv).slice(0, 2);
  };

  it('renders an upgraded Kaleidoscope exactly like the shipped recipe for whole segment counts', () => {
    for (const params of [{ segments: 6, rotation: 0 }, { segments: 3, rotation: -2.2 }, { segments: 11, rotation: 5 }]) {
      const migrated = migratePersistedEffectOperatorGraph(effect('kaleidoscope', { ...params }, savedForm(createLegacyKaleidoscopeGraph())));
      for (const uv of [[.17, .73], [.9, .1], [.5, .5], [.02, .5]] as [number, number][]) {
        // The shipped recipe read past the frame through the clamp-to-edge sampler: the same as Frame Edges: Clamp.
        const before = readUv(createLegacyKaleidoscopeGraph(), 'kaleidoscope', params, uv).map(value => Math.min(1, Math.max(0, value)));
        const after = readUv(effectOperatorGraph(migrated), 'kaleidoscope', migrated.params, uv);
        expect(after[0]).toBeCloseTo(before[0], 9); expect(after[1]).toBeCloseTo(before[1], 9);
      }
    }
  });

  it('keeps horizontal and vertical RGB splits of saved projects at their length and direction', () => {
    for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      const params = { amount: .03, angle };
      const migrated = migratePersistedEffectOperatorGraph(effect('rgb-split', { ...params }, savedForm(createLegacyRgbSplitGraph())));
      const uv: [number, number] = [.4, .6];
      const before = readUv(createLegacyRgbSplitGraph(), 'rgb-split', params, uv), after = readUv(effectOperatorGraph(migrated), 'rgb-split', migrated.params, uv);
      // Red channel = u read at +offset; green = v read in place.
      expect(after[0]).toBeCloseTo(before[0], 9); expect(after[1]).toBeCloseTo(before[1], 9);
    }
  });

  it('gives a custom Look saved before the review the values that keep its look; built-in Looks get the new look', () => {
    const clip = createMockClip({ id: 'look-clip' });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const stack = [{ effectId: 'kaleidoscope', enabled: true, params: { segments: 8, rotation: 0 } }];
    applyLookToClip({ id: 'old', name: 'Old', category: 'editorial', tags: [], stack, builtIn: false, thumbnail: { kind: 'generated' } }, clip.id);
    applyLookToClip({ id: 'starter', name: 'Starter', category: 'editorial', tags: [], stack, builtIn: true, thumbnail: { kind: 'generated' } }, clip.id);
    const [custom, builtIn] = useTimelineStore.getState().clips[0].effects;
    expect(custom.params).toMatchObject({ segments: 8, shape: 'frame', edges: 'clamp' });
    expect(builtIn.params).toMatchObject({ segments: 8, shape: 'circle', edges: 'mirror' });
  });

  it('builds new transition effects with the new controls, so they look the same after a reload', () => {
    const { effects } = buildEffectMaterializationFromRecipe(kaleidoscopeTransition.recipe, 'outgoing', 'clip', 1);
    expect(effects[0].params).toMatchObject({ shape: 'circle', edges: 'mirror' });
    expect(migratePersistedEffectOperatorGraph(effects[0]).params).toMatchObject({ shape: 'circle', edges: 'mirror' });
  });
});

describe('neutral settings and reported values', () => {
  it('skips settings that return the picture unchanged, only for the built-in recipe', () => {
    const neutral = (type: string, params: Record<string, unknown>, operatorGraph?: EffectOperatorGraph) =>
      isNeutralEffect({ type, params: { ...getDefaultEffectParams(type), ...params }, operatorGraph }, 1920, 1080);
    expect(neutral('rgb-split', { amount: 0 })).toBe(true);
    expect(neutral('rgb-split', { amount: 0, mode: 'lens' })).toBe(true);
    expect(neutral('rgb-split', { amount: .001 })).toBe(false);
    expect(neutral('mirror', { horizontal: false, vertical: false })).toBe(true);
    expect(neutral('mirror', {})).toBe(false);
    expect(neutral('pixelate', { size: 1 })).toBe(true);
    expect(neutral('pixelate', { size: 2 })).toBe(false);
    expect(neutral('blockify', { amount: 0 })).toBe(true);
    expect(neutral('block-mosaic', { amount: -1 })).toBe(true);
    expect(neutral('kaleidoscope', {})).toBe(false);
    // A stored unedited copy still counts as the built-in recipe; an edited graph never does.
    expect(neutral('rgb-split', { amount: 0 }, savedForm(createDefaultRgbSplitGraph()))).toBe(true);
    const edited = createDefaultRgbSplitGraph();
    edited.nodes.push({ id: 'user-note', operator: 'math.sin.scalar', operatorVersion: 1, bindings: {} });
    expect(neutral('rgb-split', { amount: 0 }, edited)).toBe(false);
  });

  it('reports clamped or ignored values instead of failing silently', () => {
    const warnings = (type: string, params: Record<string, number | boolean | string>) => {
      const definition = getEffect(type)!;
      return 'paramWarnings' in definition && definition.paramWarnings ? definition.paramWarnings(params, 1920, 1080) : [];
    };
    expect(warnings('kaleidoscope', { segments: 0 })).toEqual([expect.stringContaining('uses 2')]);
    expect(warnings('kaleidoscope', { segments: 100, zoom: 0 })).toHaveLength(2);
    expect(warnings('kaleidoscope', { segments: 6, zoom: 1, edges: 'wrap' })).toEqual([expect.stringContaining('edges')]);
    expect(warnings('mirror', { horizontal: false, vertical: false })).toEqual([expect.stringContaining('unchanged')]);
    expect(warnings('mirror', { keep: 'middle' })).toEqual([expect.stringContaining('keep')]);
    expect(warnings('rgb-split', { mode: 'radial' })).toEqual([expect.stringContaining('mode')]);
    expect(warnings('pixelate', { size: .2 })).toEqual([expect.stringContaining('unchanged')]);
    expect(warnings('pixelate', { size: 12 })).toEqual([]);
    expect(warnings('blockify', { scale: 16, levels: 1, amount: 2 })).toHaveLength(2);
    expect(warnings('block-mosaic', { scale: 22, grout: -1, amount: .5 })).toEqual([expect.stringContaining('grout')]);
  });
});
