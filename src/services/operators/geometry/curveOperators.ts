import type { OperatorDefinition, OperatorParameter, OperatorPort } from '../../../types/operatorGraph';
import { WEAVE_OPERATORS } from './weaveOperators';
import { FIELD_OPERATORS } from './fieldOperators';
import { CLOTH_OPERATORS } from './clothOperators';
import { KNOT_OPERATORS } from './knotOperators';
import { ROD_OPERATORS } from './rodOperators';
import { FIBER_MATERIAL_OPERATORS } from './fiberMaterialOperators';
import { STRAND_CURVES_FORMAT } from './curveFormat';
import { KNIT_CYCLE_OPERATORS } from './knitCycleOperators';
import { KNIT_PASSAGE_OPERATORS } from './knitPassageOperators';

/**
 * General curve geometry operators. Curves flow between generators and modifiers;
 * number/vector inputs of a modifier are evaluated once per curve point, exactly
 * like image math is evaluated once per pixel (see fields/pointwiseLowering).
 */
export { STRAND_CURVES_FORMAT };
const curves = (id = 'curves', required = false): OperatorPort =>
  ({ id, label: 'Curves', type: 'curves', required, contract: { formats: [STRAND_CURVES_FORMAT] } });
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01, animatable = true): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable });
const axis = (value: 'x' | 'y' | 'z'): OperatorParameter => ({ id: 'axis', label: 'Axis', type: 'select', default: value,
  options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] });
const operator = (id: string, label: string, description: string, inputs: OperatorPort[], outputs: OperatorPort[],
  parameters: OperatorParameter[] = [], options: Partial<OperatorDefinition> = {}): OperatorDefinition =>
  ({ id, version: 1, label, description, inputs, outputs, parameters, invalidates: 'appearance', runtime: 'builtin',
    state: 'stateless', addable: true, implementation: 'shared', consumers: ['Weave'], ...options });

export const CURVE_POINT_LIMIT = 1_048_576;
export const CURVE_STRAND_LIMIT = 65_536;

export const CURVE_OPERATORS: readonly OperatorDefinition[] = [
  operator('geometry.curve-line', 'Curve Line', 'Creates one straight curve of evenly spaced points centered on the origin; Points sets the resolution.',
    [], [curves()], [number('points', 'Points', 2000, 2, 65_536, 1, false), number('length', 'Length', 2, 0, 100), axis('z')]),
  operator('geometry.strand-array', 'Strand Array', 'Repeats every incoming curve Count times, spaced evenly along Axis and centered on the original.',
    [curves('curves', true)], [curves()], [number('count', 'Count', 8, 1, 4096, 1, false), number('spacing', 'Spacing', 0.12, 0, 100), axis('x')],
    { bypass: 'passthrough' }),
  operator('geometry.set-position', 'Set Position', 'Moves each curve point: a connected Position replaces it, then a connected Offset is added. Inputs are evaluated per point.',
    [curves('curves', true), { id: 'position', label: 'Position', type: 'vec3' }, { id: 'offset', label: 'Offset', type: 'vec3' }], [curves()], [],
    { bypass: 'passthrough' }),
  operator('geometry.curve-contact', 'Curve Contact', 'Separates overlapping yarn capsules after animated deformations. Radius is the outer contact radius and follows an upstream Yarn Profile radius scale. More iterations reduce residual overlaps. Strength fades the correction; zero skips all contact work. Connect a uniform value or clock envelope, not a per-point field. Place after all position modifiers. Frame-local correction, without temporal friction; decorative flyaways are not collision bodies. Supports up to 16384 active points.',
    [curves('curves', true), { id: 'strength', label: 'Strength', type: 'number' }], [curves()], [number('radius', 'Contact Radius', 0.02, 0.0005, 10, 0.001), number('strength', 'Strength', 1, 0, 1),
      number('iterations', 'Iterations', 24, 1, 128, 1, false), number('smoothing', 'Correction Smoothing', 0.35, 0, 1)],
    { bypass: 'passthrough' }),
  operator('geometry.curve-flow', 'Closed Curve Flow', 'Moves material points along an existing closed path. Unlike forming new loops, the stitch path stays fixed while yarn and its colors circulate. Requires a repeated endpoint; linearly resamples positions and radius scales.',
    [curves('curves', true)], [curves()], [number('speed', 'Turns per Second', 0.05, -10, 10, 0.01),
      number('phase', 'Phase', 0, -1000, 1000, 0.01)], { bypass: 'passthrough' }),
  operator('geometry.close-curve', 'Close Curve', 'Connects each open strand end back to its own start through a smooth return bow. Offset places the back of the bow relative to the endpoint midpoint. Place before Rod Simulation for a physically closed rope. This closes the geometry; it does not loop the animation.',
    [curves('curves', true)], [curves()], [
      { id: 'offset', label: 'Return Offset', type: 'vector', default: [0, 0, -1], animatable: false },
      number('handle', 'End Handles', 0.4, 0, 100, 0.01, false),
      number('points', 'Return Points', 96, 8, 4096, 1, false)], { bypass: 'passthrough' }),
  operator('geometry.position', 'Position', 'The current position of each curve point, evaluated where a modifier reads it.',
    [], [{ id: 'position', label: 'Position', type: 'vec3' }]),
  operator('geometry.clip-time', 'Clip Time', 'Seconds of source time of the clip that hosts the effect: 0 where the clip starts, continuing across splits. Cloth runs on the same clock.',
    [], [{ id: 'value', label: 'Seconds', type: 'number' }]),
  operator('geometry.curve-info', 'Curve Info', 'Per-point curve data: Curve Param runs from 0 to 1 along each curve; indices count from 0.',
    [], [{ id: 'u', label: 'Curve Param', type: 'number' }, { id: 'point', label: 'Point Index', type: 'number' },
      { id: 'strand', label: 'Strand Index', type: 'number' }, { id: 'points', label: 'Point Count', type: 'number' },
      { id: 'strands', label: 'Strand Count', type: 'number' }]),
  operator('geometry.yarn-profile', 'Yarn Profile', 'Turns each curve into a twisted yarn of plies and fibers at render time; twist follows curve length, so animating Radius never spins it. Surface Feed moves the ply, fiber and flyaway detail along arc length in units per source second; positive follows curve order. It does not move the centerline, advect color fields, or simulate tension.',
    [curves('curves', true), { id: 'radius', label: 'Radius Scale', type: 'number' }], [curves()],
    [number('plies', 'Plies', 3, 1, 8, 1, false), number('fibers', 'Fibers per Ply', 7, 1, 32, 1, false),
      number('radius', 'Radius', 0.03, 0, 10, 0.001), number('plyTwist', 'Ply Twist', 5, -500, 500, 0.1),
      number('fiberTwist', 'Fiber Twist', -11, -2000, 2000, 0.1),
      number('feedSpeed', 'Surface Feed', 0, -10, 10, 0.01)],
    { bypass: 'passthrough' }),
  operator('geometry.flyaways', 'Flyaways', 'Lets single fibers of a Yarn Profile leave the yarn at random places: loops arc out and return, free ends stick out and stop. Drawn at render time.',
    [curves('curves', true)], [curves()],
    [number('density', 'Density', 3, 0, 200, 0.1), number('length', 'Length', 0.08, 0.001, 10, 0.001),
      number('lift', 'Lift', 2.5, 0, 50, 0.1), number('hair', 'Free Ends', 0.35, 0, 1, 0.01),
      number('seed', 'Seed', 0, 0, 9999, 1, false)],
    { bypass: 'passthrough' }),
  operator('geometry.thread-along', 'Thread Along', 'Pulls each curve in along its own path behind a tip that arcs up by Lift and settles behind it. Ahead of the tip the curve is hidden, or with Ahead set to Trail it streams from the tip along Trail Direction as a loose thread. Progress runs from 0 to 1 (per point when connected); Stagger starts later curves later.',
    [curves('curves', true), { id: 'progress', label: 'Progress', type: 'number' }], [curves()],
    [number('progress', 'Progress', 1, 0, 1, 0.001), number('stagger', 'Stagger', 0.5, 0, 0.99, 0.01),
      number('lift', 'Lift', 0.06, 0, 10, 0.001), number('liftLength', 'Lift Length', 0.2, 0.001, 100, 0.001),
      number('settle', 'Settle', 1.2, 0, 20, 0.01),
      { id: 'ahead', label: 'Ahead', type: 'select', default: 'hide', animatable: false,
        options: [{ value: 'hide', label: 'Hide' }, { value: 'trail', label: 'Trail' }] },
      { id: 'trail', label: 'Trail Direction', type: 'vector', default: [0, 1, 0.5] }],
    { bypass: 'passthrough' }),
  operator('geometry.extend', 'Extend', 'Continues every curve straight beyond both ends along its end direction by Length, with Points per End new points, so threads run on out of frame and can be pulled from there. Rings open at their seam.',
    [curves('curves', true)], [curves()],
    [number('length', 'Length', 1, 0, 100, 0.01, false), number('points', 'Points per End', 64, 1, 4096, 1, false)],
    { bypass: 'passthrough' }),
  ...KNOT_OPERATORS,
  ...WEAVE_OPERATORS,
  ...FIELD_OPERATORS,
  ...CLOTH_OPERATORS,
  ...ROD_OPERATORS,
  ...FIBER_MATERIAL_OPERATORS,
  ...KNIT_CYCLE_OPERATORS,
  ...KNIT_PASSAGE_OPERATORS,
  operator('render.strands', 'Strand Render', 'Draws the connected curves as thin strands in the shared 3D scene. Color applies when no Fiber Material comes before it; Subdivision sets the linear pieces per curve segment for the path tracer.',
    [curves('curves', true), { id: 'color', label: 'Color', type: 'vec3' }], [{ id: 'scene', label: 'Scene', type: 'scene' }],
    [number('width', 'Width', 0.004, 0, 1, 0.0005), { id: 'color', label: 'Color', type: 'color', default: '#e8e2d6', animatable: true },
      { id: 'antialiasing', label: 'Antialiasing', type: 'select', default: 'hashed', animatable: false,
        options: [{ value: 'hashed', label: 'Hashed' }, { value: 'coverage4x', label: '4x Coverage' }, { value: 'analytic', label: 'Analytic' }] },
      number('subdivision', 'Subdivision', 2, 1, 16, 1, false)],
    { bypass: 'mute' }),
];

const CURVE_OPERATOR_IDS = new Set(CURVE_OPERATORS.map(item => item.id));
export const isCurveOperator = (id: string) => CURVE_OPERATOR_IDS.has(id);
