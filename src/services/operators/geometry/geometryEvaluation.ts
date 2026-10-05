import { weavePatternPointCount, type GeometryProgram, type GeometryStage } from './geometryProgram';
import { warpOver } from './weaveOperators';
import { bindToCloth, clothGridAt } from './clothSurface';
import { evaluateFieldColumn } from './curveFieldColumns';
import { celticKnotCurves, knotCurves } from './knotCurves';
import { knitCurves } from './knitCurves';
import { knitSphereCurves } from './knitSphereCurves';
import { extendCurves } from './extendCurves';
import { closeCurves } from './closeCurves';
import { knitCycleCurves } from './knitCycleGuides';
import { knitPassageCurves } from './knitPassageCurves';
import { threadAlong } from './threadAlong';
import { simulateRodCurves } from './rodCurves';
import { separateCurveContacts } from './curveContacts';
import { flowClosedCurves } from './curveFlow';

/**
 * Polylines as flat XYZ positions; strand `i` owns points `starts[i]` … `starts[i] + counts[i] - 1`.
 * `radius` is an optional per-point yarn radius scale written by Yarn Profile (absent means 1).
 */
export interface CurveSet { positions: Float32Array; starts: Uint32Array; counts: Uint32Array; radius?: Float32Array }

/** Cosine crimp between crossings at t = k + 0.5; ends hold their outer crossing height. */
function crimpHeight(t: number, crossings: number, lift: (crossing: number) => number): number {
  const c = t - 0.5;
  if (c <= 0) return lift(0);
  if (c >= crossings - 1) return lift(crossings - 1);
  const k = Math.floor(c), f = c - k, a = lift(k);
  return a + (lift(k + 1) - a) * (0.5 - 0.5 * Math.cos(Math.PI * f));
}

/** Warps run vertically (index across X), wefts horizontally; the draft decides which lies in front (+Z). */
function weavePattern(stage: Extract<GeometryStage, { kind: 'weave-pattern' }>): CurveSet {
  const { warps, wefts, width, height, crimp, resolution, pattern } = stage;
  const positions = new Float32Array(weavePatternPointCount(stage) * 3);
  const starts = new Uint32Array(warps + wefts), counts = new Uint32Array(warps + wefts);
  let cursor = 0;
  const thread = (strand: number, crossings: number, place: (t: number) => [number, number, number]) => {
    starts[strand] = cursor; counts[strand] = crossings * resolution + 1;
    for (let point = 0; point < counts[strand]; point++, cursor++) positions.set(place(point / resolution), cursor * 3);
  };
  for (let i = 0; i < warps; i++) {
    const x = ((i + 0.5) / warps - 0.5) * width;
    thread(i, wefts, t => [x, (t / wefts - 0.5) * height, crimpHeight(t, wefts, j => warpOver(pattern, i, j) ? crimp : -crimp)]);
  }
  for (let j = 0; j < wefts; j++) {
    const y = ((j + 0.5) / wefts - 0.5) * height;
    thread(warps + j, warps, t => [(t / warps - 0.5) * width, y, crimpHeight(t, warps, i => warpOver(pattern, i, j) ? -crimp : crimp)]);
  }
  return { positions, starts, counts };
}

/**
 * Stages before the first simulation or authored animation do not depend on its time. Each result is kept
 * under the content of all stages up to it, so a change late in that chain (an animated Yarn
 * Profile radius) reuses the earlier curves, and field columns keyed by those curves stay valid.
 */
const PREFIX_LIMIT = 16;
const PREFIX_BYTE_LIMIT = 64 * 1024 * 1024;
const prefixes = new Map<string, CurveSet>();

/**
 * Runs the curve stages on the CPU. Modifiers read Position and fields on the incoming points.
 * With cloth or rods, only the simulated stage and later ones are evaluated again for a new frame.
 * `rodBudget` bounds the rod simulation work of this call (see simulateRodCurves).
 */
export function evaluateGeometryProgram(program: GeometryProgram, options: { rodBudget?: number } = {}): CurveSet {
  const split = program.stages.findIndex(stage => stage.kind === 'surface-bind' || stage.kind === 'rod-simulation' || stage.kind === 'knit-passage');
  const cached = split < 0 ? program.stages.length : split;
  let curves: CurveSet | undefined, key = '';
  for (let index = 0; index < cached; index++) {
    key += `${JSON.stringify(program.stages[index])}
`;
    let next = prefixes.get(key);
    if (next) prefixes.delete(key);
    else next = evaluateStages([program.stages[index]], curves);
    prefixes.set(key, next);
    curves = next;
  }
  const bytes = (curve: CurveSet) => curve.positions.byteLength + curve.starts.byteLength + curve.counts.byteLength + (curve.radius?.byteLength ?? 0);
  let retained = [...prefixes.values()].reduce((sum, curve) => sum + bytes(curve), 0);
  while (prefixes.size > PREFIX_LIMIT || retained > PREFIX_BYTE_LIMIT) {
    const oldest = prefixes.keys().next().value!;
    retained -= bytes(prefixes.get(oldest)!); prefixes.delete(oldest);
  }
  return evaluateStages(program.stages.slice(cached), curves, key, options.rodBudget);
}

/** Stages never modify their input curves, so a cached prefix can be shared. `key` names the initial curves. */
function evaluateStages(stages: readonly GeometryStage[], initial?: CurveSet, key = '', rodBudget = Infinity): CurveSet {
  let curves: CurveSet = initial ?? { positions: new Float32Array(0), starts: new Uint32Array(0), counts: new Uint32Array(0) };
  for (const stage of stages) {
    if (stage.kind === 'curve-line') {
      const positions = new Float32Array(stage.points * 3);
      for (let index = 0; index < stage.points; index++) positions[index * 3 + stage.axis] = (index / (stage.points - 1) - 0.5) * stage.length;
      curves = { positions, starts: Uint32Array.of(0), counts: Uint32Array.of(stage.points) };
    } else if (stage.kind === 'weave-pattern') {
      curves = weavePattern(stage);
    } else if (stage.kind === 'knot') {
      curves = knotCurves(stage);
    } else if (stage.kind === 'celtic-knot') {
      curves = celticKnotCurves(stage);
    } else if (stage.kind === 'knit') {
      curves = knitCurves(stage);
    } else if (stage.kind === 'knit-cycle') {
      curves = knitCycleCurves(stage);
    } else if (stage.kind === 'knit-passage') {
      curves = knitPassageCurves(stage);
    } else if (stage.kind === 'knit-sphere') {
      curves = knitSphereCurves(stage);
    } else if (stage.kind === 'thread-along') {
      curves = threadAlong(stage, curves);
    } else if (stage.kind === 'extend') {
      curves = extendCurves(stage, curves);
    } else if (stage.kind === 'close-curve') {
      curves = closeCurves(curves, stage);
    } else if (stage.kind === 'strand-array') {
      const { positions, starts, counts, radius } = curves;
      const pointTotal = positions.length / 3, strandTotal = counts.length;
      const next: CurveSet = { positions: new Float32Array(positions.length * stage.count),
        starts: new Uint32Array(strandTotal * stage.count), counts: new Uint32Array(strandTotal * stage.count),
        ...(radius ? { radius: new Float32Array(radius.length * stage.count) } : {}) };
      for (let copy = 0; copy < stage.count; copy++) {
        const shift = (copy - (stage.count - 1) / 2) * stage.spacing;
        next.positions.set(positions, copy * positions.length);
        if (radius) next.radius!.set(radius, copy * radius.length);
        for (let point = 0; point < pointTotal; point++) next.positions[(copy * pointTotal + point) * 3 + stage.axis] += shift;
        for (let strand = 0; strand < strandTotal; strand++) {
          next.starts[copy * strandTotal + strand] = copy * pointTotal + starts[strand];
          next.counts[copy * strandTotal + strand] = counts[strand];
        }
      }
      curves = next;
    } else if (stage.kind === 'set-position') {
      const { positions, starts, counts } = curves, next = new Float32Array(positions.length);
      const target = stage.position && evaluateFieldColumn(stage.position, curves);
      const offset = stage.offset && evaluateFieldColumn(stage.offset, curves);
      for (let strand = 0; strand < counts.length; strand++) {
        for (let index = starts[strand], end = index + counts[strand]; index < end; index++) {
          const moved = target ? target(index) as number[] : undefined, shift = offset ? offset(index) as number[] : undefined;
          for (let component = 0; component < 3; component++) {
            next[index * 3 + component] = (moved ? moved[component] : positions[index * 3 + component]) + (shift?.[component] ?? 0);
          }
        }
      }
      curves = { ...curves, positions: next };
    } else if (stage.kind === 'surface-bind') {
      curves = { ...curves, positions: bindToCloth(curves.positions, clothGridAt(stage.cloth, stage.time), stage.height) };
    } else if (stage.kind === 'curve-flow') {
      curves = flowClosedCurves(curves, stage.phase);
    } else if (stage.kind === 'curve-contact') {
      curves = separateCurveContacts(curves, stage);
    } else if (stage.kind === 'rod-simulation') {
      // Compilation places a rod stage first among the uncached stages, so `key` names its rest curves.
      curves = simulateRodCurves(stage, curves, key, rodBudget);
    } else if (stage.radius) {
      const { starts, counts } = curves, field = evaluateFieldColumn(stage.radius, curves), radius = new Float32Array(curves.positions.length / 3);
      for (let strand = 0; strand < counts.length; strand++) {
        // Multiplies an incoming radius scale, such as Thread Along hiding the curve ahead of its tip.
        for (let index = starts[strand], end = index + counts[strand]; index < end; index++) {
          radius[index] = Math.max(0, Number(field(index))) * (curves.radius ? curves.radius[index] : 1);
        }
      }
      curves = { ...curves, radius };
    }
  }
  return curves;
}
