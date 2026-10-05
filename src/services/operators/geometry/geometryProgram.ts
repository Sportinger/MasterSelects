import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';
import { getEffectOperator } from '../operatorRegistry';
import { applyOperatorGroupBypasses } from '../operatorGroupBypass';
import { lowerPointwiseNode, pointwiseLoweringFor, type PointwiseInstruction } from '../fields/pointwiseLowering';
import { pointwiseOperation, type PointwiseValueType } from '../fields/pointwiseOperations';
import { CURVE_POINT_LIMIT, CURVE_STRAND_LIMIT } from './curveOperators';
import { WEAVE_PATTERNS } from './weaveOperators';
import { compileClothSpec, type ClothSpec } from './clothProgram';
import { compileRodSpec, type RodSpec } from './rodProgram';
import { celticLoops, isCoprimeTorusKnot, KNOT_SHAPES, type CelticKnotSpec, type KnotSpec } from './knotCurves';
import { knitPointCount, type KnitSpec } from './knitCurves';
import { isKnitSphereSpec, KNIT_SPHERE_KEYS, type KnitSphereSpec } from './knitSphereCurves';
import type { ExtendSpec } from './extendCurves';

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
  | ({ kind: 'knot'; nodeId: string } & KnotSpec)
  | ({ kind: 'celtic-knot'; nodeId: string } & CelticKnotSpec)
  | ({ kind: 'knit'; nodeId: string } & KnitSpec)
  | ({ kind: 'knit-sphere'; nodeId: string } & KnitSphereSpec)
  | { kind: 'strand-array'; nodeId: string; count: number; spacing: number; axis: CurveAxis }
  | ({ kind: 'extend'; nodeId: string } & ExtendSpec)
  /** See threadAlong.ts; `value` is the Progress parameter used when no field is connected; `trail` (unit) when Ahead is Trail. */
  | { kind: 'thread-along'; nodeId: string; progress?: GeometryField; value: number; stagger: number; lift: number; liftLength: number; settle: number;
      trail?: [number, number, number] }
  | { kind: 'set-position'; nodeId: string; position?: GeometryField; offset?: GeometryField }
  | { kind: 'yarn-profile'; nodeId: string; radius?: GeometryField }
  /** Curves on the cloth simulated by `cloth` at source time `time` (seconds). */
  | { kind: 'surface-bind'; nodeId: string; height: number; cloth: ClothSpec; time: number }
  /** The incoming curves simulated as rods from their rest state, at source time `time` (seconds). See rodSolver.ts. */
  | { kind: 'rod-simulation'; nodeId: string; rod: RodSpec; pins?: GeometryField; pullStart?: GeometryField; form?: GeometryField; time: number };
/** Render-time yarn: plies around the curve and fibers around each ply, twisted along curve length. */
export interface YarnProfile { plies: number; fibers: number; radius: number; plyTwist: number; fiberTwist: number }
/**
 * Render-time stray fibers of a yarn: Density per unit curve length, each spanning Length along the
 * curve and rising Lift yarn radii off its surface; a Hair fraction ends free at the peak.
 */
export interface YarnFlyaways { density: number; length: number; lift: number; hair: number; seed: number }
/**
 * `antialiasing`: absent for hashed coverage; `coverage4x` multisamples the strands; `analytic`
 * rasterizes them in tiles with exact pixel coverage and front-to-back blending.
 */
export type StrandAntialiasing = 'coverage4x' | 'analytic';
export interface GeometryStrandRender { nodeId: string; width: number; color: string; colorField?: GeometryField; antialiasing?: StrandAntialiasing; profile?: YarnProfile; flyaways?: YarnFlyaways }
export interface GeometryProgram { stages: GeometryStage[]; render?: GeometryStrandRender; pointCount: number; strandCount: number }
/** Resolves a node parameter (literal, effect parameter or keyframed value) for the evaluation time. */
export type GeometryParameterReader = (node: BoundOperatorNode, parameter: string) => OperatorValue;

const GENERATORS = new Set(['geometry.curve-line', 'weave.pattern', 'geometry.knot', 'geometry.celtic-knot', 'geometry.knit', 'geometry.knit-sphere']);
const MODIFIERS = new Set(['geometry.strand-array', 'geometry.set-position', 'geometry.yarn-profile', 'geometry.flyaways', 'geometry.surface-bind',
  'geometry.thread-along', 'geometry.rod-simulation', 'geometry.extend']);
/** Curves of a knot generator: two ropes for the reef knot, one closed curve otherwise. */
export const knotCurveCount = (shape: number) => KNOT_SHAPES[shape] === 'reef' ? 2 : 1;
/** Points of a knot generator, matching knotCurves: the reef resamples 14 spline intervals per rope. */
export const knotPointCount = (stage: { shape: number; points: number }) => KNOT_SHAPES[stage.shape] === 'reef'
  ? 2 * (14 * Math.max(1, Math.round(stage.points / 14)) + 1) : stage.points + 1;
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
    const colorField = render && compileField(renderNode, 'color', 'vec3');
    if (render && colorField) render.colorField = colorField;
    const antialiasing = read(renderNode, 'antialiasing');
    if (antialiasing !== 'hashed' && antialiasing !== 'coverage4x' && antialiasing !== 'analytic') throw new Error('Unsupported strand antialiasing.');
    if (render && antialiasing !== 'hashed') render.antialiasing = antialiasing;
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
    } else if (node.operator === 'geometry.rod-simulation') {
      const pins = compileField(node, 'pin', 'scalar'), pullStart = compileField(node, 'pullStart', 'scalar'), form = compileField(node, 'form', 'scalar');
      stages.push({ kind: 'rod-simulation', nodeId: node.id, rod: compileRodSpec(graph, node, read), ...(pins ? { pins } : {}),
        ...(pullStart ? { pullStart } : {}), ...(form ? { form } : {}),
        time: Number.isFinite(context.simulationTime) ? context.simulationTime! : 0 });
    } else if (node.operator === 'geometry.flyaways') {
      flyaways = { density: Math.max(0, finite(read(node, 'density'), 'Flyaway density')),
        length: Math.max(0.001, finite(read(node, 'length'), 'Flyaway length')), lift: Math.max(0, finite(read(node, 'lift'), 'Flyaway lift')),
        hair: Math.min(1, Math.max(0, finite(read(node, 'hair'), 'Free ends'))), seed: Math.round(finite(read(node, 'seed'), 'Seed')) };
    } else if (node.operator === 'geometry.curve-line') {
      stages.push({ kind: 'curve-line', nodeId: node.id, points: Math.round(finite(read(node, 'points'), 'Curve points')),
        length: finite(read(node, 'length'), 'Curve length'), axis: axisIndex(read(node, 'axis')) });
    } else if (node.operator === 'geometry.knot') {
      const shape = KNOT_SHAPES.indexOf(String(read(node, 'shape')) as typeof KNOT_SHAPES[number]);
      stages.push({ kind: 'knot', nodeId: node.id, shape: Math.max(0, shape), p: Math.round(finite(read(node, 'p'), 'Torus P')),
        q: Math.round(finite(read(node, 'q'), 'Torus Q')), size: finite(read(node, 'size'), 'Knot size'),
        depth: finite(read(node, 'depth'), 'Knot depth'), points: Math.round(finite(read(node, 'points'), 'Knot points')) });
    } else if (node.operator === 'geometry.celtic-knot') {
      stages.push({ kind: 'celtic-knot', nodeId: node.id, columns: Math.round(finite(read(node, 'columns'), 'Columns')),
        rows: Math.round(finite(read(node, 'rows'), 'Rows')), size: finite(read(node, 'size'), 'Cell size'),
        height: finite(read(node, 'height'), 'Crossing height'), resolution: Math.round(finite(read(node, 'resolution'), 'Points per step')),
        roundness: finite(read(node, 'roundness'), 'Roundness') });
    } else if (node.operator === 'geometry.knit-sphere') {
      const spec = Object.fromEntries(KNIT_SPHERE_KEYS.map(key => [key, finite(read(node, key), key)])) as unknown as KnitSphereSpec;
      const time = Number.isFinite(context.simulationTime) ? context.simulationTime! : 0;
      spec.phase += time * finite(read(node, 'speed'), 'Speed');
      if (!isKnitSphereSpec({ ...spec })) throw new Error('Knit Sphere parameters are outside their supported ranges.');
      spec.phase = ((spec.phase % 1) + 1) % 1;
      stages.push({ kind: 'knit-sphere', nodeId: node.id, ...spec });
    } else if (node.operator === 'geometry.knit') {
      stages.push({ kind: 'knit', nodeId: node.id, stitches: Math.round(finite(read(node, 'stitches'), 'Stitches')),
        rows: Math.round(finite(read(node, 'rows'), 'Rows')), width: finite(read(node, 'width'), 'Stitch width'),
        height: finite(read(node, 'height'), 'Loop height'), spacing: finite(read(node, 'spacing'), 'Row spacing'),
        depth: finite(read(node, 'depth'), 'Depth'), lean: finite(read(node, 'lean'), 'Lean'),
        resolution: Math.round(finite(read(node, 'resolution'), 'Points per stitch')) });
    } else if (node.operator === 'geometry.thread-along') {
      const progress = compileField(node, 'progress', 'scalar');
      const direction = read(node, 'trail');
      const trail = read(node, 'ahead') === 'trail' && Array.isArray(direction) && direction.length === 3 ? direction.map(value => finite(value, 'Trail direction')) : null;
      const reach = trail ? Math.hypot(trail[0], trail[1], trail[2]) : 0;
      stages.push({ kind: 'thread-along', nodeId: node.id, ...(progress ? { progress } : {}), value: finite(read(node, 'progress'), 'Progress'),
        stagger: finite(read(node, 'stagger'), 'Stagger'), lift: finite(read(node, 'lift'), 'Lift'),
        liftLength: finite(read(node, 'liftLength'), 'Lift length'), settle: finite(read(node, 'settle'), 'Settle'),
        ...(trail ? { trail: (reach > 0 ? trail.map(value => value / reach) : [0, 1, 0]) as [number, number, number] } : {}) });
    } else if (node.operator === 'geometry.extend') {
      stages.push({ kind: 'extend', nodeId: node.id, length: Math.max(0, finite(read(node, 'length'), 'Extend length')),
        points: Math.round(finite(read(node, 'points'), 'Points per end')) });
    } else if (node.operator === 'geometry.strand-array') {
      stages.push({ kind: 'strand-array', nodeId: node.id, count: Math.round(finite(read(node, 'count'), 'Strand count')),
        spacing: finite(read(node, 'spacing'), 'Strand spacing'), axis: axisIndex(read(node, 'axis')) });
    } else {
      const position = compileField(node, 'position', 'vec3'), offset = compileField(node, 'offset', 'vec3');
      stages.push({ kind: 'set-position', nodeId: node.id, ...(position ? { position } : {}), ...(offset ? { offset } : {}) });
    }
  }
  // A simulation's input is its rest state; after a cloth bind or another simulation it would change every frame.
  stages.forEach((stage, index) => {
    if (stage.kind === 'rod-simulation' && stages.slice(0, index).some(item => item.kind === 'surface-bind' || item.kind === 'rod-simulation')) {
      throw new Error('Rod Simulation must come before Surface Bind and any other Rod Simulation.');
    }
  });
  let pointCount = 0, strandCount = 0;
  for (const stage of stages) {
    if (stage.kind === 'curve-line') {
      if (stage.points < 2) throw new Error('A curve needs at least two points.');
      pointCount = stage.points; strandCount = 1;
    } else if (stage.kind === 'weave-pattern') {
      if (stage.warps < 1 || stage.wefts < 1 || stage.resolution < 2) throw new Error('Weave Pattern needs threads in both directions.');
      pointCount = weavePatternPointCount(stage); strandCount = stage.warps + stage.wefts;
    } else if (stage.kind === 'knot') {
      if (stage.points < 16) throw new Error('A knot needs at least 16 points.');
      if (KNOT_SHAPES[stage.shape] === 'torus' && !isCoprimeTorusKnot(stage.p, stage.q)) throw new Error('A torus knot needs P and Q without a common divisor.');
      pointCount = knotPointCount(stage); strandCount = knotCurveCount(stage.shape);
    } else if (stage.kind === 'celtic-knot') {
      if (stage.columns < 1 || stage.rows < 1 || stage.resolution < 2) throw new Error('Celtic Knot needs at least one cell and two points per step.');
      if (stage.columns * stage.rows > 4096) throw new Error('Celtic Knot allows at most 4096 cells.');
      const loops = celticLoops(stage.columns, stage.rows);
      pointCount = loops.reduce((sum, loop) => sum + loop.length * stage.resolution + 1, 0); strandCount = loops.length;
    } else if (stage.kind === 'knit' || stage.kind === 'knit-sphere') {
      if (stage.stitches < 1 || stage.rows < 1 || stage.resolution < 4) throw new Error('Knit needs at least one stitch, one row and four points per stitch.');
      pointCount = knitPointCount(stage); strandCount = stage.rows;
    } else if (stage.kind === 'extend') {
      if (stage.points < 1 || stage.points > 4096) throw new Error('Extend needs 1 to 4096 points per end.');
      pointCount += 2 * stage.points * strandCount;
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
