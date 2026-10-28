import type { GraphPort } from './blurGraphBuilder';
import type { AnalogRecipeBuilder } from './analogRecipeBuilder';

/** A cross reaches this many Mark Sizes from its centre. */
export const CROSS_ARM = 2.5;

/**
 * Dots or crosses on a square grid, shared by the Glitch / Data recipes (Block Silhouette marks, Block
 * Dissolve paper marks). Grid points sit on `origin` (pixels) and repeat every `grid` pixels; a dot is a
 * square of `size` pixels, a cross two bars `size` thick reaching CROSS_ARM × size from the point.
 * `cross` (0 or 1) picks the cross. Returns the shape coverage (`${p}-shape`, 0 or 1) and the grid cell
 * index (`${p}-cell`, vec2) for per-point rolls. Needs the constants `half` and `half-vec2`.
 */
export function gridMarks(g: AnalogRecipeBuilder, p: string, fromOrigin: GraphPort, grid: GraphPort, size: GraphPort, cross: GraphPort) {
  const position = g.binary(`${p}-position`, 'math.divide-ieee.vec2', fromOrigin, g.splat2(`${p}-grid-vec2`, grid));
  const cell = g.unary(`${p}-cell`, 'math.floor.vec2', g.add2(`${p}-position-centred`, position, 'half-vec2'));
  const [ox, oy] = g.split2(`${p}-offset-split`, g.mul2(`${p}-offset`, g.sub2(`${p}-local`, position, cell), `${p}-grid-vec2`));
  const dx = g.fn(`${p}-dx`, 'abs', ox), dy = g.fn(`${p}-dy`, 'abs', oy);
  const halfSize = g.mul(`${p}-half`, size, 'half');
  const dot = g.add(`${p}-dot`, 'math.step.scalar', { edge: g.max(`${p}-dot-distance`, dx, dy), value: halfSize });
  const arm = g.mul(`${p}-arm`, size, g.number(`${p}-arm-share`, CROSS_ARM));
  const bars = g.mul(`${p}-cross`, g.add(`${p}-cross-thin`, 'math.step.scalar', { edge: g.min(`${p}-cross-near`, dx, dy), value: halfSize }),
    g.add(`${p}-cross-short`, 'math.step.scalar', { edge: g.max(`${p}-cross-far`, dx, dy), value: arm }));
  return { shape: g.mix(`${p}-shape`, dot, bars, cross), cell };
}
