import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { applyLookToClip, stackFromClipEffects } from '../../src/effects/looks/applyLook';
import { useLookStore } from '../../src/effects/looks/lookStore';
import { LOOK_SCHEMA_VERSION, type LookDefinition } from '../../src/effects/looks/types';
import { getMotionAdjustmentDiagnostics } from '../../src/components/panels/properties/motionAdjustmentDiagnostics';
import { COLOR_RECIPE_EFFECT_TYPES, createDefaultColorEffectGraph, type EditableColorEffectType } from '../../src/services/operators/colorEffectGraphs';
import { matchesEffectRecipe } from '../../src/services/operators/effectFamilyPresentation';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { createLegacyColorEffectGraph } from '../../src/services/operators/legacyColorEffectGraphs';
import { ADJUSTMENT_COLOR_RECIPE_UNSUPPORTED, workerGpuAdjustmentColorDivergences } from '../../src/services/render/workerGpuAdjustmentColorParity';
import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';
import type { ProjectComposition } from '../../src/services/project/types/composition.types';
import type { ProjectClip } from '../../src/services/project/types';
import { useTimelineStore } from '../../src/stores/timeline';
import { summarizeClipEffectGraphs } from '../../src/services/aiTools/handlers/clips/effectGraphSummary';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';
import { createMockClip, createMockTrack } from '../helpers/mockData';

/**
 * Saved work keeps the color math it was made with (2026-10 color rebuild): projects saved before
 * effect graphs existed, custom Looks saved before the rebuild and the Node Workspace folders of
 * saved original graphs. References below are the original formulas written out by hand.
 */
const PIXEL = [0.5, 0.3, 0.2, 1] as const;
function hsvRotate([r, g, b]: readonly number[], turns: number): number[] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (((hue / 6 + turns) % 1) + 1) % 1;
  const s = max === 0 ? 0 : delta / max, k = (n: number) => (n + hue * 6) % 6;
  return [5, 3, 1].map(n => max - max * s * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
}
const ORIGINAL: [EditableColorEffectType, Record<string, number>, number[]][] = [
  ['brightness', { amount: -1 }, [0, 0, 0]],
  ['brightness', { amount: 0.3 }, [0.8, 0.6, 0.5]],
  ['exposure', { exposure: 1 }, [1, 0.6, 0.4]],
  ['contrast', { amount: 2 }, [0.5, 0.1, 0]],
  ['hue-shift', { shift: 0.25 }, hsvRotate(PIXEL, 0.25)],
  ['saturation', { amount: 0 }, Array(3).fill(0.299 * 0.5 + 0.587 * 0.3 + 0.114 * 0.2)],
];

function render(effect: Effect): number[] {
  return evaluateImageOperatorPlan(compileImageOperatorGraph(effectOperatorGraph(effect), effectOperatorParams(effect)), [...PIXEL]);
}
function expectRgb(actual: number[], expected: number[]) {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 4));
}
function projectComposition(effects: ProjectClip['effects']): ProjectComposition {
  const clip = {
    id: 'clip-1', trackId: 'video-1', name: 'Plate', mediaId: 'media-1', sourceType: 'video', naturalDuration: 4,
    startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
    transform: { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, rotation: 0, rotationX: 0, rotationY: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1, blendMode: 'normal' },
    effects, masks: [], keyframes: [], volume: 1, audioEnabled: true, reversed: false, disabled: false,
  } as ProjectClip;
  return { id: 'comp-1', name: 'Comp', width: 1920, height: 1080, frameRate: 25, duration: 4, backgroundColor: '#000000', folderId: null,
    tracks: [{ id: 'video-1', name: 'Video 1', type: 'video', height: 60, locked: false, visible: true, muted: false, solo: false }],
    clips: [clip], markers: [] };
}
const loadedEffects = (effects: ProjectClip['effects']) => convertProjectCompositionToStore([projectComposition(effects)])[0].timelineData!.clips[0].effects as Effect[];
const savedEffect = (type: EditableColorEffectType, params: Record<string, number>, operatorGraph?: Effect['operatorGraph']) =>
  ({ id: `${type}-fx`, name: type, type, enabled: true, params: { ...getDefaultParams(type), ...params }, ...(operatorGraph ? { operatorGraph } : {}) });

const initialTimeline = useTimelineStore.getState();
const initialLooks = useLookStore.getState();
beforeEach(() => {
  useTimelineStore.setState({ clips: [createMockClip({ id: 'clip-look', trackId: 't' })], tracks: [createMockTrack({ id: 't' })], clipKeyframes: new Map() });
});
afterEach(() => { useTimelineStore.setState(initialTimeline); useLookStore.setState(initialLooks); });

describe('saved color effects keep their look', () => {
  it.each(ORIGINAL)('a project saved without effect graphs renders %s %j with the original math', (type, params, expected) => {
    const [loaded] = loadedEffects([savedEffect(type, params)]);
    expect(matchesEffectRecipe(loaded.operatorGraph!, createLegacyColorEffectGraph(type))).toBe(true);
    expectRgb(render(loaded), expected);
  });

  it('a project that stored the new recipe keeps it, and a new effect saves and reloads as the recipe', () => {
    const [stored] = loadedEffects([savedEffect('brightness', { amount: -1 }, createDefaultColorEffectGraph('brightness'))]);
    const gain = 2 ** -2.5, curve = (x: number) => x * gain / (x * gain + 1 - x);
    expectRgb(render(stored), [curve(0.5), curve(0.3), curve(0.2)]);

    for (const type of COLOR_RECIPE_EFFECT_TYPES) useTimelineStore.getState().addClipEffect('clip-look', type);
    const created = useTimelineStore.getState().clips[0].effects;
    for (const effect of created) {
      expect(matchesEffectRecipe(effect.operatorGraph!, createDefaultColorEffectGraph(effect.type as EditableColorEffectType)), effect.type).toBe(true);
    }
    const brightness = { ...created.find(effect => effect.type === 'brightness')!, params: { amount: -1 } };
    const [reloaded] = loadedEffects([JSON.parse(JSON.stringify(migratePersistedEffectOperatorGraph(brightness)))]);
    expectRgb(render(reloaded), [curve(0.5), curve(0.3), curve(0.2)]);
  });

  it('applies a custom Look saved before the rebuild with the original math and a new Look with its own graphs', () => {
    const oldLook: LookDefinition = { id: 'custom-old', name: 'Old warm', category: 'custom', thumbnail: { kind: 'generated' }, tags: ['custom'],
      builtIn: false, stack: [{ effectId: 'brightness', enabled: true, params: { amount: 0.3 } }, { effectId: 'gaussian-blur', enabled: true, params: { radius: 2 } }] };
    applyLookToClip(oldLook, 'clip-look');
    const [brightness, blur] = useTimelineStore.getState().clips[0].effects;
    expectRgb(render(brightness), [0.8, 0.6, 0.5]);
    expect(blur.type).toBe('gaussian-blur');

    // Saving keeps the color graph and marks the schema, so applying it again keeps that math.
    const saved = useLookStore.getState().saveCustomLook('Kept', stackFromClipEffects(useTimelineStore.getState().clips[0].effects))!;
    expect(saved.schemaVersion).toBe(LOOK_SCHEMA_VERSION);
    expect(saved.stack[0].operatorGraph).toBeDefined();
    expect(saved.stack[1].operatorGraph).toBeUndefined();
    useTimelineStore.setState({ clips: [createMockClip({ id: 'clip-look', trackId: 't' })] });
    applyLookToClip(saved, 'clip-look');
    expectRgb(render(useTimelineStore.getState().clips[0].effects[0]), [0.8, 0.6, 0.5]);

    // A built-in Look and a current custom Look without a stored graph use the current recipe.
    for (const look of [{ ...oldLook, builtIn: true }, { ...oldLook, schemaVersion: LOOK_SCHEMA_VERSION }]) {
      useTimelineStore.setState({ clips: [createMockClip({ id: 'clip-look', trackId: 't' })] });
      applyLookToClip(look, 'clip-look');
      const effect = useTimelineStore.getState().clips[0].effects[0];
      expect(matchesEffectRecipe(effect.operatorGraph!, createDefaultColorEffectGraph('brightness'))).toBe(true);
    }
  });

  it('checks a stored Look graph before it enters the clip and reports a corrupt one', () => {
    const broken = { nodes: [{ id: 'gone', operator: 'color.retired-operator', bindings: {} }], edges: [] } as unknown as EffectOperatorGraph;
    const look: LookDefinition = { id: 'custom-broken', name: 'Broken', category: 'custom', thumbnail: { kind: 'generated' }, tags: ['custom'],
      builtIn: false, schemaVersion: LOOK_SCHEMA_VERSION, stack: [{ effectId: 'brightness', enabled: true, params: { amount: 0.3 }, operatorGraph: broken }] };
    const problems = applyLookToClip(look, 'clip-look');
    expect(problems).toEqual([expect.stringMatching(/^Look "Broken": the saved brightness graph cannot be used \(.+\); it renders the current brightness instead\.$/)]);
    const [effect] = useTimelineStore.getState().clips[0].effects;
    expect(matchesEffectRecipe(effect.operatorGraph!, createDefaultColorEffectGraph('brightness'))).toBe(true);
    expect(effect.params.amount).toBe(0.3);
  });

  it('summarises effect graphs for getClipDetails and names the color math they render', () => {
    const recipe = createDefaultColorEffectGraph('brightness');
    const literal = recipe.nodes.find(node => node.operator.startsWith('values.') && node.constants && !Object.keys(node.bindings).length)!;
    const edited: EffectOperatorGraph = { ...recipe, nodes: recipe.nodes.map(node => node === literal
      ? { ...node, constants: Object.fromEntries(Object.entries(node.constants!).map(([key, value]) => [key, typeof value === 'number' ? value + 0.5 : value])) } : node) };
    const effects: Effect[] = [
      savedEffect('brightness', {}, recipe), { ...savedEffect('exposure', {}, createLegacyColorEffectGraph('exposure')), id: 'original' },
      { ...savedEffect('brightness', {}, edited), id: 'edited' }, { id: 'invert', name: 'invert', type: 'invert', enabled: true, params: {} },
    ];
    const summary = summarizeClipEffectGraphs(effects);
    expect(summary.map(effect => effect.operatorGraph && 'read' in effect.operatorGraph ? effect.operatorGraph.state : 'none'))
      .toEqual(['recipe', 'original', 'edited', 'none']);
    expect(summary[0].operatorGraph).toEqual({ nodes: recipe.nodes.length, edges: recipe.edges.length, state: 'recipe', read: 'getOperatorGraph' });
    expect(JSON.stringify(summary).length).toBeLessThan(1500);
  });

  it('groups a saved original color graph into its original folders, not the recipe stages', () => {
    const original = effectOperatorGraph(savedEffect('exposure', {}, createLegacyColorEffectGraph('exposure')));
    expect(original.groups?.map(group => group.label).toSorted()).toEqual(['Clamp & Alpha', 'Color Processing', 'Constants', 'Parameters']);
    const recipe = effectOperatorGraph(savedEffect('exposure', {}, createDefaultColorEffectGraph('exposure')));
    expect(recipe.groups?.map(group => group.label)).toEqual(expect.arrayContaining(['Parameters', 'Offset & Gamma']));
    expect(recipe.groups?.map(group => group.label)).not.toContain('White Balance Gains');
    // Hue Shift had no folders before the rebuild and gets none for its original graph (only its shared block).
    const hue = effectOperatorGraph(savedEffect('hue-shift', {}, createLegacyColorEffectGraph('hue-shift')));
    expect(hue.effectPresentationRules).toBeUndefined();
    expect(hue.groups?.every(group => group.composition)).toBe(true);
  });

  it('flags adjustment-layer color effects the worker GPU color matrix does not reproduce', () => {
    const effects: Effect[] = [
      { ...savedEffect('brightness', { amount: 0.2 }), id: 'new-graphless' },
      { ...savedEffect('contrast', { amount: 1.2 }, createDefaultColorEffectGraph('contrast')), id: 'new-recipe' },
      { ...savedEffect('saturation', { amount: 0.5 }, createLegacyColorEffectGraph('saturation')), id: 'original' },
      { id: 'invert', name: 'invert', type: 'invert', enabled: true, params: {} },
    ];
    expect(workerGpuAdjustmentColorDivergences(effects).map(item => [item.effectId, item.code]))
      .toEqual([['new-graphless', ADJUSTMENT_COLOR_RECIPE_UNSUPPORTED], ['new-recipe', ADJUSTMENT_COLOR_RECIPE_UNSUPPORTED]]);
    const worker = { workerRenderMode: true };
    expect(getMotionAdjustmentDiagnostics('adjustment-1', effects, 'normal', worker).message)
      .toContain('Worker GPU render modes still draw brightness, contrast with the original linear math.');
    expect(getMotionAdjustmentDiagnostics('adjustment-1', effects.slice(2), 'normal', worker).message).not.toContain('Worker GPU');
    // The default (main) render host draws the graphs, so the inspector stays quiet there.
    expect(getMotionAdjustmentDiagnostics('adjustment-1', effects, 'normal').message).not.toContain('Worker GPU');
  });
});

