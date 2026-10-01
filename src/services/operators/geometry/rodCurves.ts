import type { CurveSet } from './geometryEvaluation';
import type { GeometryStage } from './geometryProgram';
import { evaluateFieldColumn } from './curveFieldColumns';
import { buildRodRest, rodCurvePositions, type RodRest } from './rodRest';
import { ROD_STEP_RATE, RodSimulation } from './rodSolver';

export type RodStage = Extract<GeometryStage, { kind: 'rod-simulation' }>;

/** Thrown when a simulation needs more work than its budget allows; `curves` are its rest curves. */
export class RodSimulationDeferred extends Error {
  readonly curves: CurveSet;
  constructor(curves: CurveSet) {
    super('Rod Simulation needs more work than this evaluation allows.');
    this.curves = curves;
  }
}

/** Checkpointed simulations per render thread, least recently used first; built on first use. */
const SIMULATION_LIMIT = 4;
const simulations = new Map<string, { rest: RodRest; simulation?: RodSimulation }>();

/**
 * Curves of a Rod Simulation at the stage's source time. `inputKey` identifies the incoming curves
 * (the content of all earlier stages): they are the rest state, so new input starts a new
 * simulation. Pre-roll runs before time 0; between fixed steps the nodes are blended linearly so
 * any frame rate samples the same motion. `budget` bounds the work (rod nodes × substeps) of this
 * call: when reaching the frame needs more, nothing is simulated and RodSimulationDeferred is thrown.
 */
export function simulateRodCurves(stage: RodStage, curves: CurveSet, inputKey: string, budget = Infinity): CurveSet {
  const { time, ...setup } = stage;
  const key = `${inputKey}\n${JSON.stringify(setup)}`;
  let entry = simulations.get(key);
  if (entry) simulations.delete(key);
  else entry = { rest: rodRestFor(stage, curves) };
  simulations.set(key, entry);
  while (simulations.size > SIMULATION_LIMIT) simulations.delete(simulations.keys().next().value!);
  const { step, alpha } = rodStepAt(stage), last = step + (alpha > 1e-6 ? 1 : 0);
  const pending = entry.simulation ? entry.simulation.catchUp(last).steps : last;
  if (pending * (entry.rest.positions.length / 3) * stage.rod.substeps > budget) throw new RodSimulationDeferred(curves);
  const simulation = entry.simulation ??= new RodSimulation(stage.rod, entry.rest);
  const nodes = Float64Array.from(simulation.positionsAt(step));
  if (alpha > 1e-6) {
    const next = simulation.positionsAt(step + 1);
    for (let index = 0; index < nodes.length; index++) nodes[index] += (next[index] - nodes[index]) * alpha;
  }
  return { ...curves, positions: rodCurvePositions(entry.rest, nodes, curves) };
}

/** The rods of a Rod Simulation stage over its incoming curves (shared with the GPU solver). */
export function rodRestFor(stage: RodStage, curves: CurveSet): RodRest {
  const pins = stage.pins && evaluateFieldColumn(stage.pins, curves), form = stage.form && evaluateFieldColumn(stage.form, curves);
  const pullStart = stage.pullStart && evaluateFieldColumn(stage.pullStart, curves);
  // Segment Length 0 spaces nodes one radius apart: finer rods add contact work, not detail (it stays on the points).
  return buildRodRest(curves, stage.rod.segmentLength || stage.rod.radius, stage.rod.pin, { pinValue: pins ? index => Number(pins(index)) : undefined,
    formValue: form ? index => Number(form(index)) : undefined, pullStartValue: pullStart ? index => Number(pullStart(index)) : undefined,
    straight: stage.rod.start === 1 });
}

/** Simulation time of a frame as a fixed step and the blend toward the next one (pre-roll included). */
export function rodStepAt(stage: RodStage): { step: number; alpha: number } {
  const exact = Math.max(0, ((Number.isFinite(stage.time) ? stage.time : 0) + stage.rod.preroll) * ROD_STEP_RATE);
  const step = Math.floor(exact + 1e-7);
  return { step, alpha: exact - step };
}

/** Catch-up cost is bounded by checkpoints; this only drops the cached states. */
export function clearRodSimulations() { simulations.clear(); }
