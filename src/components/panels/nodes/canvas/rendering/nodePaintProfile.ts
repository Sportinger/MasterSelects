export type PaintPhase = 'paint-nodes' | 'paint-edges' | 'paint-covers' | 'paint-overlay';
export interface PaintPhaseTiming { name: PaintPhase; duration: number; count: number }
let phases: Map<PaintPhase, PaintPhaseTiming> | undefined;
/** Callers guard with DEV; worker timings are relayed to window User Timing. */
export function recordPaintPhase(name: PaintPhase, duration: number, count: number) {
  phases ??= new Map();
  const previous = phases.get(name);
  if (previous) { previous.duration += duration; previous.count += count; }
  else phases.set(name, { name, duration, count });
}
export function takePaintPhases(): PaintPhaseTiming[] | undefined {
  if (!phases) return undefined;
  const result = [...phases.values()]; phases = undefined; return result;
}
