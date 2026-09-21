/** Mirrors WGSL round: nearest integer represented as f32, with exact halfway cases resolved to even.
 * https://www.w3.org/TR/WGSL/#round-builtin */
export function roundImageScalarEven(value: number): number {
  const f32 = Math.fround(value);
  if (!Number.isFinite(f32)) throw new Error('Image round-even requires a finite f32 value.');
  const lower = Math.floor(f32), fraction = f32 - lower;
  if (fraction < .5) return lower;
  if (fraction > .5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}
