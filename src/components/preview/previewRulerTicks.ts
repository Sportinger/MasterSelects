export interface RulerTick {
  /** Screen offset along the ruler, in CSS pixels. */
  offset: number;
  /** Composition pixel value at this tick. */
  value: number;
  major: boolean;
}

// Major step in composition pixels → number of minor subdivisions.
const STEP_DIVISIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [2, 2], [5, 5], [10, 10], [20, 4], [25, 5], [50, 5], [100, 10], [200, 4], [250, 5],
  [500, 5], [1000, 10], [2000, 4], [2500, 5], [5000, 5], [10000, 10],
];
const MIN_MAJOR_SPACING_PX = 64;
const MAX_TICKS = 1200;

/**
 * Ticks for one ruler axis. `origin` is the screen offset of composition pixel 0,
 * `scale` the CSS pixels per composition pixel, `length` the ruler length.
 */
export function computeRulerTicks(origin: number, scale: number, length: number): RulerTick[] {
  if (!(scale > 0) || !(length > 0) || !Number.isFinite(origin)) return [];
  const [step, divisions] = STEP_DIVISIONS.find(([candidate]) => candidate * scale >= MIN_MAJOR_SPACING_PX)
    ?? STEP_DIVISIONS[STEP_DIVISIONS.length - 1];
  const minorStep = step / divisions;
  const firstIndex = Math.ceil(-origin / scale / minorStep);
  const lastIndex = Math.floor((length - origin) / scale / minorStep);
  const ticks: RulerTick[] = [];
  for (let index = firstIndex; index <= lastIndex && ticks.length < MAX_TICKS; index += 1) {
    const value = index * minorStep + 0; // normalizes -0
    ticks.push({ offset: origin + value * scale, value, major: index % divisions === 0 });
  }
  return ticks;
}
