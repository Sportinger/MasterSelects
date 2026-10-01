import type { CurveSet } from './geometryEvaluation';
import type { GeometryStage } from './geometryProgram';
import { evaluateFieldColumn } from './curveFieldColumns';
import { buildRodRest, rodCurvePositions, type RodRest } from './rodRest';
import { ROD_STEP_RATE, RodSimulation } from './rodSolver';

type RodStage = Extract<GeometryStage, { kind: 'rod-simulation' }>;

/** Checkpointed simulations per render thread, least recently used first. */
const SIMULATION_LIMIT = 4;
const simulations = new Map<string, { rest: RodRest; simulation: RodSimulation }>();

/**
 * Curves of a Rod Simulation at the stage's source time. `inputKey` identifies the incoming curves
 * (the content of all earlier stages): they are the rest state, so new input starts a new
 * simulation. Pre-roll runs before time 0; between fixed steps the nodes are blended linearly so
 * any frame rate samples the same motion.
 */
export function simulateRodCurves(stage: RodStage, curves: CurveSet, inputKey: string): CurveSet {
  const { time, ...setup } = stage;
  const key = `${inputKey}\n${JSON.stringify(setup)}`;
  let entry = simulations.get(key);
  if (entry) simulations.delete(key);
  else {
    const pins = stage.pins && evaluateFieldColumn(stage.pins, curves);
    // Segment Length 0 spaces nodes one radius apart: finer rods add contact work, not detail (it stays on the points).
    const rest = buildRodRest(curves, stage.rod.segmentLength || stage.rod.radius, stage.rod.pin, pins ? index => Number(pins(index)) : undefined);
    entry = { rest, simulation: new RodSimulation(stage.rod, rest) };
  }
  simulations.set(key, entry);
  while (simulations.size > SIMULATION_LIMIT) simulations.delete(simulations.keys().next().value!);
  const exact = Math.max(0, ((Number.isFinite(time) ? time : 0) + stage.rod.preroll) * ROD_STEP_RATE);
  const step = Math.floor(exact + 1e-7), alpha = exact - step;
  const nodes = Float64Array.from(entry.simulation.positionsAt(step));
  if (alpha > 1e-6) {
    const next = entry.simulation.positionsAt(step + 1);
    for (let index = 0; index < nodes.length; index++) nodes[index] += (next[index] - nodes[index]) * alpha;
  }
  return { ...curves, positions: rodCurvePositions(entry.rest, nodes, curves) };
}

/** Catch-up cost is bounded by checkpoints; this only drops the cached states. */
export function clearRodSimulations() { simulations.clear(); }
