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
  { ...op('source', 'Source', 'The imported splats in their original shared local coordinates.', []), inputs: [], addable: false },
  op('limit', 'Size Clamp', 'Clamp linear radii without moving centers. Values are local units, not logarithms.', [number('min', 'Minimum radius', 0.001, 0.00001, 10), number('max', 'Maximum radius', 0.03, 0.00001, 10)]),
  op('scale', 'Scale', 'Multiply each local Gaussian axis independently to create streaks and rays.', xyz(1, 0.001, 100)),
  op('rotate', 'Rotation', 'Rotate Gaussian orientations in degrees while retaining their centers.', xyz(0, -360, 360)),
  op('color', 'Color & Alpha', 'Multiply linear color and opacity independently.', [number('red', 'Red', 1, 0, 4), number('green', 'Green', 1, 0, 4), number('blue', 'Blue', 1, 0, 4), number('alpha', 'Opacity', 1, 0, 1)]),
  op('select', 'Selection', 'Keep a stable seeded fraction. The source and other branches remain intact.', [number('fraction', 'Keep fraction', 0.2, 0, 1), number('seed', 'Seed', 42, 0, 999999, 1)]),
  op('noise', 'Attribute Noise', 'Animated spatial noise on position (0), scale (1) or rotation (2). Rotation amplitude is in degrees; scale uses a positive exponential multiplier.', [
    number('attribute', 'Attribute: position / scale / rotation', 1, 0, 2, 1), ...xyz(0, -10, 10), number('frequency', 'Spatial frequency', 2, 0.001, 100), number('speed', 'Animation speed', 0.1, -10, 10), number('seed', 'Seed', 42, 0, 999999, 1),
  ]),
  { ...op('particles', 'Particle Simulation', 'Emit from splat centers with seeded lifetimes and fixed-step force integration. Connect force and drag nodes; seeking replays each living particle from birth.', [
    number('lifetime', 'Lifetime (s)', 2, 0.1, 10), number('variance', 'Lifetime variance', 0.5, 0, 0.9), number('speed', 'Initial speed', 0.1, 0, 10), number('seed', 'Seed', 42, 0, 999999, 1),
  ]), inputs: [splats('splats'), { id: 'turbulenceField', label: 'Turbulence', type: 'force' }, { id: 'gravityField', label: 'Gravity', type: 'force' }, { id: 'dragField', label: 'Drag', type: 'drag' },
    ...['lifetime', 'variance', 'speed', 'seed'].map(id => ({ id, label: id, type: 'number' as const }))] },
  { ...op('turbulence', 'Turbulence', 'Spatial force field integrated along each particle path. Connect to the simulation turbulence input.', [number('strength', 'Strength', 0.2, 0, 10), number('frequency', 'Spatial frequency', 2, 0.01, 50)]),
    inputs: [{ id: 'strength', label: 'Strength', type: 'number' }, { id: 'frequency', label: 'Spatial frequency', type: 'number' }], outputs: [{ id: 'force', label: 'Turbulence', type: 'force' }], bypass: 'mute', addable: false },
  { ...op('gravity', 'Gravity', 'Constant vertical acceleration in local units per second squared.', [number('acceleration', 'Acceleration Y', 0, -10, 10)]),
    inputs: [{ id: 'acceleration', label: 'Acceleration Y', type: 'number' }], outputs: [{ id: 'force', label: 'Gravity', type: 'force' }], bypass: 'mute', addable: false },
  { ...op('drag', 'Drag', 'Exponential velocity damping, independent of playback frame rate.', [number('coefficient', 'Drag', 0.4, 0, 10)]),
    inputs: [{ id: 'coefficient', label: 'Drag', type: 'number' }], outputs: [{ id: 'drag', label: 'Drag', type: 'drag' }], bypass: 'mute', addable: false },
  op('conveyor', 'Conveyor', 'Scroll splats along a local axis (0 X, 1 Y, 2 Z) and wrap them into Wrap start .. Wrap start + Wrap length. Exact when seeking; repeats every Wrap length / |Speed| seconds. Travel adds a keyframeable distance for speed ramps and for placing the content seam; with Speed 0 the motion follows Travel alone. Downstream Release streams along this motion.', [
    number('axis', 'Axis: X / Y / Z', 2, 0, 2, 1), number('speed', 'Speed (units/s)', 1, -1000, 1000), number('start', 'Wrap start', -10, -10000, 10000), number('length', 'Wrap length', 20, 0.01, 20000),
    number('travel', 'Travel (keyframeable distance; animate with Speed 0 for ramps)', 0, -1000000, 1000000),
  ]),
  op('falloff-box', 'Falloff Box', 'Release weight for Release: 0 inside the solid half-size around Center, rising to 1 across Feather on each axis. Use a huge half-size to ignore an axis. Several boxes combine by maximum.', [
    ...['x', 'y', 'z'].map(id => number(`center${id.toUpperCase()}`, `Center ${id.toUpperCase()}`, 0, -10000, 10000)),
    ...['x', 'y', 'z'].map(id => number(`half${id.toUpperCase()}`, `Solid half-size ${id.toUpperCase()}`, id === 'z' ? 3 : 1000, 0, 100000)),
    ...['x', 'y', 'z'].map(id => number(`feather${id.toUpperCase()}`, `Feather ${id.toUpperCase()}`, 3, 0.001, 10000)),
    number('jitter', 'Edge jitter', 0.6, 0, 2),
  ]),
  { ...op('release', 'Release', 'Weighted splats (from an upstream Falloff Box) fly along a curl field from the connected Turbulence, rise or fall with Gravity (positive pulls toward local -Y, like Particle Simulation), shorten with Drag, stream along an upstream Conveyor (negative Stream drifts against it), shrink, glow and fade (Fade 0 keeps them as a scattered cloud they fly in from). Cycle 1 turns release into a round trip: a splat leaving the conveyor window drifts out through the gap and lands back on its own place as the strip re-enters; pair it with a closed Ring Bend. Closed form: exact when seeking and seamless per conveyor loop.', [
    number('flight', 'Flight distance', 6, 0, 1000), number('stream', 'Stream with motion (negative: against it)', 0.5, -10, 10), number('particleSize', 'Particle size', 0.3, 0, 1), number('glow', 'Particle glow', 0.3, 0, 8), number('seed', 'Seed', 7, 0, 999, 1),
    number('fade', 'Fade (0 keeps released splats as a scattered cloud)', 1, 0, 1),
    number('cycle', 'Cycle (round trip back to its place; needs Conveyor + Falloff Box)', 0, 0, 1),
    number('linger', 'Linger (Cycle: fly out fast, hold far out, accelerate back)', 0, 0, 1),
    number('dissolve', 'Dissolve spread (Linger: staggered departures along the exit)', 0, 0, 1),
    number('quality', 'Quality (curl path steps; 2-3 for fast preview, 10 for export)', 10, 1, 12, 1),
    number('density', 'Particle density (share of released splats that fly; the rest fade and are culled)', 1, 0, 1),
  ]), inputs: [splats('splats'), { id: 'turbulenceField', label: 'Turbulence', type: 'force' }, { id: 'gravityField', label: 'Gravity', type: 'force' }, { id: 'dragField', label: 'Drag', type: 'drag' },
    ...['flight', 'stream', 'particleSize', 'glow', 'seed', 'fade', 'cycle', 'linger', 'dissolve', 'quality', 'density'].map(id => ({ id, label: id, type: 'number' as const }))] },
  op('ring-bend', 'Ring Bend', 'Roll splats along axis X (0) or Z (2) onto the inside of a ring whose center lies Radius from Ground height along local Y (negative Radius for Y-down captures): the strip curves up ahead of and behind Center. Radius 0 or Bend 0 is flat; content that would fold through the ring axis fades out near it; Bend animates the curl smoothly around Center; |Radius| = conveyor Wrap length / 2pi closes a full ring. Keep released outside lets splats released upstream move only outward from their place and pushes them behind the ring surface as they leave, so flights stay out of the view from inside.', [
    number('axis', 'Axis: X / Z', 2, 0, 2, 1), number('center', 'Center', 0, -10000, 10000), number('radius', 'Radius (negative: toward -Y)', 30, -100000, 100000), number('ground', 'Ground height (local Y)', 0, -10000, 10000),
    number('keepOutside', 'Keep released outside (after Release)', 0, 0, 1),
    number('bend', 'Bend (0 flat .. 1 full Radius; keyframe to curl the strip)', 1, 0, 1),
  ]),
  op('camera-fade', 'Camera Fade', 'Reduce radius and opacity smoothly in a sphere around the active scene camera. Distances are world units.', [number('radius', 'Clear radius', 0.2, 0, 100), number('transition', 'Transition', 0.5, 0.001, 100)]),
  op('sphere-crop', 'Sphere Crop', 'Keep splat centers inside a sphere in source-local coordinates. Fade inward from the radius with Soft edge; bypass restores the input. Source data is unchanged.', [
    ...['x', 'y', 'z'].map(id => number(id, `Center ${id.toUpperCase()}`, 0, -10000, 10000)),
    number('radius', 'Radius', 1, 0, 10000), number('softness', 'Soft edge', 0, 0, 10000),
  ]),
  { ...op('surface', 'Splats to Mesh', 'Approximate source splats with a bounded density isosurface. Supports upstream Sphere Crop nodes including soft edges; other attribute modifiers are unsupported. Connect to a Mesh and material.', [
    number('resolution', 'Grid resolution', 32, 12, 64, 1), number('threshold', 'Density threshold', 0.35, 0.01, 4), number('radius', 'Kernel radius (cells)', 1.5, 0.5, 3),
  ].map(p => ({ ...p, animatable: false }))), inputs: [splats('splats'), ...['resolution', 'threshold', 'radius'].map(id => ({ id, label: id, type: 'number' as const }))], outputs: [{ id: 'geometry', label: 'Mesh geometry', type: 'geometry', contract: { formats: ['splat-mesh'] } }], bypass: 'mute', addable: false },
  { ...op('render', 'Gaussian Surface', 'Render the connected Gaussian attributes in the shared 3D scene. Budget caps actual GPU work; 0 uses the source budget.', [number('budget', 'Splat budget', 65536, 0, 1048576, 1)]), outputs: [object('scene')], bypass: 'mute', addable: false },
  { id: 'splat.merge', version: 1, label: 'Merge Branches', description: 'Combine independent splat and reconstructed-mesh branches in the same scene.',
    inputs: ['a', 'b', 'c', 'd'].map(object), outputs: [object('scene')], parameters: [], runtime: 'builtin', invalidates: 'appearance', addable: true },
];
