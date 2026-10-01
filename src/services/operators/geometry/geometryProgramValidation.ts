import { pointwiseOperation, type PointwiseValueType } from '../fields/pointwiseOperations';
import { CURVE_POINT_LIMIT, CURVE_STRAND_LIMIT } from './curveOperators';
import { CURVE_CONTEXT_OPERATIONS, knotCurveCount, knotPointCount, weavePatternPointCount, type GeometryField, type GeometryProgram } from './geometryProgram';
import { celticLoops, isCoprimeTorusKnot, KNOT_SHAPES } from './knotCurves';
import { WEAVE_PATTERNS } from './weaveOperators';
import { isClothSpec } from './clothProgram';

const FIELD_INSTRUCTION_LIMIT = 256;
const STAGE_LIMIT = 64;
const TYPES = new Set<PointwiseValueType>(['scalar', 'boolean', 'vec2', 'vec3', 'vec4']);
const CONTEXT = new Set<string>(CURVE_CONTEXT_OPERATIONS);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const axis = (value: unknown) => value === 0 || value === 1 || value === 2;

function isField(value: unknown): value is GeometryField {
  if (!record(value) || !exactKeys(value, ['instructions', 'output']) || !Array.isArray(value.instructions)) return false;
  const instructions = value.instructions as unknown[];
  if (!instructions.length || instructions.length > FIELD_INSTRUCTION_LIMIT || !Number.isInteger(value.output)
    || (value.output as number) < 0 || (value.output as number) >= instructions.length) return false;
  return instructions.every((item, index) => record(item) && exactKeys(item, ['nodeId', 'operation', 'type', 'inputs', 'value'])
    && typeof item.nodeId === 'string' && typeof item.operation === 'string' && TYPES.has(item.type as PointwiseValueType)
    && (item.value === undefined || finite(item.value))
    && (item.operation === 'constant' ? finite(item.value) : CONTEXT.has(item.operation) || !!pointwiseOperation(item.operation))
    && Array.isArray(item.inputs) && item.inputs.every(input => Number.isInteger(input) && input >= 0 && input < index));
}

/** Validates a transported program, including recomputed point and curve limits. */
export function isGeometryProgram(value: unknown): value is GeometryProgram {
  if (!record(value) || !exactKeys(value, ['stages', 'render', 'pointCount', 'strandCount']) || !Array.isArray(value.stages)
    || !value.stages.length || value.stages.length > STAGE_LIMIT) return false;
  let points = 0, strands = 0;
  for (const [index, stage] of (value.stages as unknown[]).entries()) {
    if (!record(stage) || typeof stage.nodeId !== 'string') return false;
    if (stage.kind === 'curve-line') {
      if (index !== 0 || !exactKeys(stage, ['kind', 'nodeId', 'points', 'length', 'axis']) || !Number.isInteger(stage.points)
        || (stage.points as number) < 2 || !finite(stage.length) || !axis(stage.axis)) return false;
      points = stage.points as number; strands = 1;
    } else if (stage.kind === 'weave-pattern') {
      const counts = [stage.warps, stage.wefts, stage.resolution, stage.pattern];
      if (index !== 0 || !exactKeys(stage, ['kind', 'nodeId', 'pattern', 'warps', 'wefts', 'width', 'height', 'crimp', 'resolution'])
        || !counts.every(Number.isInteger) || (stage.warps as number) < 1 || (stage.wefts as number) < 1 || (stage.resolution as number) < 2
        || (stage.pattern as number) < 0 || (stage.pattern as number) >= WEAVE_PATTERNS.length
        || ![stage.width, stage.height, stage.crimp].every(finite)) return false;
      if ((stage.warps as number) * (stage.wefts as number) * (stage.resolution as number) > CURVE_POINT_LIMIT) return false;
      points = weavePatternPointCount(stage as { warps: number; wefts: number; resolution: number });
      strands = (stage.warps as number) + (stage.wefts as number);
    } else if (stage.kind === 'knot') {
      if (index !== 0 || !exactKeys(stage, ['kind', 'nodeId', 'shape', 'p', 'q', 'size', 'depth', 'points'])
        || ![stage.shape, stage.p, stage.q, stage.points].every(Number.isInteger) || (stage.shape as number) < 0
        || (stage.shape as number) >= KNOT_SHAPES.length || (stage.points as number) < 16 || (stage.points as number) > CURVE_POINT_LIMIT
        || ![stage.size, stage.depth].every(finite)
        || (KNOT_SHAPES[stage.shape as number] === 'torus' && !isCoprimeTorusKnot(stage.p as number, stage.q as number))) return false;
      points = knotPointCount(stage as { shape: number; points: number }); strands = knotCurveCount(stage.shape as number);
    } else if (stage.kind === 'celtic-knot') {
      if (index !== 0 || !exactKeys(stage, ['kind', 'nodeId', 'columns', 'rows', 'size', 'height', 'resolution', 'roundness'])
        || ![stage.columns, stage.rows, stage.resolution].every(Number.isInteger) || (stage.columns as number) < 1 || (stage.rows as number) < 1
        || (stage.columns as number) * (stage.rows as number) > 4096 || (stage.resolution as number) < 2 || (stage.resolution as number) > 64
        || ![stage.size, stage.height, stage.roundness].every(finite)) return false;
      const loops = celticLoops(stage.columns as number, stage.rows as number);
      points = loops.reduce((sum, loop) => sum + loop.length * (stage.resolution as number) + 1, 0); strands = loops.length;
    } else if (stage.kind === 'thread-along') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'progress', 'value', 'stagger', 'lift', 'liftLength', 'settle'])
        || (stage.progress !== undefined && !isField(stage.progress))
        || ![stage.value, stage.stagger, stage.lift, stage.liftLength, stage.settle].every(finite)) return false;
    } else if (stage.kind === 'yarn-profile') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'radius']) || (stage.radius !== undefined && !isField(stage.radius))) return false;
    } else if (stage.kind === 'strand-array') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'count', 'spacing', 'axis']) || !Number.isInteger(stage.count)
        || (stage.count as number) < 1 || !finite(stage.spacing) || !axis(stage.axis)) return false;
      points *= stage.count as number; strands *= stage.count as number;
    } else if (stage.kind === 'surface-bind') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'height', 'cloth', 'time']) || !finite(stage.height) || !finite(stage.time)
        || !isClothSpec(stage.cloth)) return false;
    } else if (stage.kind === 'set-position') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'position', 'offset'])
        || (stage.position !== undefined && !isField(stage.position)) || (stage.offset !== undefined && !isField(stage.offset))) return false;
    } else return false;
    if (points > CURVE_POINT_LIMIT || strands > CURVE_STRAND_LIMIT) return false;
  }
  const render = value.render;
  if (render !== undefined && (!record(render) || !exactKeys(render, ['nodeId', 'width', 'color', 'antialiasing', 'profile', 'flyaways']) || typeof render.nodeId !== 'string'
    || !finite(render.width) || render.width < 0 || typeof render.color !== 'string' || render.color.length > 32
    || (render.antialiasing !== undefined && render.antialiasing !== 'coverage4x' && render.antialiasing !== 'analytic'))) return false;
  const profile = record(render) ? render.profile : undefined;
  if (profile !== undefined && (!record(profile) || !exactKeys(profile, ['plies', 'fibers', 'radius', 'plyTwist', 'fiberTwist'])
    || !Number.isInteger(profile.plies) || !Number.isInteger(profile.fibers) || (profile.plies as number) < 1 || (profile.fibers as number) < 1
    || (profile.plies as number) * (profile.fibers as number) > 256 || ![profile.radius, profile.plyTwist, profile.fiberTwist].every(finite)
    || (profile.radius as number) < 0)) return false;
  const flyaways = record(render) ? render.flyaways : undefined;
  if (flyaways !== undefined && (profile === undefined || !record(flyaways) || !exactKeys(flyaways, ['density', 'length', 'lift', 'hair', 'seed'])
    || ![flyaways.density, flyaways.length, flyaways.lift, flyaways.hair].every(finite) || !Number.isInteger(flyaways.seed)
    || (flyaways.density as number) <= 0 || (flyaways.length as number) <= 0 || (flyaways.lift as number) < 0
    || (flyaways.hair as number) < 0 || (flyaways.hair as number) > 1)) return false;
  return value.pointCount === points && value.strandCount === strands;
}
