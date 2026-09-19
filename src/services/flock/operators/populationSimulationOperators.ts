import type { FlockOperatorDescriptor } from './flockOperatorTypes';
import { boolParam, enumParam, integerParam, numberParam, port, vecParam } from './flockParamBuilders';

/** Simulation space uses 100 units per shared-scene world unit (frame height = 2 world units). */
export const FLOCK_SIM_UNITS_PER_WORLD_UNIT = 100;
export const FLOCK_MAX_EMITTERS = 8;
export const FLOCK_MAX_CAPACITY = 1_048_576;

export const POPULATION_OPERATORS: FlockOperatorDescriptor[] = [
  {
    id: 'flock.emitter',
    version: 1,
    label: 'Emitter',
    category: 'population',
    description: 'Seeded particle births inside a shape. Capacity is fixed; animate Active Fraction or lifetime to change population.',
    phase: 'init',
    inputs: [],
    outputs: [port('spawn', 'Spawn', 'spawn')],
    params: [
      integerParam('count', 'Count', 4000, 'topology', { min: 1, max: FLOCK_MAX_CAPACITY }),
      enumParam('shape', 'Shape', 'sphere', ['sphere', 'shell', 'box', 'disc', 'point', 'line'], 'topology'),
      vecParam('center', 'Center', [0, 0, 0], 'behavior'),
      vecParam('size', 'Size', [80, 80, 80], 'behavior', { min: 0 }),
      integerParam('group', 'Group', 0, 'topology', { min: 0, max: 7 }),
      integerParam('seed', 'Seed', 1, 'topology', { min: 0, max: 999_999 }),
      enumParam('birthMode', 'Birth', 'burst', ['burst', 'stagger'], 'topology'),
      numberParam('stagger', 'Stagger Time', 2, 'behavior', { min: 0, unit: 's', advanced: true }),
      numberParam('activeFraction', 'Active Fraction', 1, 'behavior', { min: 0, max: 1, step: 0.01 }),
      numberParam('lifetime', 'Lifetime', 0, 'behavior', { min: 0, unit: 's', description: '0 keeps particles alive forever.' }),
      numberParam('lifetimeVariance', 'Lifetime Variance', 0.25, 'behavior', { min: 0, max: 1, step: 0.01, advanced: true }),
      boolParam('respawn', 'Respawn', true, 'behavior', { advanced: true }),
      numberParam('initialSpeed', 'Initial Speed', 20, 'behavior', { min: 0 }),
      vecParam('direction', 'Initial Heading', [0, 0, 1], 'behavior', { advanced: true }),
      numberParam('spread', 'Heading Spread', 1, 'behavior', { min: 0, max: 1, step: 0.01, advanced: true }),
    ],
    bypass: { kind: 'mute' },
    maxInstances: FLOCK_MAX_EMITTERS,
  },
  {
    id: 'flock.merge-spawn',
    version: 1,
    label: 'Merge Emitters',
    category: 'population',
    description: 'Combines several emitters into one spawn stream, in connection order.',
    phase: 'init',
    inputs: [port('spawn', 'Spawn', 'spawn', { required: true, repeated: true })],
    outputs: [port('spawn', 'Spawn', 'spawn')],
    params: [],
    bypass: { kind: 'none' },
  },
];

export const SIMULATION_OPERATORS: FlockOperatorDescriptor[] = [
  {
    id: 'flock.simulation',
    version: 1,
    label: 'Simulation',
    category: 'simulation',
    description: 'Owns the particle state. Advances a fixed source-time step and emits an immutable state sample.',
    phase: 'step',
    inputs: [
      port('spawn', 'Spawn', 'spawn', { required: true }),
      port('behavior', 'Behavior', 'behavior'),
      port('obstacles', 'Obstacles', 'obstacle', { repeated: true }),
      port('boundary', 'Boundary', 'boundary'),
    ],
    outputs: [port('particles', 'Particles', 'particles')],
    params: [
      enumParam('stepRate', 'Step Rate', '60', [
        { value: '30', label: '30 Hz' },
        { value: '60', label: '60 Hz' },
        { value: '120', label: '120 Hz' },
      ], 'topology'),
      numberParam('maxSpeed', 'Max Speed', 45, 'behavior', { min: 0 }),
      numberParam('minSpeed', 'Min Speed', 8, 'behavior', { min: 0 }),
      numberParam('maxAcceleration', 'Max Acceleration', 120, 'behavior', { min: 0, advanced: true }),
      numberParam('turnRate', 'Turn Smoothing', 6, 'behavior', { min: 0.1, max: 60, advanced: true }),
      integerParam('neighborLimit', 'Neighbors Sampled', 24, 'topology', {
        min: 1,
        max: 64,
        advanced: true,
        description: 'Target neighbor count. Dense neighborhoods are sampled with a deterministic stride instead of scanning every candidate.',
      }),
      integerParam('cellCandidates', 'Candidate Work Cap', 32, 'topology', {
        min: 4,
        max: 128,
        advanced: true,
        description: 'Caps candidates examined per particle (x8); a simulation-quality setting that changes results.',
      }),
      boolParam('planar', 'Planar (2D)', false, 'behavior'),
      enumParam('planarAxis', 'Planar Axis', 'z', ['x', 'y', 'z'], 'behavior', { advanced: true }),
      numberParam('warmup', 'Warm-up', 0, 'topology', { min: 0, max: 30, unit: 's', advanced: true }),
    ],
    bypass: { kind: 'none' },
    maxInstances: 1,
  },
];
