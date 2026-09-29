import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';
import { getEffectOperator } from '../operatorRegistry';
import { lowerPointwiseNode, pointwiseLoweringFor, type PointwiseInstruction } from '../fields/pointwiseLowering';
import type { PointwiseValueType } from '../fields/pointwiseOperations';
import { CURVE_POINT_LIMIT, CURVE_STRAND_LIMIT } from './curveOperators';

/** Context values a curve-point field can read, in addition to shared pointwise operations. */
export const CURVE_CONTEXT_OPERATIONS = ['position', 'curve-u', 'point-index', 'strand-index', 'point-count', 'strand-count'] as const;
const CURVE_INFO_OUTPUTS: Record<string, typeof CURVE_CONTEXT_OPERATIONS[number]> = {
  u: 'curve-u', point: 'point-index', strand: 'strand-index', points: 'point-count', strands: 'strand-count',
};
const FIELD_TYPES = new Set<PointwiseValueType>(['scalar', 'boolean', 'vec2', 'vec3', 'vec4']);

/** A per-point program: shared pointwise operations plus curve context and constants. */
export interface GeometryField { instructions: PointwiseInstruction[]; output: number }
export type CurveAxis = 0 | 1 | 2;
export type GeometryStage =
  | { kind: 'curve-line'; nodeId: string; points: number; length: number; axis: CurveAxis }
  | { kind: 'strand-array'; nodeId: string; count: number; spacing: number; axis: CurveAxis }
  | { kind: 'set-position'; nodeId: string; position?: GeometryField; offset?: GeometryField };
export interface GeometryStrandRender { nodeId: string; width: number; color: string }
export interface GeometryProgram { stages: GeometryStage[]; render?: GeometryStrandRender; pointCount: number; strandCount: number }
/** Resolves a node parameter (literal, effect parameter or keyframed value) for the evaluation time. */
export type GeometryParameterReader = (node: BoundOperatorNode, parameter: string) => OperatorValue;

const axisIndex = (value: OperatorValue): CurveAxis => value === 'x' ? 0 : value === 'y' ? 1 : 2;
const finite = (value: OperatorValue, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
};

/**
 * Lowers a geometry graph. With `target`, only the curve chain feeding that node's
 * curves output is compiled (node previews); otherwise the chain feeding `scene.output`.
 */
export function compileGeometryGraph(graph: EffectOperatorGraph, read: GeometryParameterReader, target?: string): GeometryProgram {
  if (graph.domain !== 'geometry') throw new Error('Expected a geometry operator graph.');
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const sourceOf = (node: BoundOperatorNode, input: string) => {
    const edge = graph.edges.find(item => item.to === node.id && item.input === input);
    return edge ? { node: nodes.get(edge.from)!, output: edge.output } : undefined;
  };
  const required = (node: BoundOperatorNode, input: string) => {
    const linked = sourceOf(node, input);
    if (!linked) throw new Error(`${getEffectOperator(node.operator)?.label ?? node.operator}: connect ${input}.`);
    return linked;
  };
  let render: GeometryStrandRender | undefined;
  let head: BoundOperatorNode | undefined;
  if (target) head = nodes.get(target);
  else {
    const output = graph.nodes.find(node => node.operator === 'scene.output');
    if (!output) throw new Error('The geometry graph needs a Scene Output.');
    const renderNode = required(output, 'scene').node;
    if (renderNode.operator !== 'render.strands') throw new Error('Scene Output must be fed by Strand Render.');
    if (!renderNode.bypassed) render = { nodeId: renderNode.id, width: Math.max(0, finite(read(renderNode, 'width'), 'Strand width')),
      color: String(read(renderNode, 'color')) };
    head = required(renderNode, 'curves').node;
  }
  const chain: BoundOperatorNode[] = [];
  for (let node = head; node;) {
    if (chain.includes(node)) throw new Error('Cycles are not supported.');
    chain.push(node);
    if (node.operator === 'geometry.curve-line') break;
    if (node.operator !== 'geometry.strand-array' && node.operator !== 'geometry.set-position') {
      throw new Error(`${getEffectOperator(node.operator)?.label ?? node.operator} does not produce curves.`);
    }
    node = required(node, 'curves').node;
  }
  if (!chain.length) throw new Error('The geometry node is unavailable.');
  const stages: GeometryStage[] = [];
  for (const node of chain.toReversed()) {
    if (node.bypassed && node.operator !== 'geometry.curve-line') continue;
    if (node.operator === 'geometry.curve-line') {
      stages.push({ kind: 'curve-line', nodeId: node.id, points: Math.round(finite(read(node, 'points'), 'Curve points')),
        length: finite(read(node, 'length'), 'Curve length'), axis: axisIndex(read(node, 'axis')) });
    } else if (node.operator === 'geometry.strand-array') {
      stages.push({ kind: 'strand-array', nodeId: node.id, count: Math.round(finite(read(node, 'count'), 'Strand count')),
        spacing: finite(read(node, 'spacing'), 'Strand spacing'), axis: axisIndex(read(node, 'axis')) });
    } else {
      const position = compileField(node, 'position'), offset = compileField(node, 'offset');
      stages.push({ kind: 'set-position', nodeId: node.id, ...(position ? { position } : {}), ...(offset ? { offset } : {}) });
    }
  }
  let pointCount = 0, strandCount = 0;
  for (const stage of stages) {
    if (stage.kind === 'curve-line') {
      if (stage.points < 2) throw new Error('A curve needs at least two points.');
      pointCount = stage.points; strandCount = 1;
    } else if (stage.kind === 'strand-array') {
      if (stage.count < 1) throw new Error('Strand Array needs a count of at least one.');
      pointCount *= stage.count; strandCount *= stage.count;
    }
  }
  if (pointCount > CURVE_POINT_LIMIT || strandCount > CURVE_STRAND_LIMIT) {
    throw new Error(`Geometry exceeds ${CURVE_POINT_LIMIT.toLocaleString('en-US')} points or ${CURVE_STRAND_LIMIT.toLocaleString('en-US')} curves.`);
  }
  return { stages, ...(render ? { render } : {}), pointCount, strandCount };

  function compileField(owner: BoundOperatorNode, input: string): GeometryField | undefined {
    const linked = sourceOf(owner, input);
    if (!linked) return undefined;
    const instructions: PointwiseInstruction[] = [], registers = new Map<string, number>(), visiting = new Set<string>();
    const emit = (instruction: PointwiseInstruction) => instructions.push(instruction) - 1;
    const visit = (node: BoundOperatorNode, output: string): number => {
      const key = `${node.id}:${output}`, cached = registers.get(key);
      if (cached !== undefined) return cached;
      if (visiting.has(key)) throw new Error('Cycles are not supported.');
      visiting.add(key);
      let register: number;
      const rule = pointwiseLoweringFor(node.operator, output);
      if (rule) {
        if (!FIELD_TYPES.has(rule.type)) throw new Error(`${getEffectOperator(node.operator)?.label ?? node.operator} is not available for curve points.`);
        register = lowerPointwiseNode(rule, node, id => { const linked = required(node, id); return visit(linked.node, linked.output); }, emit);
      } else if (node.operator === 'values.number' || node.operator === 'values.integer') {
        register = emit({ nodeId: node.id, operation: 'constant', type: 'scalar', inputs: [], value: finite(read(node, 'value'), 'Value') });
        if (node.operator === 'values.integer') register = emit({ nodeId: node.id, operation: 'trunc-scalar', type: 'scalar', inputs: [register] });
      } else if (node.operator === 'geometry.position') {
        register = emit({ nodeId: node.id, operation: 'position', type: 'vec3', inputs: [] });
      } else if (node.operator === 'geometry.curve-info' && CURVE_INFO_OUTPUTS[output]) {
        register = emit({ nodeId: node.id, operation: CURVE_INFO_OUTPUTS[output], type: 'scalar', inputs: [] });
      } else throw new Error(`${getEffectOperator(node.operator)?.label ?? node.operator} cannot be evaluated per curve point.`);
      visiting.delete(key); registers.set(key, register);
      return register;
    };
    const output = visit(linked.node, linked.output);
    if (instructions[output].type !== 'vec3') throw new Error(`${getEffectOperator(owner.operator)?.label}: ${input} needs a Vector 3.`);
    return { instructions, output };
  }
}
