import type { GraphPort } from './blurGraphBuilder';
import type { AnalogRecipeBuilder } from './analogRecipeBuilder';

/** Logistic fit of the normal CDF: Φ(z) ≈ 1 / (1 + e^(−1.702 z)), within 0.01 everywhere. */
const LOGISTIC_SLOPE = 1.702;

/**
 * Turns a value with a known, roughly normal spread into a share of the frame (a quantile without a global
 * pass), shared by the cloud recipes (Block Cloud): `${p}-rank` is about uniform in 0..1 (the value's normal
 * CDF for `mean` and `spread`, the standard deviation), and `${p}-on` is 1 where the rank lies above
 * 1 − `coverage`, so about `coverage` of all values are on, at any spread. Coverage 0 is never on.
 * Needs the constants `zero` and `one`.
 */
export function coverageMask(g: AnalogRecipeBuilder, p: string, value: GraphPort, mean: GraphPort, spread: GraphPort, coverage: GraphPort) {
  const z = g.div(`${p}-z`, g.sub(`${p}-centred`, value, mean), g.max(`${p}-safe-spread`, spread, g.number(`${p}-spread-floor`, 1e-6)));
  const rank = g.div(`${p}-rank`, 'one', g.plus(`${p}-rank-denominator`, 'one',
    g.fn(`${p}-rank-tail`, 'exp', g.mul(`${p}-rank-slope`, z, g.number(`${p}-logistic`, -LOGISTIC_SLOPE)))));
  const on = g.greater(`${p}-above`, rank, g.sub(`${p}-threshold`, 'one', coverage));
  return { rank, on: g.select(`${p}-on`, on, 'zero', 'one') };
}
