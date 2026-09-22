import type { OperatorDefinition, OperatorParameter, OperatorPort } from '../../types/operatorGraph';

const number = (id: string, label: string, value: number, min: number, max: number, step = 0.01): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable: true });
const splats = (id: string): OperatorPort => ({ id, label: 'Splats', type: 'geometry', contract: { formats: ['gaussian-splats'] } });
const object = (id: string): OperatorPort => ({ id, label: 'Object', type: 'scene' });
const op = (id: string, label: string, description: string, parameters: OperatorParameter[]): OperatorDefinition => ({
  id: `splat.${id}`, version: 1, label, description, inputs: [splats('splats'), ...parameters.filter(p => p.animatable !== false).map(p => ({ id: p.id, label: p.label, type: 'number' as const }))], outputs: [splats('splats')],
  parameters, runtime: 'builtin', invalidates: 'appearance', addable: true, bypass: 'passthrough',
});
const xyz = (value: number, min: number, max: number) => ['x', 'y', 'z'].map(id => number(id, id.toUpperCase(), value, min, max));

export const SPLAT_OPERATORS: readonly OperatorDefinition[] = [
  { ...op('source', 'Splat Source', 'The imported splats in their original shared local coordinates.', []), inputs: [], addable: false },
  op('limit', 'Splat Size Clamp', 'Clamp linear radii without moving centers. Values are local units, not logarithms.', [number('min', 'Minimum radius', 0.001, 0.00001, 10), number('max', 'Maximum radius', 0.03, 0.00001, 10)]),
  op('scale', 'Splat Scale', 'Multiply each local Gaussian axis independently to create streaks and rays.', xyz(1, 0.001, 100)),
  op('rotate', 'Splat Rotation', 'Rotate Gaussian orientations in degrees while retaining their centers.', xyz(0, -360, 360)),
  op('color', 'Splat Color & Alpha', 'Multiply linear color and opacity independently.', [number('red', 'Red', 1, 0, 4), number('green', 'Green', 1, 0, 4), number('blue', 'Blue', 1, 0, 4), number('alpha', 'Opacity', 1, 0, 1)]),
  op('select', 'Splat Selection', 'Keep a stable seeded fraction. The source and other branches remain intact.', [number('fraction', 'Keep fraction', 0.2, 0, 1), number('seed', 'Seed', 42, 0, 999999, 1)]),
  op('noise', 'Splat Attribute Noise', 'Animated spatial noise on position (0), scale (1) or rotation (2). Rotation amplitude is in degrees; scale uses a positive exponential multiplier.', [
    number('attribute', 'Attribute: position / scale / rotation', 1, 0, 2, 1), ...xyz(0, -10, 10), number('frequency', 'Spatial frequency', 2, 0.001, 100), number('speed', 'Animation speed', 0.1, -10, 10), number('seed', 'Seed', 42, 0, 999999, 1),
  ]),
  { ...op('particles', 'Splat Particle Simulation', 'Emit from splat centers with seeded lifetimes and fixed-step force integration. Connect force and drag nodes; seeking replays each living particle from birth.', [
    number('lifetime', 'Lifetime (s)', 2, 0.1, 10), number('variance', 'Lifetime variance', 0.5, 0, 0.9), number('speed', 'Initial speed', 0.1, 0, 10), number('seed', 'Seed', 42, 0, 999999, 1),
  ]), inputs: [splats('splats'), { id: 'turbulenceField', label: 'Turbulence', type: 'force' }, { id: 'gravityField', label: 'Gravity', type: 'force' }, { id: 'dragField', label: 'Drag', type: 'drag' },
    ...['lifetime', 'variance', 'speed', 'seed'].map(id => ({ id, label: id, type: 'number' as const }))] },
  { ...op('turbulence', 'Turbulence Force', 'Spatial force field integrated along each particle path. Connect to the simulation turbulence input.', [number('strength', 'Strength', 0.2, 0, 10), number('frequency', 'Spatial frequency', 2, 0.01, 50)]),
    inputs: [{ id: 'strength', label: 'Strength', type: 'number' }, { id: 'frequency', label: 'Spatial frequency', type: 'number' }], outputs: [{ id: 'force', label: 'Turbulence', type: 'force' }], bypass: 'mute', addable: false },
  { ...op('gravity', 'Gravity Force', 'Constant vertical acceleration in local units per second squared.', [number('acceleration', 'Acceleration Y', 0, -10, 10)]),
    inputs: [{ id: 'acceleration', label: 'Acceleration Y', type: 'number' }], outputs: [{ id: 'force', label: 'Gravity', type: 'force' }], bypass: 'mute', addable: false },
  { ...op('drag', 'Particle Drag', 'Exponential velocity damping, independent of playback frame rate.', [number('coefficient', 'Drag', 0.4, 0, 10)]),
    inputs: [{ id: 'coefficient', label: 'Drag', type: 'number' }], outputs: [{ id: 'drag', label: 'Drag', type: 'drag' }], bypass: 'mute', addable: false },
  op('camera-fade', 'Camera Proximity Fade', 'Reduce radius and opacity smoothly in a sphere around the active scene camera. Distances are world units.', [number('radius', 'Clear radius', 0.2, 0, 100), number('transition', 'Transition', 0.5, 0.001, 100)]),
  { ...op('surface', 'Splats to Mesh', 'Approximate the source with a bounded density isosurface in the source coordinates. Connect to a Mesh and material. Reconstruction uses source positions and opacity before animated modifiers.', [
    number('resolution', 'Grid resolution', 32, 12, 64, 1), number('threshold', 'Density threshold', 0.35, 0.01, 4), number('radius', 'Kernel radius (cells)', 1.5, 0.5, 3),
  ].map(p => ({ ...p, animatable: false }))), inputs: [splats('splats'), ...['resolution', 'threshold', 'radius'].map(id => ({ id, label: id, type: 'number' as const }))], outputs: [{ id: 'geometry', label: 'Mesh geometry', type: 'geometry', contract: { formats: ['splat-mesh'] } }], bypass: 'mute', addable: false },
  { ...op('render', 'Gaussian Surface', 'Render the connected Gaussian attributes in the shared 3D scene. Budget caps actual GPU work; 0 uses the source budget.', [number('budget', 'Splat budget', 65536, 0, 1048576, 1)]), outputs: [object('scene')], bypass: 'mute', addable: false },
  { id: 'splat.merge', version: 1, label: 'Merge Splat Branches', description: 'Combine independent splat and reconstructed-mesh branches in the same scene.',
    inputs: ['a', 'b', 'c', 'd'].map(object), outputs: [object('scene')], parameters: [], runtime: 'builtin', invalidates: 'appearance', addable: true },
];
