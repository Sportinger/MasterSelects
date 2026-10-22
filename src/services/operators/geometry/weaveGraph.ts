import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorValue } from '../../../types/operatorGraph';
import type { Keyframe } from '../../../types/keyframes';
import { EFFECT_GRAPH_PARAM, readEffectGraph, sampleOperatorParameter, validateEffectGraph, type OperatorParameters } from '../effectGraph';
import { EFFECT_OPERATORS } from '../operatorRegistry';
import { pointwiseLoweringFor } from '../fields/pointwiseLowering';
import { isCurveOperator } from './curveOperators';
import { compileGeometryGraph, type GeometryParameterReader } from './geometryProgram';
import { SIMULATION_TRACK_LIMIT, SIMULATION_TRACK_RATE, type SimulationTrack } from './simulationForces';
import { createQualleGraph } from './qualleGraph';
import { expandOperatorCompositions } from '../operatorComposition';

export const WEAVE_EFFECT_TYPE = 'weave';
/** Fibre colour of a new Woven Cloth (the card's Color default). */
export const WEAVE_CLOTH_COLOR = '#8a857c';
/** Wind strength of a new Woven Cloth (the card's Wind default). */
export const WEAVE_CLOTH_WIND = 0.35;
/**
 * Turn: Cloth Sheet turns the finished sheet 32° about its upright axis, so the camera sees it at
 * three quarters. Head-on, the wind's bellying runs straight at the camera and hardly shows;
 * turned, it bows the threads sideways and the gusts read as motion. Saved Weaves have no Turn on
 * their Cloth Sheet and stay head-on (the parameter's default 0).
 */
export const WEAVE_CLOTH_TURN = 32;
const FIELD_SIGNALS = new Set(['number', 'boolean', 'vec2', 'vec3', 'vec4']);
/** Shared force nodes Cloth Sheet and Rod Simulation read (the same identities cables and particles use). */
const SIMULATION_FORCE_OPERATORS = ['forces.wind', 'forces.gravity', 'forces.turbulence', 'forces.drag'];

/** Pure per-element operators run per curve point; this is the shared family contract, not a Weave copy. */
const isCurveFieldOperator = (operator: OperatorDefinition) => !operator.composition
  && [...operator.inputs, ...operator.outputs].every(port => FIELD_SIGNALS.has(port.type))
  && operator.outputs.length > 0 && operator.outputs.every(port => pointwiseLoweringFor(operator.id, port.id));

let ownerOperators: OperatorDefinition[] | undefined;
/** Nodes a geometry graph offers: curve operators, values and every shared pointwise math/vector operator. */
export function geometryOwnerOperators(): OperatorDefinition[] {
  return ownerOperators ??= EFFECT_OPERATORS.filter(operator => operator.addable && (isCurveOperator(operator.id)
    || operator.composition?.graph.domain === 'geometry'
    || ['values.number', 'values.integer', 'image.timeline-time', ...SIMULATION_FORCE_OPERATORS].includes(operator.id) || isCurveFieldOperator(operator)));
}

/** Reads literal node values, effect-bound values and their keyframes at `time`. */
export function geometryParameterReader(params: OperatorParameters, effectId = '', keys: Keyframe[] = [], time = 0,
  clock: SimulationClock = IDENTITY_CLOCK): GeometryParameterReader {
  // A bound value missing from the params (a Weave saved before the parameter was bound) renders the
  // node's own value, not the operator default (Wind would otherwise blow at 5 instead of 0.35).
  const filledFor = (node: BoundOperatorNode, parameter: string) => {
    const binding = node.bindings[parameter], own = node.constants?.[parameter];
    return typeof binding === 'string' && params[binding] === undefined && own !== undefined ? { ...params, [binding]: own } : params;
  };
  const read: GeometryParameterReader = (node, parameter) => sampleOperatorParameter(node, parameter, filledFor(node, parameter), effectId, keys, time);
  read.track = (node, parameter) => {
    const binding = node.bindings[parameter];
    if (typeof binding !== 'string') return undefined;
    const property = `effect.${effectId}.${binding}`, own = keys.filter(key => key.property === property), times = own.map(key => key.time);
    if (times.length < 2) return undefined;
    // The same keys, base value and clip timing give the same track: computed once, not per frame.
    const cacheKey = JSON.stringify([property, own, filledFor(node, parameter)[binding] ?? null, clock.toSimulation(0), clock.toSimulation(1)]);
    const cached = trackCache.get(cacheKey);
    if (cached) return cached;
    const ends = [Math.min(...times), Math.max(...times)].map(clock.toSimulation), start = Math.min(...ends), span = Math.max(...ends) - start;
    if (!Number.isFinite(start) || !Number.isFinite(span)) return undefined;
    const rate = span > 0 ? Math.min(SIMULATION_TRACK_RATE, (SIMULATION_TRACK_LIMIT - 1) / span) : SIMULATION_TRACK_RATE;
    const filled = filledFor(node, parameter), count = Math.min(SIMULATION_TRACK_LIMIT, Math.ceil(span * rate - 1e-9) + 1);
    const values = Array.from({ length: count }, (_, index) => {
      const clipTime = clock.toClip(Math.min(start + span, start + index / rate));
      return Number(sampleOperatorParameter(node, parameter, filled, effectId, keys, clipTime ?? time));
    });
    const track = { start, rate, values };
    if (trackCache.size >= 16) trackCache.delete(trackCache.keys().next().value!);
    trackCache.set(cacheKey, track);
    return track;
  };
  return read;
}
const trackCache = new Map<string, SimulationTrack>();

/** How a clip's keyframe time (clip-local seconds) maps to the source time its simulations run on. */
export interface SimulationClock { toSimulation(clipTime: number): number; toClip(simulationTime: number): number | null }
const IDENTITY_CLOCK: SimulationClock = { toSimulation: time => time, toClip: time => time };

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

// New Weaves start as a smaller sheet (about two thirds of the frame width, three fifths of its height)
// in a softer, darker wool, so the clip under it stays readable; its 40 × 24 cloth cells are square
// (0.04 × 0.04). Saved Weaves store their graph and keep their look (the 2.4 × 1.6 sheet with
// 24 × 16 threads in preset wool and a 40 × 27 cloth).
const FABRIC_NODES: Spec[] = [
  ['pattern', 'weave.pattern', 0, 80, { pattern: 'plain', warps: 16, wefts: 10, width: 1.6, height: 0.96, crimp: 0.03, resolution: 16 }],
  ['yarn', 'geometry.yarn-profile', 1320, 80, { plies: 3, fibers: 5, radius: 0.028, plyTwist: 5, fiberTwist: -11 }],
  ['yarn-radius', 'math.multiply.scalar', 1320, 300],
  ['render', 'render.strands', 2600, 80, { width: 0.0035, color: '#e8e2d6' }],
  ['output', 'scene.output', 2920, 80],
  ['flyaways', 'geometry.flyaways', 1640, 80, { density: 3, length: 0.08, lift: 2.5, hair: 0.35, seed: 0 }],
  ['fiber', 'material.fiber', 1960, 80, { preset: 'custom', color: WEAVE_CLOTH_COLOR }],
];
/** Wind Cloth: the woven sheet is held at its corners and billows like a sail in gusty, swirling wind (no gravity), turned towards the camera. */
const CLOTH_NODES: Spec[] = [
  ['wind', 'forces.wind', 1320, 620, { direction: [0.2, 0, 1], strength: WEAVE_CLOTH_WIND, gust: 0.5 }],
  ['swirl', 'forces.turbulence', 1320, 860, { strength: 0.15, frequency: 1.5 }],
  ['cloth', 'geometry.cloth-sheet', 1640, 620, { columns: 40, rows: 24, width: 1.6, height: 0.96, pin: 'corners', stretch: 0.9, bend: 0.6,
    damping: 0.5, substeps: 6, preroll: 2, turn: WEAVE_CLOTH_TURN }],
  ['bind', 'geometry.surface-bind', 2280, 80, { height: 1 }],
];
/**
 * Reveal by Shape: a growing sphere with a noisy front scales the yarn radius (0 hides, >1 swells the front).
 * Reach is the sphere radius at Reveal 1: just past the sheet's corners (half diagonal 0.93, noise 0.08,
 * edge 0.12), so the whole range of Reveal grows the net. 1.7 fitted the earlier, larger sheet and left
 * Reveal above 0.55 without effect on this one.
 */
const REVEAL_NODES: Spec[] = [
  ['reveal', 'values.number', 0, 380], ['reach', 'values.number', 0, 520, { value: 1.15 }],
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
 * 1 is the default look, 0 a machine-perfect weave. Meander and tension grow with the square of
 * Irregularity, so 1 keeps the familiar look and 3 is clearly crooked (nine times the meander,
 * about two thirds of the thread spacing) instead of a slightly fuzzier grid.
 */
const HANDMADE_NODES: Spec[] = [
  ['hand-amount', 'values.number', 0, 1400, { value: 1 }], ['hand-amount-squared', 'math.multiply.scalar', 130, 1300],
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
  ['yarn', 'curves', 'flyaways', 'curves'], ['flyaways', 'curves', 'fiber', 'curves'], ['fiber', 'curves', 'bind', 'curves'],
  ['bind', 'curves', 'render', 'curves'], ['render', 'scene', 'output', 'scene'],
  ['wind', 'force', 'cloth', 'forces'], ['swirl', 'force', 'cloth', 'forces'], ['cloth', 'surface', 'bind', 'surface'],
  ['reveal', 'value', 'reveal-radius', 'a'], ['reach', 'value', 'reveal-radius', 'b'], ['reveal-radius', 'value', 'reveal-shape', 'size'],
  ['reveal-shape', 'value', 'reveal-edge', 'a'], ['reveal-noise', 'value', 'reveal-edge', 'b'], ['reveal-edge', 'value', 'reveal-ramp', 'value'],
  ['reveal-ramp', 'value', 'yarn-radius', 'a'], ['hand-swell', 'value', 'yarn-radius', 'b'], ['yarn-radius', 'value', 'yarn', 'radius'],
  ['weave-clock', 'value', 'weave-scaled', 'a'], ['weave', 'value', 'weave-scaled', 'b'],
  ['weave-scaled', 'value', 'weave-progress-raw', 'a'], ['weave-rate', 'value', 'weave-progress-raw', 'b'],
  ['weave-progress-raw', 'value', 'weave-progress', 'a'], ['weave-one', 'value', 'weave-progress', 'b'],
  ['weave-progress', 'value', 'thread', 'progress'],
  ['hand-amount', 'value', 'hand-amount-squared', 'a'], ['hand-amount', 'value', 'hand-amount-squared', 'b'],
  ['hand-amount-squared', 'value', 'hand-wobble-amplitude', 'a'], ['hand-wobble-scale', 'value', 'hand-wobble-amplitude', 'b'],
  ['hand-amount-squared', 'value', 'hand-tension-amplitude', 'a'], ['hand-tension-scale', 'value', 'hand-tension-amplitude', 'b'],
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
 * Default Weave graph: a plain-woven sheet of fuzzy three-ply wool yarns (Fiber Material, preset Wool) with handmade irregularity
 * whose threads are pulled in over the first four seconds of the clip and billow in the wind.
 * Reveal (1 = fully grown), Weave Speed and Irregularity are keyframeable in the Effects tab;
 * bypassing Weave In shows the finished weave at once, Handmade a regular one, Yarn the bare
 * curves, Reveal by Shape the full sheet and Wind Cloth a flat, head-on one.
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
  // Named graph-local values, so their cards read as what they are in the Nodes tab.
  for (const [id, label, min, max] of [['reach', 'Reach', 0, 3], ['weave-rate', 'Weave Rate', 0, 2], ['weave-one', 'Finished', 0, 1],
    ['hand-wobble-scale', 'Wobble Scale', 0, 0.05]] as const) {
    nodes.find(node => node.id === id)!.valueControl = { label, min, max, step: 0.01 };
  }
  // Wind and Color are card controls bound straight to their node parameters (a simulation reads its
  // force values from the node, so Wind has no Value node).
  nodes.find(node => node.id === 'wind')!.bindings = { strength: 'wind' };
  nodes.find(node => node.id === 'fiber')!.bindings = { color: 'color' };
  return { version: 1, schemaVersion: 1, domain: 'geometry', nodes,
    edges: FABRIC_LINKS.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
    layout: Object.fromEntries(specs.map(([id, , x, y]) => [id, { x, y }])),
    groups: [{ id: 'reveal-by-shape', label: 'Reveal by Shape', color: '#5f9ea0', nodeIds: REVEAL_NODES.map(([id]) => id) },
      { id: 'weave-in', label: 'Weave In', color: '#b07fc8', nodeIds: WEAVE_IN_NODES.map(([id]) => id) },
      { id: 'handmade', label: 'Handmade', color: '#7fae6a', nodeIds: HANDMADE_NODES.map(([id]) => id) },
      { id: 'yarn', label: 'Yarn', color: '#c8a45a', nodeIds: ['yarn', 'yarn-radius', 'flyaways', 'fiber'] },
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

/** The forms of a Weave without an edited graph (the card's Form); each is a recipe graph. */
export const WEAVE_FORMS = ['cloth', 'qualle'] as const;
export type WeaveForm = typeof WEAVE_FORMS[number];
const WEAVE_RECIPES: Record<WeaveForm, () => EffectOperatorGraph> = { cloth: createDefaultWeaveGraph, qualle: createQualleGraph };

/** The recipe graph of a Form; an unknown or missing Form (saved before Form existed) is the Woven Cloth. */
export function weaveRecipeGraph(form: unknown): EffectOperatorGraph {
  return (WEAVE_RECIPES[form as WeaveForm] ?? createDefaultWeaveGraph)();
}

/**
 * What a graph draws, without its layout, labels and folding: nodes with their operator, values and
 * bindings, the cables, and which nodes and folders are switched off. Compositions are expanded, so a
 * graph saved in packed form compares equal to the recipe it was saved from.
 */
function weaveGraphSignature(graph: EffectOperatorGraph): string {
  const sorted = (value: Record<string, unknown> | undefined) => JSON.stringify(Object.entries(value ?? {}).toSorted(([a], [b]) => a.localeCompare(b)));
  const expanded = expandOperatorCompositions(graph);
  return JSON.stringify([
    expanded.nodes.map(node => [node.id, node.operator, sorted(node.constants), sorted(node.bindings), !!node.bypassed, node.enabled ?? '',
      node.exposed ? [node.exposed.label, node.exposed.min, node.exposed.max] : ''].join('|')).toSorted(),
    expanded.edges.map(edge => `${edge.from}.${edge.output}>${edge.to}.${edge.input}`).toSorted(),
    (expanded.groups ?? []).filter(group => group.bypassed).map(group => group.id).toSorted(),
  ]);
}
let recipeSignatures: Map<string, WeaveForm> | undefined;
const recipeFormByGraph = new WeakMap<EffectOperatorGraph, WeaveForm | null>();
/**
 * The Form whose current recipe a stored graph is, or undefined for a graph edited in the Nodes tab
 * (or the recipe of an earlier version). Saving pins every Weave to the graph it renders; a pinned
 * recipe still follows Form, so Form keeps working after a save, an undo or a reload, while a Weave
 * saved with an earlier recipe keeps its own look.
 */
export function weaveRecipeForm(graph: EffectOperatorGraph): WeaveForm | undefined {
  let form = recipeFormByGraph.get(graph);
  if (form === undefined) {
    recipeSignatures ??= new Map(WEAVE_FORMS.map(candidate => [weaveGraphSignature(weaveRecipeGraph(candidate)), candidate]));
    form = graph.incomplete ? null : recipeSignatures.get(weaveGraphSignature(graph)) ?? null;
    recipeFormByGraph.set(graph, form);
  }
  return form ?? undefined;
}

let recipeBindings: ReadonlySet<string> | undefined;
const editedBindings = new WeakMap<EffectOperatorGraph, ReadonlySet<string>>();
const boundKeys = (graph: EffectOperatorGraph) => graph.nodes.flatMap(node => Object.values(node.bindings)
  .filter((binding): binding is string => typeof binding === 'string'));
/**
 * Effect parameters a Weave acts on. Without an edited graph that is Form and every parameter its
 * recipes bind (the card dims the rows of the other Form); an edited graph decides alone, so Form
 * and the controls it no longer binds leave the card.
 */
export function weaveBoundParameters(params: OperatorParameters, edited: EffectOperatorGraph | undefined): ReadonlySet<string> {
  if (edited && !weaveRecipeForm(edited)) {
    let keys = editedBindings.get(edited);
    if (!keys) editedBindings.set(edited, keys = new Set(boundKeys(edited)));
    return keys;
  }
  if (!edited && params[EFFECT_GRAPH_PARAM] !== undefined) return new Set(boundKeys(weaveOperatorGraph(params)));
  return recipeBindings ??= new Set(['form', ...WEAVE_FORMS.flatMap(form => boundKeys(weaveRecipeGraph(form)))]);
}

const storedRecipeForms = new Map<string, WeaveForm | null>();
export function weaveOperatorGraph(params: OperatorParameters): EffectOperatorGraph {
  const stored = params[EFFECT_GRAPH_PARAM];
  const graph = readEffectGraph(stored, () => weaveRecipeGraph(params.form));
  const errors = validateWeaveGraph(graph, typeof graph.incomplete === 'string');
  if (errors.length) throw new Error(errors[0]);
  if (typeof stored !== 'string' || stored === '') return graph;
  // A saved recipe follows Form (weaveRecipeForm); the last few stored graphs are remembered by their text.
  let form = storedRecipeForms.get(stored);
  if (form === undefined) {
    form = weaveRecipeForm(graph) ?? null;
    if (storedRecipeForms.size >= 8) storedRecipeForms.delete(storedRecipeForms.keys().next().value!);
    storedRecipeForms.set(stored, form);
  }
  // The stored graph itself while it is the recipe of the current Form, so the Nodes tab keeps what
  // the recipe signature leaves out (layout, folder names and folding, value ranges); a fresh recipe
  // only when Form changed.
  return form && form !== weaveForm(params.form) ? weaveRecipeGraph(params.form) : graph;
}

/** The Form a value names; an unknown or missing Form is the Woven Cloth (weaveRecipeGraph). */
export function weaveForm(value: unknown): WeaveForm {
  return (WEAVE_FORMS as readonly unknown[]).includes(value) ? value as WeaveForm : 'cloth';
}

/** Owner validation: structure first, then a full lowering with the effect's current values. */
export function assertWeaveGraph(graph: EffectOperatorGraph, params: OperatorParameters) {
  const errors = validateWeaveGraph(graph);
  if (errors.length) throw new Error(errors[0]);
  compileGeometryGraph(graph, geometryParameterReader(params));
}
