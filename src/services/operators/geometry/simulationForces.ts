import type { BoundOperatorNode, EffectOperatorGraph } from '../../../types/operatorGraph';
import { getEffectOperator } from '../operatorRegistry';
import { periodicWindModulation, windForce } from '../wind';
import type { GeometryParameterReader } from './geometryProgram';

const FORCE_LIMIT = 8;

export interface SimulationWind { direction: [number, number, number]; strength: number; gust: number }
export interface SimulationTurbulence { strength: number; frequency: number }
/** Force inputs shared by the geometry simulations (Cloth Sheet, Rod Simulation). */
export interface SimulationForces { gravity: number; drag: number; winds: SimulationWind[]; turbulence: SimulationTurbulence[] }
export const SIMULATION_FORCE_KEYS = ['gravity', 'drag', 'winds', 'turbulence'] as const;

const finite = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
};
const label = (node: BoundOperatorNode) => getEffectOperator(node.operator)?.label ?? node.operator;

/**
 * Reads the general force nodes wired into a simulation node's `forces` and `drag` inputs. Force
 * nodes contribute their own parameters; their scalar inputs are not evaluated for simulations yet,
 * so a connected one is an error rather than a silently ignored cable.
 */
export function compileSimulationForces(graph: EffectOperatorGraph, owner: BoundOperatorNode, read: GeometryParameterReader): SimulationForces {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const inputs = (input: string) => graph.edges.filter(edge => edge.to === owner.id && edge.input === input)
    .map(edge => nodes.get(edge.from)!).filter(node => !node.bypassed);
  const forces: SimulationForces = { gravity: 0, drag: 0, winds: [], turbulence: [] };
  for (const force of inputs('forces')) {
    if (graph.edges.some(edge => edge.to === force.id)) throw new Error(`${label(force)}: ${label(owner)} reads its values from the node; disconnect its inputs.`);
    if (force.operator === 'forces.gravity') forces.gravity += finite(read(force, 'strength'), 'Gravity');
    else if (force.operator === 'forces.wind') {
      const direction = read(force, 'direction');
      if (!Array.isArray(direction) || direction.length !== 3) throw new Error('Wind direction must be a vector.');
      forces.winds.push({ direction: direction.map(value => finite(value, 'Wind direction')) as [number, number, number],
        strength: finite(read(force, 'strength'), 'Wind strength'), gust: finite(read(force, 'gust'), 'Gusts') });
    } else if (force.operator === 'forces.turbulence') {
      forces.turbulence.push({ strength: finite(read(force, 'strength'), 'Turbulence strength'),
        frequency: finite(read(force, 'frequency'), 'Turbulence frequency') });
    } else throw new Error(`${label(force)} cannot drive ${label(owner)}.`);
  }
  for (const drag of inputs('drag')) forces.drag += Math.max(0, finite(read(drag, 'amount'), 'Drag'));
  if (forces.winds.length > FORCE_LIMIT || forces.turbulence.length > FORCE_LIMIT) throw new Error(`${label(owner)} accepts up to ${FORCE_LIMIT} winds and turbulences.`);
  return forces;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** Validates the force fields of a transported simulation spec. */
export function isSimulationForces(value: Record<string, unknown>): boolean {
  if (!number(value.gravity) || !number(value.drag) || value.drag < 0 || value.drag > 1e6) return false;
  const winds = value.winds, turbulence = value.turbulence;
  return Array.isArray(winds) && winds.length <= FORCE_LIMIT && winds.every(wind => record(wind) && exact(wind, ['direction', 'strength', 'gust'])
      && Array.isArray(wind.direction) && wind.direction.length === 3 && wind.direction.every(number) && number(wind.strength) && number(wind.gust))
    && Array.isArray(turbulence) && turbulence.length <= FORCE_LIMIT
    && turbulence.every(item => record(item) && exact(item, ['strength', 'frequency']) && number(item.strength) && number(item.frequency));
}

/** Gusting wind of all Wind nodes at simulation time `time` (seconds); the same at every point. */
export function windVelocity(forces: SimulationForces, time: number): [number, number, number] {
  const wind: [number, number, number] = [0, 0, 0], modulation = periodicWindModulation(time);
  for (const item of forces.winds) windForce(item.direction, item.strength, item.gust, modulation).forEach((value, axis) => { wind[axis] += value; });
  return wind;
}

/** Air velocity at a point: `wind` plus the animated turbulence fields, written to `out` at `offset`. */
export function airVelocity(forces: SimulationForces, wind: readonly number[], time: number, x: number, y: number, z: number,
  out: Float64Array, offset: number) {
  let ax = wind[0], ay = wind[1], az = wind[2];
  for (const field of forces.turbulence) {
    const f = field.frequency, s = field.strength;
    ax += s * Math.sin(f * y + 1.3 * time); ay += s * Math.sin(f * z + 1.7 * time + 1); az += s * Math.sin(f * x + 1.1 * time + 2);
  }
  out[offset] = ax; out[offset + 1] = ay; out[offset + 2] = az;
}
