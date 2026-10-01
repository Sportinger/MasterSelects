import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorValue } from '../../../types/operatorGraph';
import type { Keyframe } from '../../../types/keyframes';
import { EFFECT_GRAPH_PARAM, readEffectGraph, sampleOperatorParameter, validateEffectGraph, type OperatorParameters } from '../effectGraph';
import { EFFECT_OPERATORS } from '../operatorRegistry';
import { pointwiseLoweringFor } from '../fields/pointwiseLowering';
import { isCurveOperator } from './curveOperators';
import { compileGeometryGraph, type GeometryParameterReader } from './geometryProgram';

export const WEAVE_EFFECT_TYPE = 'weave';
const FIELD_SIGNALS = new Set(['number', 'boolean', 'vec2', 'vec3', 'vec4']);
/** Shared force nodes a Cloth Sheet reads (the same identities cables and particles use). */
const CLOTH_FORCE_OPERATORS = ['forces.wind', 'forces.gravity', 'forces.turbulence', 'forces.drag'];

/** Pure per-element operators run per curve point; this is the shared family contract, not a Weave copy. */
const isCurveFieldOperator = (operator: OperatorDefinition) => !operator.composition
  && [...operator.inputs, ...operator.outputs].every(port => FIELD_SIGNALS.has(port.type))
  && operator.outputs.length > 0 && operator.outputs.every(port => pointwiseLoweringFor(operator.id, port.id));

let ownerOperators: OperatorDefinition[] | undefined;
/** Nodes a geometry graph offers: curve operators, values and every shared pointwise math/vector operator. */
export function geometryOwnerOperators(): OperatorDefinition[] {
  return ownerOperators ??= EFFECT_OPERATORS.filter(operator => operator.addable && (isCurveOperator(operator.id)
    || ['values.number', 'values.integer', 'image.timeline-time', ...CLOTH_FORCE_OPERATORS].includes(operator.id) || isCurveFieldOperator(operator)));
}

/** Reads literal node values, effect-bound values and their keyframes at `time`. */
export function geometryParameterReader(params: OperatorParameters, effectId = '', keys: Keyframe[] = [], time = 0): GeometryParameterReader {
  return (node, parameter) => sampleOperatorParameter(node, parameter, params, effectId, keys, time);
}

type Spec = [id: string, operator: string, x: number, y: number, constants?: Record<string, OperatorValue>];
const WAVE_NODES: Spec[] = [
  ['info', 'geometry.curve-info', 360, 360],
  ['frequency', 'values.number', 360, 560, { value: 40 }], ['half', 'values.number', 360, 700, { value: 0.5 }],
  ['sign-scale', 'values.number', 360, 840, { value: -4 }], ['one', 'values.number', 360, 980, { value: 1 }],
  ['amplitude', 'values.number', 360, 1120, { value: 0.035 }], ['sway', 'values.number', 360, 1260, { value: 0.015 }],
  ['zero', 'values.number', 360, 1400, { value: 0 }],
  ['phase', 'math.multiply.scalar', 620, 420], ['wave', 'math.sin.scalar', 860, 420],
  ['half-strand', 'math.multiply.scalar', 620, 700], ['parity', 'math.fract.scalar', 860, 700],
  ['parity-scale', 'math.multiply.scalar', 1100, 700], ['sign', 'math.add.scalar', 1340, 700],
  ['lift', 'math.multiply.scalar', 1100, 420], ['over-under', 'math.multiply.scalar', 1580, 560],
  ['half-phase', 'math.multiply.scalar', 620, 1020], ['sway-wave', 'math.sin.scalar', 860, 1020], ['side', 'math.multiply.scalar', 1100, 1020],
  ['offset', 'vector.combine.vec3', 1820, 760],
];
const CHAIN_NODES: Spec[] = [
  ['line', 'geometry.curve-line', 0, 80, { points: 2000, length: 2, axis: 'x' }],
  ['array', 'geometry.strand-array', 360, 80, { count: 8, spacing: 0.12, axis: 'y' }],
  ['set-position', 'geometry.set-position', 2080, 80],
  ['render', 'render.strands', 2360, 80, { width: 0.004, color: '#e8e2d6' }],
  ['output', 'scene.output', 2640, 80],
];
const LINKS: Array<[from: string, output: string, to: string, input: string]> = [
  ['line', 'curves', 'array', 'curves'], ['array', 'curves', 'set-position', 'curves'],
  ['set-position', 'curves', 'render', 'curves'], ['render', 'scene', 'output', 'scene'],
  ['info', 'u', 'phase', 'a'], ['frequency', 'value', 'phase', 'b'], ['phase', 'value', 'wave', 'value'],
  ['info', 'strand', 'half-strand', 'a'], ['half', 'value', 'half-strand', 'b'], ['half-strand', 'value', 'parity', 'value'],
  ['parity', 'value', 'parity-scale', 'a'], ['sign-scale', 'value', 'parity-scale', 'b'],
  ['parity-scale', 'value', 'sign', 'a'], ['one', 'value', 'sign', 'b'],
  ['wave', 'value', 'lift', 'a'], ['amplitude', 'value', 'lift', 'b'],
  ['lift', 'value', 'over-under', 'a'], ['sign', 'value', 'over-under', 'b'],
  ['phase', 'value', 'half-phase', 'a'], ['half', 'value', 'half-phase', 'b'], ['half-phase', 'value', 'sway-wave', 'value'],
  ['sway-wave', 'value', 'side', 'a'], ['sway', 'value', 'side', 'b'],
  ['zero', 'value', 'offset', 'x'], ['over-under', 'value', 'offset', 'y'], ['side', 'value', 'offset', 'z'],
  ['offset', 'value', 'set-position', 'offset'],
];

/**
 * Example graph from general nodes only: horizontal strands whose wave alternates per strand,
 * with a slower sway in depth. The wave is ordinary Math nodes evaluated per curve point
 * (the Houdini wrangle as nodes).
 */
export function createWaveStrandsGraph(): EffectOperatorGraph {
  const specs = [...CHAIN_NODES, ...WAVE_NODES];
  const nodes: BoundOperatorNode[] = specs.map(([id, operator, , , constants]) =>
    ({ id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants: { ...constants } } : {}) }));
  return { version: 1, schemaVersion: 1, domain: 'geometry', nodes,
    edges: LINKS.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
    layout: Object.fromEntries(specs.map(([id, , x, y]) => [id, { x, y }])),
    groups: [{ id: 'wave-offset', label: 'Wave Offset', color: '#8a7fd1', nodeIds: WAVE_NODES.map(([id]) => id) }] };
}

const FABRIC_NODES: Spec[] = [
  ['pattern', 'weave.pattern', 0, 80, { pattern: 'plain', warps: 24, wefts: 16, width: 2.4, height: 1.6, crimp: 0.03, resolution: 16 }],
  ['yarn', 'geometry.yarn-profile', 1320, 80, { plies: 3, fibers: 5, radius: 0.028, plyTwist: 5, fiberTwist: -11 }],
  ['yarn-radius', 'math.multiply.scalar', 1320, 300],
  ['render', 'render.strands', 2280, 80, { width: 0.0035, color: '#e8e2d6' }],
  ['output', 'scene.output', 2600, 80],
  ['flyaways', 'geometry.flyaways', 1640, 80, { density: 3, length: 0.08, lift: 2.5, hair: 0.35, seed: 0 }],
];
/** Wind Cloth: the woven sheet is held at its corners and billows like a sail in gusty, swirling wind (no gravity). */
const CLOTH_NODES: Spec[] = [
  ['wind', 'forces.wind', 1320, 620, { direction: [0.2, 0, 1], strength: 0.35, gust: 0.5 }],
  ['swirl', 'forces.turbulence', 1320, 860, { strength: 0.15, frequency: 1.5 }],
  ['cloth', 'geometry.cloth-sheet', 1640, 620, { columns: 40, rows: 27, width: 2.4, height: 1.6, pin: 'corners', stretch: 0.9, bend: 0.6,
    damping: 0.5, substeps: 6, preroll: 2 }],
  ['bind', 'geometry.surface-bind', 1960, 80, { height: 1 }],
];
/** Reveal by Shape: a growing sphere with a noisy front scales the yarn radius (0 hides, >1 swells the front). */
const REVEAL_NODES: Spec[] = [
  ['reveal', 'values.number', 0, 380], ['reach', 'values.number', 0, 520, { value: 1.7 }],
  ['reveal-radius', 'math.multiply.scalar', 260, 420],
  ['reveal-shape', 'field.shape-distance', 520, 380, { shape: 'sphere', center: [0, 0, 0], size: 0.5 }],
  ['reveal-noise', 'field.noise', 520, 620, { frequency: 3, amplitude: 0.08, octaves: 3, seed: 0 }],
  ['reveal-edge', 'math.add.scalar', 780, 460],
  ['reveal-ramp', 'field.ramp', 1040, 460, { x0: -0.12, y0: 1, x1: 0, y1: 1.6, x2: 0.1, y2: 0 }],
];
/**
 * Weave In: every thread is pulled in along its path by a lifted tip (Thread Along), warps first.
 * Progress is min(clip time × Weave Speed / 4 s, 1), so a finished weave compiles to the same
 * program every frame; bypassing the group shows the finished weave at once.
 */
const WEAVE_IN_NODES: Spec[] = [
  ['weave-clock', 'geometry.clip-time', 0, 860], ['weave', 'values.number', 0, 1000], ['weave-rate', 'values.number', 0, 1140, { value: 0.25 }],
  ['weave-scaled', 'math.multiply.scalar', 260, 900], ['weave-progress-raw', 'math.multiply.scalar', 520, 900],
  ['weave-one', 'values.number', 520, 1060, { value: 1 }], ['weave-progress', 'math.min.scalar', 780, 900],
  ['thread', 'geometry.thread-along', 1000, 80, { stagger: 0.6, lift: 0.06, liftLength: 0.2, settle: 1.2 }],
];
/**
 * Handmade: Irregularity scales a meander of each thread along its length (uneven spacing),
 * a per-thread tension that varies the crimp, and slubs that thicken the yarn in places;
 * 1 is the default look, 0 a machine-perfect weave.
 */
const HANDMADE_NODES: Spec[] = [
  ['hand-amount', 'values.number', 0, 1400, { value: 1 }],
  ['hand-wobble-scale', 'values.number', 0, 1540, { value: 0.008 }], ['hand-tension-scale', 'values.number', 0, 1680, { value: 0.35 }],
  ['hand-wobble-amplitude', 'math.multiply.scalar', 260, 1440], ['hand-tension-amplitude', 'math.multiply.scalar', 260, 1680],
  ['hand-wobble-x', 'field.noise', 520, 1400, { frequency: 1, amplitude: 0.008, octaves: 2, seed: 11 }],
  ['hand-wobble-y', 'field.noise', 520, 1600, { frequency: 1, amplitude: 0.008, octaves: 2, seed: 12 }],
  ['hand-meander-scale', 'values.number', 0, 2560, { value: 3 }], ['hand-meander', 'math.multiply.scalar', 260, 2560],
  ['hand-meander-vector', 'vector.combine.vec3', 520, 2560],
  ['hand-info', 'geometry.curve-info', 0, 1840], ['hand-golden', 'values.number', 0, 2000, { value: 0.618 }],
  ['hand-zero', 'values.number', 0, 2140, { value: 0 }], ['hand-along-scale', 'values.number', 0, 2280, { value: 9 }],
  ['hand-one', 'values.number', 0, 2420, { value: 1 }],
  ['hand-thread-key', 'math.multiply.scalar', 260, 1880], ['hand-thread-vector', 'vector.combine.vec3', 520, 1880],
  ['hand-tension', 'field.noise', 780, 1800, { frequency: 1, amplitude: 0.6, octaves: 1, seed: 13 }],
  ['hand-position', 'geometry.position', 780, 2000], ['hand-split', 'vector.split.vec3', 1000, 2000],
  ['hand-crimp', 'math.multiply.scalar', 1000, 1800], ['hand-offset', 'vector.combine.vec3', 1000, 1500],
  ['hand-set', 'geometry.set-position', 560, 80],
  ['hand-along', 'math.multiply.scalar', 260, 2280], ['hand-slub-vector', 'vector.combine.vec3', 520, 2200],
  ['hand-slub-noise', 'field.noise', 780, 2200, { frequency: 1, amplitude: 1, octaves: 2, seed: 14 }],
  ['hand-slub', 'field.ramp', 1000, 2200, { x0: 0.3, y0: 0, x1: 0.55, y1: 0.15, x2: 0.8, y2: 0.4 }],
  ['hand-slub-amount', 'math.multiply.scalar', 1240, 2200], ['hand-swell', 'math.add.scalar', 1240, 2000],
];
const FABRIC_LINKS: Array<[from: string, output: string, to: string, input: string]> = [
  ['pattern', 'curves', 'hand-set', 'curves'], ['hand-set', 'curves', 'thread', 'curves'], ['thread', 'curves', 'yarn', 'curves'],
  ['yarn', 'curves', 'flyaways', 'curves'], ['flyaways', 'curves', 'bind', 'curves'],
  ['bind', 'curves', 'render', 'curves'], ['render', 'scene', 'output', 'scene'],
  ['wind', 'force', 'cloth', 'forces'], ['swirl', 'force', 'cloth', 'forces'], ['cloth', 'surface', 'bind', 'surface'],
  ['reveal', 'value', 'reveal-radius', 'a'], ['reach', 'value', 'reveal-radius', 'b'], ['reveal-radius', 'value', 'reveal-shape', 'size'],
  ['reveal-shape', 'value', 'reveal-edge', 'a'], ['reveal-noise', 'value', 'reveal-edge', 'b'], ['reveal-edge', 'value', 'reveal-ramp', 'value'],
  ['reveal-ramp', 'value', 'yarn-radius', 'a'], ['hand-swell', 'value', 'yarn-radius', 'b'], ['yarn-radius', 'value', 'yarn', 'radius'],
  ['weave-clock', 'value', 'weave-scaled', 'a'], ['weave', 'value', 'weave-scaled', 'b'],
  ['weave-scaled', 'value', 'weave-progress-raw', 'a'], ['weave-rate', 'value', 'weave-progress-raw', 'b'],
  ['weave-progress-raw', 'value', 'weave-progress', 'a'], ['weave-one', 'value', 'weave-progress', 'b'],
  ['weave-progress', 'value', 'thread', 'progress'],
  ['hand-amount', 'value', 'hand-wobble-amplitude', 'a'], ['hand-wobble-scale', 'value', 'hand-wobble-amplitude', 'b'],
  ['hand-amount', 'value', 'hand-tension-amplitude', 'a'], ['hand-tension-scale', 'value', 'hand-tension-amplitude', 'b'],
  ['hand-wobble-amplitude', 'value', 'hand-wobble-x', 'amplitude'], ['hand-wobble-amplitude', 'value', 'hand-wobble-y', 'amplitude'],
  ['hand-info', 'u', 'hand-meander', 'a'], ['hand-meander-scale', 'value', 'hand-meander', 'b'],
  ['hand-meander', 'value', 'hand-meander-vector', 'x'], ['hand-thread-key', 'value', 'hand-meander-vector', 'y'], ['hand-zero', 'value', 'hand-meander-vector', 'z'],
  ['hand-meander-vector', 'value', 'hand-wobble-x', 'position'], ['hand-meander-vector', 'value', 'hand-wobble-y', 'position'],
  ['hand-info', 'strand', 'hand-thread-key', 'a'], ['hand-golden', 'value', 'hand-thread-key', 'b'],
  ['hand-thread-key', 'value', 'hand-thread-vector', 'x'], ['hand-zero', 'value', 'hand-thread-vector', 'y'], ['hand-zero', 'value', 'hand-thread-vector', 'z'],
  ['hand-thread-vector', 'value', 'hand-tension', 'position'], ['hand-tension-amplitude', 'value', 'hand-tension', 'amplitude'],
  ['hand-position', 'position', 'hand-split', 'value'], ['hand-split', 'z', 'hand-crimp', 'a'], ['hand-tension', 'value', 'hand-crimp', 'b'],
  ['hand-wobble-x', 'value', 'hand-offset', 'x'], ['hand-wobble-y', 'value', 'hand-offset', 'y'], ['hand-crimp', 'value', 'hand-offset', 'z'],
  ['hand-offset', 'value', 'hand-set', 'offset'],
  ['hand-info', 'u', 'hand-along', 'a'], ['hand-along-scale', 'value', 'hand-along', 'b'],
  ['hand-along', 'value', 'hand-slub-vector', 'x'], ['hand-thread-key', 'value', 'hand-slub-vector', 'y'], ['hand-zero', 'value', 'hand-slub-vector', 'z'],
  ['hand-slub-vector', 'value', 'hand-slub-noise', 'position'], ['hand-slub-noise', 'value', 'hand-slub', 'value'],
  ['hand-slub', 'value', 'hand-slub-amount', 'a'], ['hand-amount', 'value', 'hand-slub-amount', 'b'],
  ['hand-slub-amount', 'value', 'hand-swell', 'a'], ['hand-one', 'value', 'hand-swell', 'b'],
];

/**
 * Default Weave graph: a plain-woven sheet of fuzzy three-ply yarns with handmade irregularity
 * whose threads are pulled in over the first four seconds of the clip and billow in the wind.
 * Reveal (1 = fully grown), Weave Speed and Irregularity are keyframeable in the Effects tab;
 * bypassing Weave In shows the finished weave at once, Handmade a regular one, Yarn the bare
 * curves, Reveal by Shape the full sheet and Wind Cloth a flat one.
 */
export function createDefaultWeaveGraph(): EffectOperatorGraph {
  const specs = [...FABRIC_NODES, ...REVEAL_NODES, ...WEAVE_IN_NODES, ...HANDMADE_NODES, ...CLOTH_NODES];
  const nodes: BoundOperatorNode[] = specs.map(([id, operator, , , constants]) =>
    ({ id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants: { ...constants } } : {}) }));
  const reveal = nodes.find(node => node.id === 'reveal')!;
  reveal.bindings = { value: 'reveal_value' };
  reveal.exposed = { label: 'Reveal', min: 0, max: 1, step: 0.01 };
  const weave = nodes.find(node => node.id === 'weave')!;
  weave.bindings = { value: 'weave_value' };
  weave.exposed = { label: 'Weave Speed', min: 0, max: 10, step: 0.05 };
  const irregularity = nodes.find(node => node.id === 'hand-amount')!;
  irregularity.bindings = { value: 'irregularity_value' };
  irregularity.exposed = { label: 'Irregularity', min: 0, max: 3, step: 0.01 };
  return { version: 1, schemaVersion: 1, domain: 'geometry', nodes,
    edges: FABRIC_LINKS.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
    layout: Object.fromEntries(specs.map(([id, , x, y]) => [id, { x, y }])),
    groups: [{ id: 'reveal-by-shape', label: 'Reveal by Shape', color: '#5f9ea0', nodeIds: REVEAL_NODES.map(([id]) => id) },
      { id: 'weave-in', label: 'Weave In', color: '#b07fc8', nodeIds: WEAVE_IN_NODES.map(([id]) => id) },
      { id: 'handmade', label: 'Handmade', color: '#7fae6a', nodeIds: HANDMADE_NODES.map(([id]) => id) },
      { id: 'yarn', label: 'Yarn', color: '#c8a45a', nodeIds: ['yarn', 'yarn-radius', 'flyaways'] },
      { id: 'wind-cloth', label: 'Wind Cloth', color: '#6f8fc8', nodeIds: CLOTH_NODES.map(([id]) => id) }] };
}

export function validateWeaveGraph(graph: EffectOperatorGraph, allowIncomplete = false): string[] {
  const errors = validateEffectGraph(graph, allowIncomplete);
  const offered = new Set(geometryOwnerOperators().map(operator => operator.id));
  if (graph.domain !== 'geometry' || graph.nodes.some(node => node.operator !== 'scene.output' && !offered.has(node.operator))) {
    errors.push('Unsupported Weave operator graph.');
  }
  return errors;
}

export function weaveOperatorGraph(params: OperatorParameters): EffectOperatorGraph {
  const graph = readEffectGraph(params[EFFECT_GRAPH_PARAM], createDefaultWeaveGraph);
  const errors = validateWeaveGraph(graph, typeof graph.incomplete === 'string');
  if (errors.length) throw new Error(errors[0]);
  return graph;
}

/** Owner validation: structure first, then a full lowering with the effect's current values. */
export function assertWeaveGraph(graph: EffectOperatorGraph, params: OperatorParameters) {
  const errors = validateWeaveGraph(graph);
  if (errors.length) throw new Error(errors[0]);
  compileGeometryGraph(graph, geometryParameterReader(params));
}
