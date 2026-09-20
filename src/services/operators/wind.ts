import type { OperatorDefinition } from '../../types/operatorGraph';

/** Shared wind contract. Each simulation supplies its coordinate conversion and gust signal. */
export const WIND_OPERATOR: OperatorDefinition = {
  id: 'forces.wind', version: 1, label: 'Wind',
  description: 'Directional force. Connect a scalar to drive its strength.',
  inputs: [{ id: 'strength', label: 'Strength', type: 'number' }],
  outputs: [{ id: 'force', label: 'Force', type: 'force' }],
  parameters: [
    { id: 'direction', label: 'Direction', type: 'vector', default: [0, 0, 1] },
    { id: 'strength', label: 'Strength', type: 'number', default: 5, min: 0, max: 30, step: 0.1, animatable: true },
    { id: 'gust', label: 'Gusts', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, animatable: true },
  ],
  invalidates: 'simulation', runtime: 'builtin', bypass: 'mute', addable: true,
};

export function directionFromAngles(yaw: number, pitch: number): [number, number, number] {
  const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
}

export function windForce(direction: readonly number[], strength: number, gust: number, modulation: number, normalized = false): [number, number, number] {
  const length = normalized ? 1 : Math.hypot(...direction) || 1;
  const amplitude = 1 + gust * modulation;
  return [direction[0] / length * strength * amplitude, direction[1] / length * strength * amplitude, direction[2] / length * strength * amplitude];
}

/** Legacy cable modulation is retained so saved projects rebake without changing their wind. */
export function periodicWindModulation(time: number): number {
  return (Math.sin(time * Math.PI * 1.2) + 0.35 * Math.sin(time * Math.PI * 2.7)) / 1.35;
}

/** Same directional-force operation in GPU simulations. */
export const WIND_FORCE_WGSL = `
fn sharedWindForce(direction: vec3f, strength: f32, gust: f32, modulation: f32) -> vec3f {
  return direction * strength * (1.0 + gust * modulation);
}`;
