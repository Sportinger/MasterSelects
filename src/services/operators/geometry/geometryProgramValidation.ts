import { pointwiseOperation, type PointwiseValueType } from '../fields/pointwiseOperations';
import { CURVE_POINT_LIMIT, CURVE_STRAND_LIMIT } from './curveOperators';
import { CURVE_CONTEXT_OPERATIONS, knotCurveCount, knotPointCount, weavePatternPointCount, type GeometryField, type GeometryProgram } from './geometryProgram';
import { celticLoops, isCoprimeTorusKnot, KNOT_SHAPES } from './knotCurves';
import { knitPointCount } from './knitCurves';
import { isKnitSphereSpec, KNIT_SPHERE_KEYS } from './knitSphereCurves';
import { CONTACT_POINT_LIMIT } from './curveContacts';
import { WEAVE_PATTERNS } from './weaveOperators';
import { isClothSpec } from './clothProgram';
import { isRodSpec } from './rodProgram';
import { isKnitCycleSpec, KNIT_CYCLE_KEYS } from './knitCycleGuides';
import { isKnitPassageSpec, KNIT_PASSAGE_POINTS, KNIT_PASSAGE_ROWS } from './knitPassageSpec';

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

const FIBER_MATERIAL_KEYS = ['nodeId', 'color', 'absorption', 'melanin', 'melaninRedness', 'roughnessLongitudinal', 'roughnessAzimuthal',
  'cuticleTilt', 'ior', 'coatTint', 'matte', 'fuzz', 'colorField', 'roughnessField', 'melaninField', 'selection'];
const HEX = /^#[\da-f]{6}([\da-f]{2})?$/i;

function isFiberMaterialList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= 64 && value.every(item => record(item) && exactKeys(item, FIBER_MATERIAL_KEYS)
    && typeof item.nodeId === 'string' && typeof item.color === 'string' && HEX.test(item.color) && typeof item.coatTint === 'string' && HEX.test(item.coatTint)
    && (item.absorption === 'color' || item.absorption === 'melanin')
    && [item.melanin, item.melaninRedness, item.roughnessLongitudinal, item.roughnessAzimuthal, item.cuticleTilt, item.ior, item.matte, item.fuzz].every(finite)
    && [item.colorField, item.roughnessField, item.melaninField, item.selection].every(field => field === undefined || isField(field)));
}

/** Validates a transported program, including recomputed point and curve limits. */
export function isGeometryProgram(value: unknown): value is GeometryProgram {
  if (!record(value) || !exactKeys(value, ['stages', 'render', 'pointCount', 'strandCount']) || !Array.isArray(value.stages)
    || !value.stages.length || value.stages.length > STAGE_LIMIT) return false;
  let points = 0, strands = 0, simulated = false;
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
    } else if (stage.kind === 'knit-sphere') {
      if (index !== 0 || !exactKeys(stage, ['kind', 'nodeId', ...KNIT_SPHERE_KEYS]) || !isKnitSphereSpec(stage)) return false;
      points = knitPointCount(stage as { stitches: number; rows: number; resolution: number }); strands = stage.rows as number;
    } else if (stage.kind === 'knit-cycle') {
      if (index !== 0 || !exactKeys(stage, ['kind', 'nodeId', ...KNIT_CYCLE_KEYS]) || !isKnitCycleSpec(stage)) return false;
      points = knitPointCount(stage as { stitches: number; rows: number; resolution: number }); strands = stage.rows as number;
    } else if (stage.kind === 'knit-passage') {
      if (index !== 0 || !exactKeys(stage, ['kind', 'nodeId', 'phase', 'travel', 'follow']) || !isKnitPassageSpec(stage)) return false;
      points = KNIT_PASSAGE_ROWS * KNIT_PASSAGE_POINTS; strands = KNIT_PASSAGE_ROWS; simulated = true;
    } else if (stage.kind === 'knit') {
      if (index !== 0 || !exactKeys(stage, ['kind', 'nodeId', 'stitches', 'rows', 'width', 'height', 'spacing', 'depth', 'lean', 'resolution'])
        || ![stage.stitches, stage.rows, stage.resolution].every(Number.isInteger) || (stage.stitches as number) < 1 || (stage.rows as number) < 1
        || (stage.resolution as number) < 4 || ![stage.width, stage.height, stage.spacing, stage.depth, stage.lean].every(finite)) return false;
      if ((stage.stitches as number) * (stage.rows as number) * (stage.resolution as number) > CURVE_POINT_LIMIT) return false;
      points = knitPointCount(stage as { stitches: number; rows: number; resolution: number }); strands = stage.rows as number;
    } else if (stage.kind === 'thread-along') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'progress', 'value', 'stagger', 'lift', 'liftLength', 'settle', 'trail'])
        || (stage.progress !== undefined && !isField(stage.progress))
        || (stage.trail !== undefined && !(Array.isArray(stage.trail) && stage.trail.length === 3 && stage.trail.every(finite)))
        || ![stage.value, stage.stagger, stage.lift, stage.liftLength, stage.settle].every(finite)) return false;
    } else if (stage.kind === 'extend') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'length', 'points']) || !finite(stage.length) || (stage.length as number) < 0
        || !Number.isInteger(stage.points) || (stage.points as number) < 1 || (stage.points as number) > 4096) return false;
      points += 2 * (stage.points as number) * strands;
    } else if (stage.kind === 'close-curve') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'offset', 'handle', 'points'])
        || !Array.isArray(stage.offset) || stage.offset.length !== 3 || !stage.offset.every(finite)
        || !finite(stage.handle) || stage.handle < 0 || !Number.isInteger(stage.points)
        || (stage.points as number) < 8 || (stage.points as number) > 4096) return false;
      points += (stage.points as number) * strands;
    } else if (stage.kind === 'curve-flow') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'phase']) || !finite(stage.phase)) return false;
    } else if (stage.kind === 'curve-contact') {
      if (index === 0 || points > CONTACT_POINT_LIMIT || !exactKeys(stage, ['kind', 'nodeId', 'radius', 'iterations', 'smoothing'])
        || !finite(stage.radius) || stage.radius < 0.0005 || stage.radius > 10 || !finite(stage.smoothing) || stage.smoothing < 0 || stage.smoothing > 1
        || !Number.isInteger(stage.iterations) || (stage.iterations as number) < 1 || (stage.iterations as number) > 128) return false;
    } else if (stage.kind === 'yarn-profile') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'radius']) || (stage.radius !== undefined && !isField(stage.radius))) return false;
    } else if (stage.kind === 'strand-array') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'count', 'spacing', 'axis']) || !Number.isInteger(stage.count)
        || (stage.count as number) < 1 || !finite(stage.spacing) || !axis(stage.axis)) return false;
      points *= stage.count as number; strands *= stage.count as number;
    } else if (stage.kind === 'surface-bind') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'height', 'cloth', 'time']) || !finite(stage.height) || !finite(stage.time)
        || !isClothSpec(stage.cloth)) return false;
      simulated = true;
    } else if (stage.kind === 'rod-simulation') {
      if (index === 0 || simulated || !exactKeys(stage, ['kind', 'nodeId', 'rod', 'pins', 'pullStart', 'pullDirection', 'form', 'time']) || !finite(stage.time)
        || !isRodSpec(stage.rod) || [stage.pins, stage.pullStart, stage.form].some(field => field !== undefined && !isField(field))
        || (stage.pullDirection !== undefined && (!isField(stage.pullDirection)
          || stage.pullDirection.instructions[stage.pullDirection.output].type !== 'vec3'))) return false;
      simulated = true;
    } else if (stage.kind === 'set-position') {
      if (index === 0 || !exactKeys(stage, ['kind', 'nodeId', 'position', 'offset'])
        || (stage.position !== undefined && !isField(stage.position)) || (stage.offset !== undefined && !isField(stage.offset))) return false;
    } else return false;
    if (points > CURVE_POINT_LIMIT || strands > CURVE_STRAND_LIMIT) return false;
  }
  const render = value.render;
  if (render !== undefined && (!record(render) || !exactKeys(render, ['nodeId', 'width', 'color', 'colorField', 'antialiasing', 'profile', 'flyaways', 'subdivision', 'materials'])
    || typeof render.nodeId !== 'string'
    || !finite(render.width) || render.width < 0 || typeof render.color !== 'string' || render.color.length > 32
    || (render.antialiasing !== undefined && render.antialiasing !== 'coverage4x' && render.antialiasing !== 'analytic')
    || (render.subdivision !== undefined && (!Number.isInteger(render.subdivision) || (render.subdivision as number) < 1 || (render.subdivision as number) > 16))
    || (render.materials !== undefined && !isFiberMaterialList(render.materials)))) return false;
  if (record(render) && render.colorField !== undefined && (!isField(render.colorField)
    || render.colorField.instructions[render.colorField.output].type !== 'vec3')) return false;
  const profile = record(render) ? render.profile : undefined;
  if (profile !== undefined && (!record(profile) || !exactKeys(profile, ['plies', 'fibers', 'radius', 'plyTwist', 'fiberTwist', 'materialOffset'])
    || !Number.isInteger(profile.plies) || !Number.isInteger(profile.fibers) || (profile.plies as number) < 1 || (profile.fibers as number) < 1
    || (profile.plies as number) * (profile.fibers as number) > 256 || ![profile.radius, profile.plyTwist, profile.fiberTwist].every(finite)
    || (profile.radius as number) < 0 || (profile.materialOffset !== undefined && !finite(profile.materialOffset)))) return false;
  const flyaways = record(render) ? render.flyaways : undefined;
  if (flyaways !== undefined && (profile === undefined || !record(flyaways) || !exactKeys(flyaways, ['density', 'length', 'lift', 'hair', 'seed'])
    || ![flyaways.density, flyaways.length, flyaways.lift, flyaways.hair].every(finite) || !Number.isInteger(flyaways.seed)
    || (flyaways.density as number) <= 0 || (flyaways.length as number) <= 0 || (flyaways.lift as number) < 0
    || (flyaways.hair as number) < 0 || (flyaways.hair as number) > 1)) return false;
  return value.pointCount === points && value.strandCount === strands;
}
