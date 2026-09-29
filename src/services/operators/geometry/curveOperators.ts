import type { OperatorDefinition, OperatorParameter, OperatorPort } from '../../../types/operatorGraph';
import { WEAVE_OPERATORS } from './weaveOperators';
import { FIELD_OPERATORS } from './fieldOperators';

/**
 * General curve geometry operators. Curves flow between generators and modifiers;
 * number/vector inputs of a modifier are evaluated once per curve point, exactly
 * like image math is evaluated once per pixel (see fields/pointwiseLowering).
 */
export const STRAND_CURVES_FORMAT = 'strand-curves';
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
  operator('geometry.position', 'Position', 'The current position of each curve point, evaluated where a modifier reads it.',
    [], [{ id: 'position', label: 'Position', type: 'vec3' }]),
  operator('geometry.curve-info', 'Curve Info', 'Per-point curve data: Curve Param runs from 0 to 1 along each curve; indices count from 0.',
    [], [{ id: 'u', label: 'Curve Param', type: 'number' }, { id: 'point', label: 'Point Index', type: 'number' },
      { id: 'strand', label: 'Strand Index', type: 'number' }, { id: 'points', label: 'Point Count', type: 'number' },
      { id: 'strands', label: 'Strand Count', type: 'number' }]),
  operator('geometry.yarn-profile', 'Yarn Profile', 'Turns each curve into a twisted yarn of plies and fibers at render time; twist follows curve length, so animating Radius never spins it.',
    [curves('curves', true), { id: 'radius', label: 'Radius Scale', type: 'number' }], [curves()],
    [number('plies', 'Plies', 3, 1, 8, 1, false), number('fibers', 'Fibers per Ply', 7, 1, 32, 1, false),
      number('radius', 'Radius', 0.03, 0, 10, 0.001), number('plyTwist', 'Ply Twist', 5, -500, 500, 0.1),
      number('fiberTwist', 'Fiber Twist', -11, -2000, 2000, 0.1)],
    { bypass: 'passthrough' }),
  operator('geometry.flyaways', 'Flyaways', 'Lets single fibers of a Yarn Profile leave the yarn at random places: loops arc out and return, free ends stick out and stop. Drawn at render time.',
    [curves('curves', true)], [curves()],
    [number('density', 'Density', 3, 0, 200, 0.1), number('length', 'Length', 0.08, 0.001, 10, 0.001),
      number('lift', 'Lift', 2.5, 0, 50, 0.1), number('hair', 'Free Ends', 0.35, 0, 1, 0.01),
      number('seed', 'Seed', 0, 0, 9999, 1, false)],
    { bypass: 'passthrough' }),
  ...WEAVE_OPERATORS,
  ...FIELD_OPERATORS,
  operator('render.strands', 'Strand Render', 'Draws the connected curves as thin strands in the shared 3D scene.',
    [curves('curves', true)], [{ id: 'scene', label: 'Scene', type: 'scene' }],
    [number('width', 'Width', 0.004, 0, 1, 0.0005), { id: 'color', label: 'Color', type: 'color', default: '#e8e2d6', animatable: true }],
    { bypass: 'mute' }),
];

const CURVE_OPERATOR_IDS = new Set(CURVE_OPERATORS.map(item => item.id));
export const isCurveOperator = (id: string) => CURVE_OPERATOR_IDS.has(id);
