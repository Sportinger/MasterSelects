import type { Keyframe } from '../../../types/keyframes';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { FlockVec3 } from '../../../types/flock';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { hexColorToRgb } from '../../../utils/colorParam';
import { flockHash01 } from './flockCompilerSupport';
import { evaluateScalarOperation } from '../../operators/scalarOperationSemantics';
import type {
  FlockColorRef,
  FlockNodeSpec,
  FlockNumberRef,
  FlockParamBundle,
  FlockProgram,
  FlockResolvedNode,
  FlockResolvedRender,
  FlockResolvedStep,
  FlockVecRef,
  ResolvedParamBundle,
} from './flockProgramTypes';

/** Returns a 0..1 level, or null when the referenced analysis is unavailable. */
export type FlockAudioSampler = (clipId: string, sourceTime: number, smoothingSeconds: number) => number | null;

export interface FlockEvaluationContext {
  keyframesByProperty: ReadonlyMap<string, Keyframe[]>;
  audio?: FlockAudioSampler;
}

export interface FlockValueEvaluation {
  values: number[];
  unavailableAudioClipIds: string[];
}

export function indexFlockKeyframes(keyframes: readonly Keyframe[] | undefined): Map<string, Keyframe[]> {
  const index = new Map<string, Keyframe[]>();
  for (const keyframe of keyframes ?? []) {
    if (!keyframe.property.startsWith('flock.node.')) continue;
    const list = index.get(keyframe.property) ?? [];
    list.push(keyframe);
    index.set(keyframe.property, list);
  }
  for (const [property, list] of index) {
    index.set(property, list.toSorted((a, b) => a.time - b.time));
  }
  return index;
}

function sampleProperty(
  context: FlockEvaluationContext,
  property: string | undefined,
  time: number,
  base: number,
): number {
  if (!property) return base;
  const keyframes = context.keyframesByProperty.get(property);
  if (!keyframes || keyframes.length === 0) return base;
  return interpolateKeyframes(keyframes, property as AnimatableProperty, time, base);
}

export function resolveNumber(
  ref: FlockNumberRef | undefined,
  time: number,
  values: readonly number[],
  context: FlockEvaluationContext,
  fallback = 0,
): number {
  if (!ref) return fallback;
  if (ref.valueIndex !== undefined && ref.valueIndex < values.length) {
    const driven = values[ref.valueIndex];
    if (Number.isFinite(driven)) return driven;
  }
  const value = sampleProperty(context, ref.property, time, ref.base);
  return Number.isFinite(value) ? value : ref.base;
}

export function resolveVector(ref: FlockVecRef | undefined, time: number, context: FlockEvaluationContext): FlockVec3 {
  if (!ref) return [0, 0, 0];
  if (!ref.properties) return [ref.base[0], ref.base[1], ref.base[2]];
  return [
    sampleProperty(context, ref.properties[0], time, ref.base[0]),
    sampleProperty(context, ref.properties[1], time, ref.base[1]),
    sampleProperty(context, ref.properties[2], time, ref.base[2]),
  ];
}

export function resolveColor(ref: FlockColorRef | undefined, time: number, context: FlockEvaluationContext): FlockVec3 {
  if (!ref) return [1, 1, 1];
  const rgb = hexColorToRgb(ref.base, '#ffffff');
  const channels: FlockVec3 = ref.properties
    ? [
        sampleProperty(context, ref.properties[0], time, rgb.r),
        sampleProperty(context, ref.properties[1], time, rgb.g),
        sampleProperty(context, ref.properties[2], time, rgb.b),
      ]
    : [rgb.r, rgb.g, rgb.b];
  return [
    Math.max(0, Math.min(1, channels[0] / 255)),
    Math.max(0, Math.min(1, channels[1] / 255)),
    Math.max(0, Math.min(1, channels[2] / 255)),
  ];
}

export function resolveBundle(
  bundle: FlockParamBundle,
  time: number,
  values: readonly number[],
  context: FlockEvaluationContext,
): ResolvedParamBundle {
  const n: Record<string, number> = {};
  const v: Record<string, FlockVec3> = {};
  const c: Record<string, FlockVec3> = {};
  for (const [key, ref] of Object.entries(bundle.numbers)) n[key] = resolveNumber(ref, time, values, context);
  for (const [key, ref] of Object.entries(bundle.vectors)) v[key] = resolveVector(ref, time, context);
  for (const [key, ref] of Object.entries(bundle.colors)) c[key] = resolveColor(ref, time, context);
  return { n, v, c, e: bundle.enums, i: bundle.integers, b: bundle.booleans, a: bundle.assets };
}

function smooth01(t: number): number {
  return t * t * (3 - 2 * t);
}

function oscillate(wave: string, phase: number): number {
  const fract = phase - Math.floor(phase);
  switch (wave) {
    case 'triangle':
      return 1 - 4 * Math.abs(fract - 0.5);
    case 'saw':
      return fract * 2 - 1;
    case 'square':
      return fract < 0.5 ? 1 : -1;
    case 'noise': {
      const cell = Math.floor(phase);
      const a = flockHash01(cell & 0x7fffffff, 9173) * 2 - 1;
      const b = flockHash01((cell + 1) & 0x7fffffff, 9173) * 2 - 1;
      return a + (b - a) * smooth01(fract);
    }
    default:
      return Math.sin(phase * Math.PI * 2);
  }
}

function applyCurve(curve: string, t: number): number {
  switch (curve) {
    case 'smooth':
      return smooth01(Math.max(0, Math.min(1, t)));
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    default:
      return t;
  }
}

/** Evaluates the scalar DAG (already topologically ordered by the compiler). */
export function evaluateFlockValues(
  program: Pick<FlockProgram, 'values'>,
  time: number,
  context: FlockEvaluationContext,
): FlockValueEvaluation {
  const values: number[] = [];
  const unavailableAudioClipIds: string[] = [];
  for (const spec of program.values) {
    const p = resolveBundle(spec.params, time, values, context);
    let result = 0;
    switch (spec.kind) {
      case 'value':
        result = p.n.value ?? 0;
        break;
      case 'time':
        result = time * (p.n.scale ?? 1) + (p.n.offset ?? 0);
        break;
      case 'oscillator':
        result = oscillate(p.e.wave ?? 'sine', time * (p.n.frequency ?? 0) + (p.n.phase ?? 0)) * (p.n.amplitude ?? 1) + (p.n.offset ?? 0);
        break;
      case 'math': {
        const a = p.n.a ?? 0;
        const b = p.n.b ?? 0;
        switch (p.e.op) {
          case 'add': result = evaluateScalarOperation('add', a, b); break;
          case 'subtract': result = evaluateScalarOperation('subtract', a, b); break;
          case 'divide': result = Math.abs(b) < 1e-9 ? 0 : a / b; break;
          case 'min': result = Math.min(a, b); break;
          case 'max': result = Math.max(a, b); break;
          case 'power': result = Math.sign(a) * Math.pow(Math.abs(a), b); break;
          case 'abs': result = Math.abs(a); break;
          case 'sin': result = Math.sin(a) * b; break;
          default: result = evaluateScalarOperation('multiply', a, b);
        }
        break;
      }
      case 'remap': {
        const span = (p.n.inMax ?? 1) - (p.n.inMin ?? 0);
        let t = Math.abs(span) < 1e-9 ? 0 : ((p.n.input ?? 0) - (p.n.inMin ?? 0)) / span;
        if (p.b.clamp !== false) t = evaluateScalarOperation('clamp', t, 0, 1);
        result = (p.n.outMin ?? 0) + ((p.n.outMax ?? 1) - (p.n.outMin ?? 0)) * applyCurve(p.e.curve ?? 'linear', t);
        break;
      }
      case 'audio': {
        const clipId = p.a.clipId ?? '';
        const level = clipId && context.audio
          ? context.audio(clipId, time + (p.n.offset ?? 0), Math.max(0, p.n.smoothing ?? 0))
          : null;
        if (level === null) {
          if (clipId) unavailableAudioClipIds.push(clipId);
          result = p.n.floor ?? 0;
        } else {
          result = Math.max(p.n.floor ?? 0, level) * (p.n.gain ?? 1);
        }
        break;
      }
    }
    values.push(Number.isFinite(result) ? result : 0);
  }
  return { values, unavailableAudioClipIds };
}

function resolveNodes<TSpec extends FlockNodeSpec>(
  specs: readonly TSpec[],
  time: number,
  values: readonly number[],
  context: FlockEvaluationContext,
): Array<FlockResolvedNode<TSpec>> {
  return specs.map((spec) => ({ spec, p: resolveBundle(spec.params, time, values, context) }));
}

/** Source time of a step. Warm-up steps run before source time 0 with parameters held at t=0. */
export function flockStepSourceTime(program: Pick<FlockProgram, 'dt' | 'simulation'>, step: number): number {
  return (step - program.simulation.warmupSteps) * program.dt;
}

export function resolveFlockStep(
  program: FlockProgram,
  step: number,
  context: FlockEvaluationContext,
): FlockResolvedStep {
  const time = Math.max(0, flockStepSourceTime(program, step));
  const { values } = evaluateFlockValues(program, time, context);
  const ops = resolveNodes(program.ops, time, values, context);
  let cellSize = 0;
  for (const op of ops) {
    if (op.spec.kind === 'rules') cellSize = Math.max(cellSize, op.p.n.neighborRadius ?? 0, op.p.n.separationRadius ?? 0);
  }
  return {
    step,
    time,
    dt: program.dt,
    sim: resolveBundle(program.simulation.params, time, values, context),
    emitters: resolveNodes(program.emitters, time, values, context),
    ops,
    selections: resolveNodes(program.selections, time, values, context),
    paths: resolveNodes(program.paths, time, values, context),
    obstacles: resolveNodes(program.obstacles, time, values, context),
    boundary: program.boundary ? { spec: program.boundary, p: resolveBundle(program.boundary.params, time, values, context) } : null,
    cellSize: Math.max(1, cellSize || 10),
  };
}

export function resolveFlockRender(
  program: FlockProgram,
  sourceTime: number,
  context: FlockEvaluationContext,
): FlockResolvedRender {
  const time = Math.max(0, sourceTime);
  const { values } = evaluateFlockValues(program, time, context);
  return {
    time,
    branches: resolveNodes(program.branches, time, values, context),
    palettes: resolveNodes(program.palettes, time, values, context),
    selections: resolveNodes(program.selections, time, values, context),
  };
}
