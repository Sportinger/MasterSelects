import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { POSTERIZE_PARAMS, THRESHOLD_PARAMS } from '../../src/effects/stylize/pointwiseParams';
import { createDefaultPosterizeGraph, createDefaultThresholdGraph, createEarlierPointwiseEffectGraph } from '../../src/services/operators/pointwiseEffectGraphs';
import { POSTERIZE_PRESETS } from '../../src/effects/stylize/posterize';
import { THRESHOLD_PRESETS } from '../../src/effects/stylize/threshold';
import { organizeEffectFamilyGraph } from '../../src/services/operators/effectFamilyPresentation';
import { effectPortLabels } from '../../src/services/operators/effectPresentationPlans';
import { recognizeOperatorCompositions } from '../../src/services/operators/recognizeOperatorCompositions';
import { setOperatorParameter } from '../../src/services/operators/effectGraphEditing';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => useTimelineStore.setState(initial));
const effect = (type: 'threshold' | 'posterize', params = getDefaultParams(type)): Effect =>
  ({ id: `${type}-fx`, name: type, type, enabled: true, params });
const run = (type: 'threshold' | 'posterize', params: Record<string, unknown>, pixel: [number, number, number, number]) =>
  evaluateImageOperatorPlan(compileImageOperatorGraph(createEarlierPointwiseEffectGraph(type), params), pixel);

describe('pointwise effect graph ownership', () => {
  it('shares the exact legacy schemas and preserves them for graph-bound values', () => {
    expect(getEffect('threshold')?.params).toBe(THRESHOLD_PARAMS);
    expect(getEffect('posterize')?.params).toBe(POSTERIZE_PARAMS);
    expect(THRESHOLD_PARAMS.level).toMatchObject({ default: 0.5, min: 0, max: 1, step: 0.01, animatable: true });
    expect(POSTERIZE_PARAMS.levels).toMatchObject({ default: 6, min: 2, max: 32, step: 1, animatable: true });
  });

  it('uses strict Rec.709 threshold comparison and keeps alpha outside the math', () => {
    expect(run('threshold', { level: 0.5 }, [0.5, 0.5, 0.5, 0.35])).toEqual([0, 0, 0, 0.35]);
    expect(run('threshold', { level: 0.5 }, [0.5001, 0.5001, 0.5001, 0.35])).toEqual([1, 1, 1, 0.35]);
    const graph = createEarlierPointwiseEffectGraph('threshold');
    expect(graph.nodes.map(node => node.operator)).toContain('color.luminance-rec709.rgb');
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'split', output: 'alpha', to: 'combine', input: 'alpha' }));
  });

  it('matches posterize floor/divide semantics without a final clamp', () => {
    const result = run('posterize', { levels: 6 }, [1, 0.5, 0, 0.35]);
    expect(result).toEqual([1.2, 0.6, 0, 0.35]);
    const graph = createEarlierPointwiseEffectGraph('posterize');
    expect(graph.nodes.some(node => node.operator === 'math.clamp.rgb')).toBe(false);
    expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'divide', output: 'value', to: 'combine', input: 'rgb' }));
  });

  it.each(['threshold', 'posterize'] as const)('derives %s params{} defaults and round-trips its canonical graph', type => {
    const legacy = effect(type, {}), graph = effectOperatorGraph(legacy);
    expect(effectOperatorParams(legacy)).toMatchObject(getDefaultParams(type));
    const canonical = migratePersistedEffectOperatorGraph(legacy);
    expect(effectOperatorGraph(JSON.parse(JSON.stringify(canonical)) as Effect)).toEqual(graph);
  });

  it('executes rewired threshold branches and retains the stable posterize binding', () => {
    const threshold = createEarlierPointwiseEffectGraph('threshold');
    threshold.edges.find(edge => edge.to === 'select' && edge.input === 'falseValue')!.from = 'white';
    threshold.edges.find(edge => edge.to === 'select' && edge.input === 'trueValue')!.from = 'black';
    expect(evaluateImageOperatorPlan(compileImageOperatorGraph(threshold, { level: 0.5 }), [0.2, 0.2, 0.2, 0.35])).toEqual([1, 1, 1, 0.35]);

    const canonical = migratePersistedEffectOperatorGraph(effect('posterize'));
    const clip = createMockClip({ id: 'posterize-clip', effects: [canonical] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    setOperatorParameter(clip.id, canonical.id, 'levels', 'value', 12);
    const saved = useTimelineStore.getState().clips[0].effects[0];
    expect(saved.params.levels).toBe(12);
    expect(saved.operatorGraph?.nodes.find(node => node.id === 'levels')).toMatchObject({ bindings: { value: 'levels' } });
    expect(() => setOperatorParameter(clip.id, canonical.id, 'levels', 'value', 33)).toThrow('outside its supported range');
  });

  it('gives Posterize four presets that each make the look their name promises', () => {
    const presets = Object.fromEntries(POSTERIZE_PRESETS.map(preset => [preset.name, preset.params]));
    expect(Object.keys(presets)).toEqual(['Stencil', 'Screen Print', 'Pop Art', 'Banded Light']);
    // Every preset names Brightness Only: its stored default (off) is not what a new Posterize starts with.
    for (const params of Object.values(presets)) expect(typeof params.brightnessOnly).toBe('boolean');
    const plan = (name: string) => compileImageOperatorGraph(createDefaultPosterizeGraph(), { ...getDefaultParams('posterize'), ...presets[name] });
    const greys = Array.from({ length: 101 }, (_, index) => index / 100);
    const tones = (name: string) => new Set(greys.map(value => evaluateImageOperatorPlan(plan(name), [value, value, value, 1])[0].toFixed(3))).size;
    // Banded Light: eight hard bands; Stencil: black or full, with a short rounded ramp between them.
    expect(tones('Banded Light')).toBe(8);
    const stencil = greys.map(value => evaluateImageOperatorPlan(plan('Stencil'), [value, value, value, 1])[0]);
    expect(stencil.filter(value => value > 0.001 && value < 0.999).length).toBeLessThanOrEqual(6);
    // Stencil keeps the hue of a light colour (it scales the colour to full brightness); Pop Art pushes each channel apart.
    const [r, g, b] = evaluateImageOperatorPlan(plan('Stencil'), [0.8, 0.6, 0.2, 1]);
    expect([r, g / r, b / r].map(value => +value.toFixed(3))).toEqual([1, 0.75, 0.25]);
    expect(evaluateImageOperatorPlan(plan('Pop Art'), [0.8, 0.6, 0.2, 0.5])).toEqual([1, 1, 0, 0.5]);
    // Screen Print: four tones with rounded steps, so a grey between two inks gets an in-between value.
    const print = evaluateImageOperatorPlan(plan('Screen Print'), [0.5, 0.5, 0.5, 1])[0];
    expect(print).toBeGreaterThan(1 / 3); expect(print).toBeLessThan(2 / 3);
  });

  it('opens the Posterize recipe as a path of named stage folders instead of one Color Processing folder', () => {
    const graph = createDefaultPosterizeGraph();
    const organized = organizeEffectFamilyGraph(graph, recognizeOperatorCompositions(graph), 'posterize', createDefaultPosterizeGraph);
    const folders = Object.fromEntries((organized.groups ?? []).map(group => [group.label, group.nodeIds.toSorted()]));
    expect(Object.keys(folders)).toEqual(expect.arrayContaining(['Parameters', 'Constants', 'Step Input', 'Hard Steps', 'Soft Steps', 'Spread to 0–1', 'Colour & Alpha']));
    expect(Object.keys(folders)).not.toContain('Color Processing');
    expect(folders.Parameters).toEqual(['brightness-only', 'brightness-only-share', 'effective-levels', 'levels', 'ramp-width', 'softness']);
    expect(folders['Step Input']).toEqual(['brightness', 'brightness-rgb', 'posterize-input']);
    expect(folders['Hard Steps']).toEqual(['hard', 'scaled']);
    expect(folders['Spread to 0–1']).toEqual(['clamped', 'denominator', 'divide']);
    expect(folders['Colour & Alpha']).toContain('combine');
    expect(folders['Soft Steps']).toEqual(expect.arrayContaining(['ramp', 'smooth', 'soft', 'steps']));
    // Every computing card sits in a folder: the overview reads Input → stages → Output.
    const grouped = new Set(Object.values(folders).flat());
    expect(graph.nodes.filter(node => !['frame', 'split', 'output'].includes(node.id) && !grouped.has(node.id)).map(node => node.id)).toEqual([]);
    expect(effectPortLabels('posterize')).toMatchObject({ 'effective-levels': 'Levels', 'ramp-width': 'Ramp Width', clamped: 'Posterized RGB', hard: 'Hard Step' });
    // Threshold keeps its own plan; an edited Posterize is not the recipe and gets no folders.
    expect(effectPortLabels('threshold')).not.toHaveProperty('effective-levels');
    const edited = { ...graph, nodes: graph.nodes.filter(node => node.id !== 'kept-colour') };
    expect(organizeEffectFamilyGraph(edited, recognizeOperatorCompositions(edited), 'posterize', createDefaultPosterizeGraph).groups ?? []).toEqual([]);
  });

  it('gives Threshold four presets that each cut where their name says', () => {
    const presets = Object.fromEntries(THRESHOLD_PRESETS.map(preset => [preset.name, preset.params]));
    expect(Object.keys(presets)).toEqual(['Photocopy', 'Charcoal', 'Highlights', 'Shadow Matte']);
    const cut = (name: string, grey: number, alpha = 1) =>
      evaluateImageOperatorPlan(compileImageOperatorGraph(createDefaultThresholdGraph(), { ...getDefaultParams('threshold'), ...presets[name] }), [grey, grey, grey, alpha]);
    const greys = Array.from({ length: 101 }, (_, index) => index / 100);
    const between = (name: string) => greys.filter(grey => { const value = cut(name, grey)[0]; return value > 0.001 && value < 0.999; }).length;
    // Photocopy: a hard cut at middle grey, nothing in between; the transparency stays.
    expect(between('Photocopy')).toBe(0);
    expect([cut('Photocopy', 0.49, 0.4), cut('Photocopy', 0.51, 0.4)]).toEqual([[0, 0, 0, 0.4], [1, 1, 1, 0.4]]);
    // Charcoal: a wide soft edge keeps a band of greys around its Level.
    expect(between('Charcoal')).toBeGreaterThanOrEqual(30);
    expect(cut('Charcoal', 0.45)[0]).toBeCloseTo(0.5, 5);
    // Highlights: only the brightest values turn white; Shadow Matte: all but the deepest shadows.
    expect([cut('Highlights', 0.65)[0], cut('Highlights', 0.85)[0]]).toEqual([0, 1]);
    expect([cut('Shadow Matte', 0.1)[0], cut('Shadow Matte', 0.3)[0]]).toEqual([0, 1]);
  });

  it('opens the Threshold recipe as named stage folders instead of Color Processing and a Clamp & Alpha without a Clamp', () => {
    const graph = createDefaultThresholdGraph();
    const organized = organizeEffectFamilyGraph(graph, recognizeOperatorCompositions(graph), 'threshold', createDefaultThresholdGraph);
    const folders = Object.fromEntries((organized.groups ?? []).map(group => [group.label, group.nodeIds.toSorted()]));
    expect(Object.keys(folders).toSorted()).toEqual(['Black & White', 'Brightness', 'Constants', 'Hard Edge', 'Parameters', 'Soft Edge']);
    expect(folders.Parameters).toEqual(['level', 'ramp-width', 'softness']);
    expect(folders.Brightness).toEqual(['luma']);
    expect(folders['Hard Edge']).toEqual(['compare', 'hard']);
    expect(folders['Soft Edge']).toEqual(expect.arrayContaining(['ramp-distance', 'ramp-clamped', 'ramp', 'soft-active', 'soft']));
    expect(folders['Black & White']).toEqual(['combine', 'result-rgb', 'value']);
    // Every computing card sits in a folder: the overview reads Input → stages → Output.
    const grouped = new Set(Object.values(folders).flat());
    expect(graph.nodes.filter(node => !['frame', 'split', 'output'].includes(node.id) && !grouped.has(node.id)).map(node => node.id)).toEqual([]);
    expect(effectPortLabels('threshold')).toMatchObject({ luma: 'Brightness', compare: 'Above Level', 'ramp-width': 'Ramp Width',
      'ramp-clamped': 'Ramp Position', value: 'Black & White' });
    // An edited Threshold is not the recipe and gets no folders.
    const edited = { ...graph, nodes: graph.nodes.filter(node => node.id !== 'soft') };
    expect(organizeEffectFamilyGraph(edited, recognizeOperatorCompositions(edited), 'threshold', createDefaultThresholdGraph).groups ?? []).toEqual([]);
  });
});
