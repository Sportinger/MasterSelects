// Weave's card: Form picks a recipe graph (Woven Cloth or Roman's Qualle), the card controls are
// definition parameters those recipes bind, and every one of them changes the strands.
import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { WEAVE_PARAMS, WEAVE_PRESETS } from '../../src/effects/generate/weave';
import { createDefaultWeaveGraph, geometryParameterReader, WEAVE_CLOTH_TURN, validateWeaveGraph, weaveBoundParameters, weaveOperatorGraph, weaveRecipeForm, weaveRecipeGraph }
  from '../../src/services/operators/geometry/weaveGraph';
import { createQualleGraph, QUALLE_CARD_CONTROLS } from '../../src/services/operators/geometry/qualleGraph';
import { compileGeometryGraph } from '../../src/services/operators/geometry/geometryProgram';
import { evaluateGeometryProgram } from '../../src/services/operators/geometry/geometryEvaluation';
import { effectOperatorGraph, effectOperatorParams, migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { effectParamDefinitions } from '../../src/services/operators/effectParamVisibility';
import { resolveEffectPreset } from '../../src/services/effects/effectPresets';
import type { EffectOperatorGraph } from '../../src/types/operatorGraph';

type Params = Record<string, number | boolean | string>;
const defaults = () => getDefaultParams('weave') as Params;
/** The strands of a Weave instance at `time`, as the render path builds them. */
const strands = (params: Params, time = 3, graph?: EffectOperatorGraph) => {
  const effect = { type: 'weave', params, ...(graph ? { operatorGraph: graph } : {}) };
  const program = compileGeometryGraph(effectOperatorGraph(effect), geometryParameterReader(effectOperatorParams(effect)), undefined, { time, simulationTime: time });
  return { program, curves: evaluateGeometryProgram(program) };
};
const finite = (values: ArrayLike<number>) => Array.from(values).every(Number.isFinite);
const differs = (a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined) =>
  !a || !b || a.length !== b.length || Array.from(a).some((value, index) => Math.abs(value - b[index]) > 1e-6);
const node = (graph: EffectOperatorGraph, id: string) => graph.nodes.find(candidate => candidate.id === id)!;
/** The Woven Cloth as Weaves saved it before Form existed: Reach 1.7, Wind and Color fixed in the graph. */
function earlierSavedGraph(): EffectOperatorGraph {
  const graph = createDefaultWeaveGraph();
  node(graph, 'reach').constants = { value: 1.7 };
  node(graph, 'wind').bindings = {};
  node(graph, 'fiber').bindings = {};
  return graph;
}

describe('Weave forms', () => {
  it('builds a valid recipe for every Form, and the Woven Cloth for an unknown one', () => {
    for (const form of ['cloth', 'qualle']) expect(validateWeaveGraph(weaveRecipeGraph(form))).toEqual([]);
    expect(weaveOperatorGraph({ form: 'qualle' }).nodes.some(item => item.id === 'pose')).toBe(true);
    expect(weaveOperatorGraph({}).nodes.map(item => item.id)).toEqual(createDefaultWeaveGraph().nodes.map(item => item.id));
    expect(getEffect('weave')!.paramWarnings!({ form: 'knot' }, 1920, 1080)).toEqual(['form: "knot" is not an option; using cloth.']);
  });

  it('keeps the card defaults equal to the values inside the recipes', () => {
    const cloth = createDefaultWeaveGraph(), qualle = createQualleGraph();
    expect(node(cloth, 'wind').constants?.strength).toBe(WEAVE_PARAMS.wind.default);
    expect(node(cloth, 'fiber').constants?.color).toBe(WEAVE_PARAMS.color.default);
    for (const [key, control] of Object.entries(QUALLE_CARD_CONTROLS)) {
      expect(node(qualle, control.node).bindings.value).toBe(key);
      expect(node(qualle, control.node).constants?.value).toBe(WEAVE_PARAMS[key].default);
      expect([WEAVE_PARAMS[key].label, WEAVE_PARAMS[key].min, WEAVE_PARAMS[key].max]).toEqual([control.label, control.min, control.max]);
    }
    // Only the three card values of the piece stay parameters; Irregularity of the cloth cannot reach it.
    expect(qualle.nodes.filter(item => item.exposed).map(item => item.bindings.value).toSorted()).toEqual(Object.keys(QUALLE_CARD_CONTROLS).toSorted());
  });

  it('renders a Weave saved before the card had controls as before (Wind 0.35, grey wool)', () => {
    const saved = createDefaultWeaveGraph(), read = geometryParameterReader({});
    expect(read(node(saved, 'wind'), 'strength')).toBe(0.35);
    expect(read(node(saved, 'fiber'), 'color')).toBe('#8a857c');
    expect(differs(strands({}).curves.positions, strands(defaults()).curves.positions)).toBe(false);
  });

  it('changes the strands with every control of each Form', () => {
    const cases: Array<[Params, string, number | string, number]> = [
      [{}, 'weave_value', 0.3, 2], [{}, 'reveal_value', 0.4, 6], [{}, 'irregularity_value', 0, 6], [{}, 'wind', 1.5, 3],
      [{ form: 'qualle' }, 'pulse-rate_value', 1.2, 2.2], [{ form: 'qualle' }, 'pulse-strength_value', 0.1, 1.2], [{ form: 'qualle' }, 'curl-strength_value', 0.2, 2],
    ];
    for (const [base, key, value, time] of cases) {
      const before = strands({ ...defaults(), ...base }, time).curves, after = strands({ ...defaults(), ...base, [key]: value }, time).curves;
      expect(differs(before.positions, after.positions) || differs(before.radius, after.radius), key).toBe(true);
    }
    const color = (params: Params) => JSON.stringify(strands({ ...defaults(), ...params }).program.render);
    expect(color({ color: '#a3201c' })).not.toBe(color({}));
    expect(color({ form: 'qualle', color: '#a3201c' })).not.toBe(color({ form: 'qualle' }));
  });

  it('stays finite over every control range and beyond', () => {
    const extremes: Params[] = [{ wind: 0 }, { wind: 2 }, { wind: 30 }, { weave_value: 10 }, { weave_value: 0 }, { reveal_value: 0 },
      { irregularity_value: 3 }, { wind: Number.NaN }, { form: 'qualle', 'pulse-rate_value': 2, 'pulse-strength_value': 0.6, 'curl-strength_value': 0.5 },
      { form: 'qualle', 'pulse-rate_value': 0, 'pulse-strength_value': 0, 'curl-strength_value': 0 }];
    for (const extreme of extremes) {
      const { curves } = strands({ ...defaults(), ...extreme }, 4);
      expect(finite(curves.positions), JSON.stringify(extreme)).toBe(true);
    }
  });

  it('shows Form and the controls of both recipes until the graph is edited, then only what the graph binds', () => {
    const fresh = { type: 'weave', params: defaults() };
    expect([...weaveBoundParameters(fresh.params, undefined)].toSorted()).toEqual(Object.keys(WEAVE_PARAMS).toSorted());
    const shown = (effect: { type: string; params: Params; operatorGraph?: EffectOperatorGraph }) =>
      Object.entries(effectParamDefinitions(effect)).filter(([, definition]) => !definition.hidden).map(([key]) => key).toSorted();
    expect(shown(fresh)).toEqual(Object.keys(WEAVE_PARAMS).toSorted());
    // A graph saved before the card had Form keeps its own look: Form, Wind, Color and the Qualle values leave the card.
    expect(shown({ ...fresh, operatorGraph: earlierSavedGraph() })).toEqual(['irregularity_value', 'reveal_value', 'weave_value']);
  });

  it('keeps Form working after saving pins a Weave to its recipe, and keeps an edited graph', () => {
    const fresh = { id: 'fx', name: 'Weave', type: 'weave' as const, enabled: true, params: defaults() };
    const saved = migratePersistedEffectOperatorGraph(fresh);
    expect(saved.operatorGraph).toBeDefined();
    expect(weaveRecipeForm(saved.operatorGraph!)).toBe('cloth');
    // The pinned recipe follows Form: switching to the Qualle draws the jellyfish, and saving again pins that.
    const switched = { ...saved, params: { ...saved.params, form: 'qualle' } };
    expect(effectOperatorGraph(switched).nodes.some(item => item.id === 'pose')).toBe(true);
    expect(weaveRecipeForm(migratePersistedEffectOperatorGraph(switched).operatorGraph!)).toBe('qualle');
    const shown = Object.entries(effectParamDefinitions(switched)).filter(([, definition]) => !definition.hidden).map(([key]) => key);
    expect(shown).toContain('form');
    // An edited graph is the Weave's own: Form leaves the card and does not change it.
    const edited = structuredClone(saved.operatorGraph!);
    edited.nodes.find(item => item.id === 'yarn')!.constants!.plies = 1;
    expect(weaveRecipeForm(edited)).toBeUndefined();
    const own = { ...saved, operatorGraph: edited, params: { ...saved.params, form: 'qualle' } };
    expect(effectOperatorGraph(own).nodes.some(item => item.id === 'pose')).toBe(false);
    expect(effectParamDefinitions(own).form.hidden).toBe(true);
    // A switched-off folder (Byp) is an edit too.
    const bypassed = structuredClone(saved.operatorGraph!);
    bypassed.groups!.find(group => group.id === 'wind-cloth')!.bypassed = true;
    expect(weaveRecipeForm(bypassed)).toBeUndefined();
  });

  it('keeps node positions, folder names and folding and value ranges of a pinned recipe until Form changes', () => {
    const saved = migratePersistedEffectOperatorGraph({ id: 'fx', name: 'Weave', type: 'weave' as const, enabled: true, params: defaults() });
    const moved = structuredClone(saved.operatorGraph!);
    moved.layout!.reveal = { x: 9999, y: 7777 };
    const folder = moved.groups!.find(group => group.id === 'wind-cloth')!;
    folder.label = 'My Wind';
    folder.collapsedByDefault = true;
    node(moved, 'reach').valueControl = { label: 'Reach', min: 0, max: 10, step: 0.01 };
    expect(weaveRecipeForm(moved)).toBe('cloth');
    const resolved = effectOperatorGraph({ ...saved, operatorGraph: moved });
    expect(resolved.layout?.reveal).toEqual({ x: 9999, y: 7777 });
    expect(resolved.groups?.find(group => group.id === 'wind-cloth')).toMatchObject({ label: 'My Wind', collapsedByDefault: true });
    expect(node(resolved, 'reach').valueControl?.max).toBe(10);
    // Form still switches the recipe.
    const switched = effectOperatorGraph({ ...saved, operatorGraph: moved, params: { ...saved.params, form: 'qualle' } });
    expect(switched.nodes.some(item => item.id === 'pose')).toBe(true);
  });

  it('turns the Woven Cloth three quarters, so the wind bows the sheet sideways in the picture', () => {
    const graph = createDefaultWeaveGraph();
    expect(node(graph, 'cloth').constants?.turn).toBe(WEAVE_CLOTH_TURN);
    // Head-on (Turn 0, as Weaves saved before Turn) the wind only moves the threads towards the camera; turned, across the frame.
    const across = (turn: number, wind: number) => {
      const turned = structuredClone(graph);
      node(turned, 'cloth').constants = { ...node(turned, 'cloth').constants, turn };
      const effect = { type: 'weave', params: { ...defaults(), wind }, operatorGraph: turned };
      const program = compileGeometryGraph(turned, geometryParameterReader(effectOperatorParams(effect)), undefined, { time: 5, simulationTime: 5 });
      const positions = evaluateGeometryProgram(program).positions, xs: number[] = [];
      for (let index = 0; index < positions.length; index += 3) xs.push(positions[index]);
      return xs;
    };
    const shift = (a: number[], b: number[]) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
    expect(shift(across(0, 0), across(0, 2))).toBeLessThan(0.03);
    expect(shift(across(WEAVE_CLOTH_TURN, 0), across(WEAVE_CLOTH_TURN, 2))).toBeGreaterThan(0.08);
  });

  it('makes Irregularity 3 clearly crooked while 1 keeps the familiar look', () => {
    // Meander and tension grow with the square of Irregularity: 1 is unchanged, 3 is nine times as uneven.
    const offset = (irregularity: number) => {
      const flat = strands({ ...defaults(), irregularity_value: 0, wind: 0 }, 6).curves.positions;
      const rough = strands({ ...defaults(), irregularity_value: irregularity, wind: 0 }, 6).curves.positions;
      return Math.max(...Array.from(rough, (value, index) => Math.abs(value - flat[index])));
    };
    const one = offset(1), three = offset(3);
    expect(one).toBeGreaterThan(0.005);
    expect(one).toBeLessThan(0.03);
    expect(three / one).toBeGreaterThan(5);
  });

  it('keeps Curl Strength within the frame: the card stops at 0.25', () => {
    expect(WEAVE_PARAMS['curl-strength_value'].max).toBe(0.25);
    expect(QUALLE_CARD_CONTROLS['curl-strength_value'].max).toBe(0.25);
  });

  it('names values beyond a control range (from tools) instead of drawing them without a word', () => {
    const notes = (params: Params) => getEffect('weave')!.paramWarnings!({ ...defaults(), ...params }, 1920, 1080);
    expect(notes({})).toEqual([]);
    expect(notes({ weave_value: -1 }).join(' ')).toMatch(/Weave Speed -1 is outside its range 0 to 10: .*stays empty/);
    expect(notes({ irregularity_value: -2 }).join(' ')).toMatch(/same positive one/);
    expect(notes({ wind: 30 }).join(' ')).toMatch(/Wind 30 is outside/);
    expect(notes({ 'curl-strength_value': 0.4 }).join(' ')).toMatch(/past the edges of the frame/);
  });

  it('declares presets the Preset row can apply to a fresh Weave', () => {
    expect(WEAVE_PRESETS.map(preset => preset.name)).toEqual(['Burlap', 'Red Sail', 'Nest', 'Qualle']);
    const fresh = { type: 'weave', params: defaults() };
    for (const preset of WEAVE_PRESETS) {
      expect(Object.keys(preset.params).filter(key => !(key in WEAVE_PARAMS))).toEqual([]);
      const applied = resolveEffectPreset(fresh, preset);
      for (const [key, value] of Object.entries(preset.params)) expect(applied[key]).toBe(value);
    }
    expect(resolveEffectPreset(fresh, WEAVE_PRESETS.at(-1)!)).toMatchObject({ form: 'qualle', color: '#eee2cf', weave_value: 1 });
  });
});
