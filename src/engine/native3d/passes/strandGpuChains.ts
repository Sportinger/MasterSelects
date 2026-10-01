import type { GeometryStage } from '../../../services/operators/geometry/geometryProgram';
import type { RodStage } from '../../../services/operators/geometry/rodCurves';
import type { StrandThreadParams } from './StrandSurfaceBinder';
import { strandRadiusFieldCode, type StrandFieldCode } from './strandFieldShader';

/**
 * The tails of a geometry program the GPU evaluates per frame. Everything before a tail is
 * evaluated once per topology on the CPU (`restStages`); the tail changes only uniforms.
 */
type SurfaceBindStage = Extract<GeometryStage, { kind: 'surface-bind' }>;
type ThreadAlongStage = Extract<GeometryStage, { kind: 'thread-along' }>;

/** Thread Along progress that is the same for every point: the parameter, or a field folded to a constant. */
function uniformProgress(stage: ThreadAlongStage): number | null {
  if (!stage.progress) return stage.value;
  const { instructions, output } = stage.progress;
  return instructions.length === 1 && instructions[output].operation === 'constant' ? instructions[output].value ?? 0 : null;
}

/** Yarn Profile radius fields of `stages` compiled for the GPU; null when one has no WGSL form. */
function radiusFields(stages: readonly GeometryStage[]): StrandFieldCode | undefined | null {
  const radii = stages.flatMap(item => item.kind === 'yarn-profile' && item.radius ? [item.radius] : []);
  try { return radii.length ? strandRadiusFieldCode(radii) : undefined; } catch { return null; }
}

/**
 * A final Surface Bind, preceded by a tail of an optional Thread Along with uniform progress and
 * Yarn Profiles. The GPU then lifts, hides, scales the radius of and binds the cached rest curves,
 * so pulling threads in or animating a radius field (Reveal) changes uniforms only.
 */
export interface SurfaceBindChain { bind: SurfaceBindStage; thread: StrandThreadParams | null; fields: StrandFieldCode | undefined; restStages: GeometryStage[] }
export function surfaceBindChain(stages: readonly GeometryStage[]): SurfaceBindChain | null {
  const bind = stages.at(-1);
  if (bind?.kind !== 'surface-bind' || stages.length < 2) return null;
  const body = stages.slice(0, -1);
  let at = body.length;
  while (at > 1 && body[at - 1].kind === 'yarn-profile') at--;
  const stage = at > 1 && body[at - 1].kind === 'thread-along' ? body[at - 1] as ThreadAlongStage : null;
  const progress = stage ? uniformProgress(stage) : null;
  if (stage && progress !== null) at--;
  const fields = radiusFields(body.slice(at));
  if (fields === null) return { bind, thread: null, fields: undefined, restStages: body };
  // Same clamping as threadAlong.ts.
  const thread: StrandThreadParams | null = stage && progress !== null ? { progress: Number.isFinite(progress) ? progress : 0,
    stagger: Math.min(0.99, Math.max(0, stage.stagger)), lift: stage.lift, liftLength: Math.max(1e-6, stage.liftLength), settle: stage.settle } : null;
  return { bind, thread, fields, restStages: body.slice(0, at) };
}

/**
 * A Rod Simulation followed only by Yarn Profiles: the GPU simulates the rods from the cached rest
 * curves and writes the strand points itself. `topology` names the rest curves and the simulation
 * setup (everything but time), so a new frame only advances the simulation.
 */
export interface RodChain { rod: RodStage; fields: StrandFieldCode | undefined; restStages: GeometryStage[]; topology: string }
export function rodChain(stages: readonly GeometryStage[]): RodChain | null {
  const at = stages.findIndex(stage => stage.kind === 'rod-simulation');
  if (at < 1 || !stages.slice(at + 1).every(stage => stage.kind === 'yarn-profile')) return null;
  const fields = radiusFields(stages.slice(at + 1));
  if (fields === null) return null;
  const rod = stages[at] as RodStage, { time: _time, ...setup } = rod, restStages = stages.slice(0, at);
  return { rod, fields, restStages, topology: `${JSON.stringify(restStages)}\n${JSON.stringify(setup)}` };
}
