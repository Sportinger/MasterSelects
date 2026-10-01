import type { BoundOperatorNode, EffectOperatorGraph } from '../../../types/operatorGraph';
import type { GeometryParameterReader } from './geometryProgram';
import { CLOTH_GRID_LIMIT, CLOTH_PINS } from './clothOperators';
import { compileSimulationForces, isSimulationForces, SIMULATION_FORCE_KEYS, type SimulationForces, type SimulationTurbulence,
  type SimulationWind } from './simulationForces';

export type ClothWind = SimulationWind;
export type ClothTurbulence = SimulationTurbulence;
/**
 * Everything a cloth simulation depends on, apart from time. Two equal specs produce the same
 * motion, so the render thread keys its checkpointed simulations by this value.
 */
export interface ClothSpec extends SimulationForces {
  nodeId: string; columns: number; rows: number; width: number; height: number; pin: number;
  stretch: number; bend: number; damping: number; substeps: number; preroll: number;
}

const finite = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Reads a Cloth Sheet and the general force nodes wired into it (see simulationForces.ts). */
export function compileClothSpec(graph: EffectOperatorGraph, cloth: BoundOperatorNode, read: GeometryParameterReader): ClothSpec {
  return {
    nodeId: cloth.id,
    columns: Math.round(clamp(finite(read(cloth, 'columns'), 'Columns'), 2, CLOTH_GRID_LIMIT)),
    rows: Math.round(clamp(finite(read(cloth, 'rows'), 'Rows'), 2, CLOTH_GRID_LIMIT)),
    width: Math.max(1e-3, finite(read(cloth, 'width'), 'Cloth width')), height: Math.max(1e-3, finite(read(cloth, 'height'), 'Cloth height')),
    pin: Math.max(0, CLOTH_PINS.indexOf(String(read(cloth, 'pin')) as typeof CLOTH_PINS[number])),
    stretch: clamp(finite(read(cloth, 'stretch'), 'Stretch stiffness'), 0, 1), bend: clamp(finite(read(cloth, 'bend'), 'Bend stiffness'), 0, 1),
    damping: Math.max(0, finite(read(cloth, 'damping'), 'Damping')),
    substeps: Math.round(clamp(finite(read(cloth, 'substeps'), 'Substeps'), 1, 32)),
    preroll: clamp(finite(read(cloth, 'preroll'), 'Pre-roll'), 0, 30),
    ...compileSimulationForces(graph, cloth, read),
  };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const within = (value: unknown, min: number, max: number) => number(value) && value >= min && value <= max;
const integer = (value: unknown, min: number, max: number) => Number.isInteger(value) && within(value, min, max);

/** Validates a transported spec: bounded grid, substeps, force counts and finite values. */
export function isClothSpec(value: unknown): value is ClothSpec {
  if (!record(value) || !exact(value, ['nodeId', 'columns', 'rows', 'width', 'height', 'pin', 'stretch', 'bend', 'damping', 'substeps',
    'preroll', ...SIMULATION_FORCE_KEYS]) || typeof value.nodeId !== 'string') return false;
  if (!integer(value.columns, 2, CLOTH_GRID_LIMIT) || !integer(value.rows, 2, CLOTH_GRID_LIMIT) || !integer(value.pin, 0, CLOTH_PINS.length - 1)
    || !integer(value.substeps, 1, 32) || !within(value.preroll, 0, 30) || !within(value.stretch, 0, 1) || !within(value.bend, 0, 1)
    || !within(value.width, 1e-3, 1e6) || !within(value.height, 1e-3, 1e6) || !within(value.damping, 0, 1e6)) return false;
  return isSimulationForces(value);
}
