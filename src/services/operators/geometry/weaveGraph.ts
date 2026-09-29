import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorValue } from '../../../types/operatorGraph';
import type { Keyframe } from '../../../types/keyframes';
import { EFFECT_GRAPH_PARAM, readEffectGraph, sampleOperatorParameter, validateEffectGraph, type OperatorParameters } from '../effectGraph';
import { EFFECT_OPERATORS } from '../operatorRegistry';
import { pointwiseLoweringFor } from '../fields/pointwiseLowering';
import { isCurveOperator } from './curveOperators';
import { compileGeometryGraph, type GeometryParameterReader } from './geometryProgram';

export const WEAVE_EFFECT_TYPE = 'weave';
const FIELD_SIGNALS = new Set(['number', 'boolean', 'vec2', 'vec3', 'vec4']);

/** Pure per-element operators run per curve point; this is the shared family contract, not a Weave copy. */
const isCurveFieldOperator = (operator: OperatorDefinition) => !operator.composition
  && [...operator.inputs, ...operator.outputs].every(port => FIELD_SIGNALS.has(port.type))
  && operator.outputs.length > 0 && operator.outputs.every(port => pointwiseLoweringFor(operator.id, port.id));

let ownerOperators: OperatorDefinition[] | undefined;
/** Nodes a geometry graph offers: curve operators, values and every shared pointwise math/vector operator. */
export function geometryOwnerOperators(): OperatorDefinition[] {
  return ownerOperators ??= EFFECT_OPERATORS.filter(operator => operator.addable && (isCurveOperator(operator.id)
    || operator.id === 'values.number' || operator.id === 'values.integer' || isCurveFieldOperator(operator)));
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
  ['line', 'geometry.curve-line', 0, 80, { points: 2000, length: 2, axis: 'z' }],
  ['array', 'geometry.strand-array', 360, 80, { count: 8, spacing: 0.12, axis: 'x' }],
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
  ['side', 'value', 'offset', 'x'], ['over-under', 'value', 'offset', 'y'], ['zero', 'value', 'offset', 'z'],
  ['offset', 'value', 'set-position', 'offset'],
];

/**
 * Default Weave graph: parallel strands whose over/under wave alternates per strand.
 * The wave is ordinary Math nodes evaluated per curve point (the Houdini wrangle as nodes).
 */
export function createDefaultWeaveGraph(): EffectOperatorGraph {
  const specs = [...CHAIN_NODES, ...WAVE_NODES];
  const nodes: BoundOperatorNode[] = specs.map(([id, operator, , , constants]) =>
    ({ id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants: { ...constants } } : {}) }));
  return { version: 1, schemaVersion: 1, domain: 'geometry', nodes,
    edges: LINKS.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
    layout: Object.fromEntries(specs.map(([id, , x, y]) => [id, { x, y }])),
    groups: [{ id: 'wave-offset', label: 'Wave Offset', color: '#8a7fd1', nodeIds: WAVE_NODES.map(([id]) => id) }] };
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
