import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';
import { getEffectOperator } from '../operatorRegistry';
import { applyOperatorGroupBypasses } from '../operatorGroupBypass';
import { lowerPointwiseNode, pointwiseLoweringFor, type PointwiseInstruction } from '../fields/pointwiseLowering';
import { pointwiseOperation, type PointwiseValueType } from '../fields/pointwiseOperations';
import { CURVE_POINT_LIMIT, CURVE_STRAND_LIMIT } from './curveOperators';
import { WEAVE_PATTERNS } from './weaveOperators';
import { compileClothSpec, type ClothSpec } from './clothProgram';

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
  | { kind: 'weave-pattern'; nodeId: string; pattern: number; warps: number; wefts: number; width: number; height: number;
      crimp: number; resolution: number }
  | { kind: 'strand-array'; nodeId: string; count: number; spacing: number; axis: CurveAxis }
  | { kind: 'set-position'; nodeId: string; position?: GeometryField; offset?: GeometryField }
  | { kind: 'yarn-profile'; nodeId: string; radius?: GeometryField }
  /** Curves on the cloth simulated by `cloth` at source time `time` (seconds). */
  | { kind: 'surface-bind'; nodeId: string; height: number; cloth: ClothSpec; time: number };
/** Render-time yarn: plies around the curve and fibers around each ply, twisted along curve length. */
export interface YarnProfile { plies: number; fibers: number; radius: number; plyTwist: number; fiberTwist: number }
/**
 * Render-time stray fibers of a yarn: Density per unit curve length, each spanning Length along the
 * curve and rising Lift yarn radii off its surface; a Hair fraction ends free at the peak.
 */
export interface YarnFlyaways { density: number; length: number; lift: number; hair: number; seed: number }
export interface GeometryStrandRender { nodeId: string; width: number; color: string; profile?: YarnProfile; flyaways?: YarnFlyaways }
export interface GeometryProgram { stages: GeometryStage[]; render?: GeometryStrandRender; pointCount: number; strandCount: number }
/** Resolves a node parameter (literal, effect parameter or keyframed value) for the evaluation time. */
export type GeometryParameterReader = (node: BoundOperatorNode, parameter: string) => OperatorValue;

const GENERATORS = new Set(['geometry.curve-line', 'weave.pattern']);
const MODIFIERS = new Set(['geometry.strand-array', 'geometry.set-position', 'geometry.yarn-profile', 'geometry.flyaways', 'geometry.surface-bind']);
/** Every warp crosses every weft; each thread has `resolution` points per crossing plus its end. */
export const weavePatternPointCount = (stage: { warps: number; wefts: number; resolution: number }) =>
  stage.warps * (stage.wefts * stage.resolution + 1) + stage.wefts * (stage.warps * stage.resolution + 1);
const constant = (nodeId: string, value: number): PointwiseInstruction => ({ nodeId, operation: 'constant', type: 'scalar', inputs: [], value });

/**
 * Scalar operations whose inputs are all constants are evaluated once while lowering. A field
 * driven by a clock that has settled (for example min(time / duration, 1)) then compiles to the
 * same program every frame, and time-independent curves stay cached.
 */
function foldConstant(instruction: PointwiseInstruction, instructions: readonly PointwiseInstruction[]): PointwiseInstruction {
  if (instruction.type !== 'scalar' || !instruction.inputs.length || !instruction.inputs.every(input => instructions[input].operation === 'constant')) return instruction;
  const operation = pointwiseOperation(instruction.operation);
  const value = operation?.evaluate(instruction.inputs.map(input => instructions[input].value ?? 0), instruction.value);
  return typeof value === 'number' && Number.isFinite(value) ? constant(instruction.nodeId, value) : instruction;
}

/** Drops instructions the output no longer reads (folded operands) and renumbers the rest in order. */
function pruneField(field: GeometryField): GeometryField {
  const used = new Set<number>(), pending = [field.output];
  while (pending.length) {
    const index = pending.pop()!;
    if (used.has(index)) continue;
    used.add(index);
    pending.push(...field.instructions[index].inputs);
  }
  const remap = new Map<number, number>(), instructions: PointwiseInstruction[] = [];
  field.instructions.forEach((instruction, index) => {
    if (!used.has(index)) return;
    remap.set(index, instructions.length);
    instructions.push({ ...instruction, inputs: instruction.inputs.map(input => remap.get(input)!) });
  });
  return { instructions, output: remap.get(field.output)! };
}

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
/**
 * Frame context of a lowering: `time` is the composition time read by Time nodes, `simulationTime`
 * the source time of the host clip that drives cloth (seconds).
 */
export interface GeometryCompileContext { time?: number; simulationTime?: number }

export function compileGeometryGraph(graph: EffectOperatorGraph, read: GeometryParameterReader, target?: string,
  context: GeometryCompileContext = {}): GeometryProgram {
  if (graph.domain !== 'geometry') throw new Error('Expected a geometry operator graph.');
  graph = applyOperatorGroupBypasses(graph);
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
    if (GENERATORS.has(node.operator)) break;
    if (!MODIFIERS.has(node.operator)) {
      throw new Error(`${getEffectOperator(node.operator)?.label ?? node.operator} does not produce curves.`);
    }
    node = required(node, 'curves').node;
  }
  if (!chain.length) throw new Error('The geometry node is unavailable.');
  const stages: GeometryStage[] = [];
  let profile: YarnProfile | undefined, flyaways: YarnFlyaways | undefined;
  for (const node of chain.toReversed()) {
    if (node.bypassed && !GENERATORS.has(node.operator)) continue;
    if (node.operator === 'weave.pattern') {
      const pattern = WEAVE_PATTERNS.indexOf(String(read(node, 'pattern')) as typeof WEAVE_PATTERNS[number]);
      stages.push({ kind: 'weave-pattern', nodeId: node.id, pattern: Math.max(0, pattern),
        warps: Math.round(finite(read(node, 'warps'), 'Warp threads')), wefts: Math.round(finite(read(node, 'wefts'), 'Weft threads')),
        width: finite(read(node, 'width'), 'Weave width'), height: finite(read(node, 'height'), 'Weave height'),
        crimp: finite(read(node, 'crimp'), 'Crimp'), resolution: Math.round(finite(read(node, 'resolution'), 'Points per crossing')) });
    } else if (node.operator === 'geometry.yarn-profile') {
      const radius = compileField(node, 'radius', 'scalar');
      stages.push({ kind: 'yarn-profile', nodeId: node.id, ...(radius ? { radius } : {}) });
      profile = { plies: Math.round(finite(read(node, 'plies'), 'Plies')), fibers: Math.round(finite(read(node, 'fibers'), 'Fibers')),
        radius: Math.max(0, finite(read(node, 'radius'), 'Yarn radius')), plyTwist: finite(read(node, 'plyTwist'), 'Ply twist'),
        fiberTwist: finite(read(node, 'fiberTwist'), 'Fiber twist') };
      if (profile.plies < 1 || profile.fibers < 1 || profile.plies * profile.fibers > 256) throw new Error('Yarn Profile allows 1 to 256 fibers per yarn.');
    } else if (node.operator === 'geometry.surface-bind') {
      const cloth = required(node, 'surface').node;
      if (cloth.operator !== 'geometry.cloth-sheet') throw new Error('Surface Bind needs a Cloth Sheet.');
      // A muted sheet leaves the curves on the flat rest sheet.
      if (!cloth.bypassed) stages.push({ kind: 'surface-bind', nodeId: node.id, height: finite(read(node, 'height'), 'Height scale'),
        cloth: compileClothSpec(graph, cloth, read), time: Number.isFinite(context.simulationTime) ? context.simulationTime! : 0 });
    } else if (node.operator === 'geometry.flyaways') {
      flyaways = { density: Math.max(0, finite(read(node, 'density'), 'Flyaway density')),
        length: Math.max(0.001, finite(read(node, 'length'), 'Flyaway length')), lift: Math.max(0, finite(read(node, 'lift'), 'Flyaway lift')),
        hair: Math.min(1, Math.max(0, finite(read(node, 'hair'), 'Free ends'))), seed: Math.round(finite(read(node, 'seed'), 'Seed')) };
    } else if (node.operator === 'geometry.curve-line') {
      stages.push({ kind: 'curve-line', nodeId: node.id, points: Math.round(finite(read(node, 'points'), 'Curve points')),
        length: finite(read(node, 'length'), 'Curve length'), axis: axisIndex(read(node, 'axis')) });
    } else if (node.operator === 'geometry.strand-array') {
      stages.push({ kind: 'strand-array', nodeId: node.id, count: Math.round(finite(read(node, 'count'), 'Strand count')),
        spacing: finite(read(node, 'spacing'), 'Strand spacing'), axis: axisIndex(read(node, 'axis')) });
    } else {
      const position = compileField(node, 'position', 'vec3'), offset = compileField(node, 'offset', 'vec3');
      stages.push({ kind: 'set-position', nodeId: node.id, ...(position ? { position } : {}), ...(offset ? { offset } : {}) });
    }
  }
  let pointCount = 0, strandCount = 0;
  for (const stage of stages) {
    if (stage.kind === 'curve-line') {
      if (stage.points < 2) throw new Error('A curve needs at least two points.');
      pointCount = stage.points; strandCount = 1;
    } else if (stage.kind === 'weave-pattern') {
      if (stage.warps < 1 || stage.wefts < 1 || stage.resolution < 2) throw new Error('Weave Pattern needs threads in both directions.');
      pointCount = weavePatternPointCount(stage); strandCount = stage.warps + stage.wefts;
    } else if (stage.kind === 'strand-array') {
      if (stage.count < 1) throw new Error('Strand Array needs a count of at least one.');
      pointCount *= stage.count; strandCount *= stage.count;
    }
  }
  if (pointCount > CURVE_POINT_LIMIT || strandCount > CURVE_STRAND_LIMIT) {
    throw new Error(`Geometry exceeds ${CURVE_POINT_LIMIT.toLocaleString('en-US')} points or ${CURVE_STRAND_LIMIT.toLocaleString('en-US')} curves.`);
  }
  if (render && profile) {
    render.profile = profile;
    // Flyaways leave the yarn surface, so they need a profile to leave from.
    if (flyaways && flyaways.density > 0) render.flyaways = flyaways;
  }
  return { stages, ...(render ? { render } : {}), pointCount, strandCount };

  function compileField(owner: BoundOperatorNode, input: string, type: 'vec3' | 'scalar'): GeometryField | undefined {
    const linked = sourceOf(owner, input);
    if (!linked) return undefined;
    const instructions: PointwiseInstruction[] = [], registers = new Map<string, number>(), visiting = new Set<string>();
    const emit = (instruction: PointwiseInstruction) => instructions.push(foldConstant(instruction, instructions)) - 1;
    const visit = (node: BoundOperatorNode, output: string): number => {
      const key = `${node.id}:${output}`, cached = registers.get(key);
      if (cached !== undefined) return cached;
      if (visiting.has(key)) throw new Error('Cycles are not supported.');
      visiting.add(key);
      let register: number;
      const rule = pointwiseLoweringFor(node.operator, output);
      if (rule) {
        if (!FIELD_TYPES.has(rule.type)) throw new Error(`${getEffectOperator(node.operator)?.label ?? node.operator} is not available for curve points.`);
        register = lowerPointwiseNode(rule, node, id => {
          const linked = sourceOf(node, id), fallback = rule.defaults?.[id];
          if (linked || !fallback) { const source = linked ?? required(node, id); return visit(source.node, source.output); }
          if ('context' in fallback) return emit({ nodeId: node.id, operation: 'position', type: 'vec3', inputs: [] });
          return 'constant' in fallback ? emit(constant(node.id, fallback.constant)) : literal(node, fallback.parameter);
        }, emit, spec => {
          const value = read(node, spec.parameter);
          const index = spec.options ? spec.options.indexOf(String(value)) : Math.round(finite(value, spec.parameter));
          return Math.max(0, index);
        });
      } else if (node.operator === 'values.number' || node.operator === 'values.integer') {
        register = emit({ nodeId: node.id, operation: 'constant', type: 'scalar', inputs: [], value: finite(read(node, 'value'), 'Value') });
        if (node.operator === 'values.integer') register = emit({ nodeId: node.id, operation: 'trunc-scalar', type: 'scalar', inputs: [register] });
      } else if (node.operator === 'image.timeline-time') {
        register = emit({ nodeId: node.id, operation: 'constant', type: 'scalar', inputs: [], value: Number.isFinite(context.time) ? context.time! : 0 });
      } else if (node.operator === 'geometry.clip-time') {
        register = emit(constant(node.id, Number.isFinite(context.simulationTime) ? context.simulationTime! : 0));
      } else if (node.operator === 'geometry.position') {
        register = emit({ nodeId: node.id, operation: 'position', type: 'vec3', inputs: [] });
      } else if (node.operator === 'geometry.curve-info' && CURVE_INFO_OUTPUTS[output]) {
        register = emit({ nodeId: node.id, operation: CURVE_INFO_OUTPUTS[output], type: 'scalar', inputs: [] });
      } else throw new Error(`${getEffectOperator(node.operator)?.label ?? node.operator} cannot be evaluated per curve point.`);
      visiting.delete(key); registers.set(key, register);
      return register;
    };
    /** A parameter-backed input: a number becomes one constant, a vector three combined constants. */
    function literal(node: BoundOperatorNode, parameter: string): number {
      const value = read(node, parameter);
      if (!Array.isArray(value)) return emit({ nodeId: node.id, operation: 'constant', type: 'scalar', inputs: [], value: finite(value, parameter) });
      const components = value.map(component => emit({ nodeId: node.id, operation: 'constant', type: 'scalar', inputs: [], value: finite(component, parameter) }));
      return emit({ nodeId: node.id, operation: 'combine-vector', type: `vec${components.length}` as 'vec2' | 'vec3' | 'vec4', inputs: components });
    }
    const output = visit(linked.node, linked.output);
    if (instructions[output].type !== type) throw new Error(`${getEffectOperator(owner.operator)?.label}: ${input} needs a ${type === 'vec3' ? 'Vector 3' : 'Number'}.`);
    return pruneField({ instructions, output });
  }
}
