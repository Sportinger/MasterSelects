import type { OperatorDefinition, OperatorParameter } from '../../types/operatorGraph';

const number = (id: string, label: string, value: number, min: number, max: number): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step: 0.01, animatable: true });

/** Existing gravity/drag identities stay shared with cable physics. Positive gravity points down. */
export const PARTICLE_FORCE_OPERATORS: readonly OperatorDefinition[] = [
  { id: 'forces.gravity', version: 1, label: 'Gravity', description: 'Constant downward acceleration. Negative strength reverses its direction.',
    inputs: [], outputs: [{ id: 'force', label: 'Force', type: 'force' }], parameters: [number('strength', 'Strength', 1, -30, 30)],
    runtime: 'builtin', invalidates: 'simulation', addable: true, bypass: 'mute', implementation: 'shared', consumers: ['Cable physics', 'Gaussian particles'] },
  { id: 'forces.drag', version: 1, label: 'Drag', description: 'Velocity damping consumed by the connected simulation.',
    inputs: [], outputs: [{ id: 'drag', label: 'Drag', type: 'drag' }], parameters: [number('amount', 'Damping', 0.4, 0, 20)],
    runtime: 'builtin', invalidates: 'simulation', addable: true, bypass: 'mute', implementation: 'shared', consumers: ['Cable physics', 'Gaussian particles'] },
  { id: 'forces.turbulence', version: 1, label: 'Turbulence', description: 'Animated spatial sine/cosine force field integrated along each particle path.',
    inputs: [{ id: 'strength', label: 'Strength', type: 'number' }, { id: 'frequency', label: 'Spatial frequency', type: 'number' }],
    outputs: [{ id: 'force', label: 'Force', type: 'force' }], parameters: [number('strength', 'Strength', 0.2, 0, 10), number('frequency', 'Spatial frequency', 2, 0.01, 50)],
    runtime: 'builtin', invalidates: 'simulation', addable: true, bypass: 'mute', implementation: 'shared', consumers: ['Gaussian particles'] },
];
