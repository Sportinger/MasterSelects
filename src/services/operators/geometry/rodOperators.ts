import type { OperatorDefinition, OperatorParameter, OperatorPort } from '../../../types/operatorGraph';

/** Curve points a Rod Simulation holds in place: none, the first point of each curve, or both ends. */
export const ROD_PINS = ['none', 'start', 'ends'] as const;
/** Upper bound of simulated rod nodes per Rod Simulation; denser input is coarsened to fit. */
export const ROD_NODE_LIMIT = 16_384;
/** Every curve keeps at least two nodes (three on rings), so the curve count is bounded too. */
export const ROD_CURVE_LIMIT = 4096;
export const ROD_SUBSTEP_LIMIT = 64;

const curves = (required = false): OperatorPort => ({ id: 'curves', label: 'Curves', type: 'curves', required, contract: { formats: ['strand-curves'] } });
const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable: false });

/**
 * General rod simulation: any curves become elastic rods with thickness that collide with each
 * other and themselves. Its incoming curves are the rest state at the start of the simulation.
 */
export const ROD_OPERATORS: readonly OperatorDefinition[] = [
  { id: 'geometry.rod-simulation', version: 1, label: 'Rod Simulation',
    description: 'Simulates the incoming curves as elastic rods with thickness in the source time of their clip: they bend, barely stretch, collide with each other and themselves with friction, and can rest on a floor. Pin holds curve ends or the points where Pin is above 0.5; Pull draws pinned ends outward over Pull Time to tighten knots. Segment Length sets the rod resolution (0 = one radius); finer curve detail rides along.',
    inputs: [curves(true), { id: 'pin', label: 'Pin', type: 'number' }, { id: 'forces', label: 'Forces', type: 'force', repeated: true },
      { id: 'drag', label: 'Drag', type: 'drag', repeated: true }],
    outputs: [curves()],
    parameters: [number('radius', 'Radius', 0.03, 0.0005, 10, 0.001), number('segmentLength', 'Segment Length', 0, 0, 100, 0.001),
      number('stretch', 'Stretch Stiffness', 0.9, 0, 1), number('bend', 'Bend Stiffness', 0.5, 0, 1),
      number('friction', 'Friction', 0.3, 0, 2), number('damping', 'Damping', 0.5, 0, 20),
      number('substeps', 'Substeps', 16, 1, ROD_SUBSTEP_LIMIT, 1), number('preroll', 'Pre-roll', 0.5, 0, 30, 0.1),
      { id: 'pin', label: 'Pin', type: 'select', default: 'ends', animatable: false, options: [{ value: 'none', label: 'None' },
        { value: 'start', label: 'Curve starts' }, { value: 'ends', label: 'Curve ends' }] },
      number('pull', 'Pull', 0, -100, 100, 0.001), number('pullTime', 'Pull Time', 2, 0.01, 60, 0.1),
      { id: 'floor', label: 'Floor', type: 'select', default: 'none', animatable: false, options: [{ value: 'none', label: 'None' },
        { value: 'floor', label: 'Floor plane' }] },
      number('floorHeight', 'Floor Height', -1, -1000, 1000, 0.01)],
    invalidates: 'simulation', runtime: 'builtin', state: 'simulation', bypass: 'passthrough', addable: true,
    implementation: 'shared', consumers: ['Weave'] },
];
