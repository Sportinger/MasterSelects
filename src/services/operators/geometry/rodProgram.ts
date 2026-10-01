import type { BoundOperatorNode, EffectOperatorGraph } from '../../../types/operatorGraph';
import type { GeometryParameterReader } from './geometryProgram';
import { ROD_PINS, ROD_SUBSTEP_LIMIT } from './rodOperators';
import { compileSimulationForces, isSimulationForces, SIMULATION_FORCE_KEYS, type SimulationForces } from './simulationForces';

/**
 * Everything a rod simulation depends on apart from its rest curves and time. Stiffness values run
 * from 0 to 1 (see rodSolver.ts); `segmentLength` 0 spaces rod nodes one radius apart; `pin` indexes
 * ROD_PINS; `pull` is the distance pinned ends travel outward over `pullTime` seconds from source time 0.
 */
export interface RodSpec extends SimulationForces {
  nodeId: string; radius: number; segmentLength: number; stretch: number; bend: number; friction: number; damping: number;
  substeps: number; preroll: number; pin: number; pull: number; pullTime: number; floor: boolean; floorHeight: number;
}
const ROD_KEYS = ['nodeId', 'radius', 'segmentLength', 'stretch', 'bend', 'friction', 'damping', 'substeps', 'preroll', 'pin', 'pull',
  'pullTime', 'floor', 'floorHeight', ...SIMULATION_FORCE_KEYS];

const finite = (value: unknown, label: string) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Reads a Rod Simulation node and the general force nodes wired into it. */
export function compileRodSpec(graph: EffectOperatorGraph, rod: BoundOperatorNode, read: GeometryParameterReader): RodSpec {
  return {
    nodeId: rod.id,
    radius: clamp(finite(read(rod, 'radius'), 'Rod radius'), 0.0005, 10),
    segmentLength: clamp(finite(read(rod, 'segmentLength'), 'Segment length'), 0, 100),
    stretch: clamp(finite(read(rod, 'stretch'), 'Stretch stiffness'), 0, 1), bend: clamp(finite(read(rod, 'bend'), 'Bend stiffness'), 0, 1),
    friction: clamp(finite(read(rod, 'friction'), 'Friction'), 0, 2), damping: clamp(finite(read(rod, 'damping'), 'Damping'), 0, 20),
    substeps: Math.round(clamp(finite(read(rod, 'substeps'), 'Substeps'), 1, ROD_SUBSTEP_LIMIT)),
    preroll: clamp(finite(read(rod, 'preroll'), 'Pre-roll'), 0, 30),
    pin: Math.max(0, ROD_PINS.indexOf(String(read(rod, 'pin')) as typeof ROD_PINS[number])),
    pull: clamp(finite(read(rod, 'pull'), 'Pull'), -100, 100), pullTime: clamp(finite(read(rod, 'pullTime'), 'Pull time'), 0.01, 60),
    floor: read(rod, 'floor') === 'floor', floorHeight: clamp(finite(read(rod, 'floorHeight'), 'Floor height'), -1000, 1000),
    ...compileSimulationForces(graph, rod, read),
  };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const within = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Validates a transported spec: the same bounds compileRodSpec produces. */
export function isRodSpec(value: unknown): value is RodSpec {
  if (!record(value) || !Object.keys(value).every(key => ROD_KEYS.includes(key)) || typeof value.nodeId !== 'string') return false;
  return within(value.radius, 0.0005, 10) && within(value.segmentLength, 0, 100) && within(value.stretch, 0, 1) && within(value.bend, 0, 1)
    && within(value.friction, 0, 2) && within(value.damping, 0, 20) && Number.isInteger(value.substeps) && within(value.substeps, 1, ROD_SUBSTEP_LIMIT)
    && within(value.preroll, 0, 30) && Number.isInteger(value.pin) && within(value.pin, 0, ROD_PINS.length - 1)
    && within(value.pull, -100, 100) && within(value.pullTime, 0.01, 60) && typeof value.floor === 'boolean'
    && within(value.floorHeight, -1000, 1000) && isSimulationForces(value);
}
