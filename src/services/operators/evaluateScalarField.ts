import type { ScalarFieldProgram } from './scalarField';

/** Numeric probe uses the same bounded register program as both GPU renderers. */
export function evaluateScalarField(program: ScalarFieldProgram, luminance: number): number[] {
  const values: number[] = [];
  for (const [op, ai, bi, ci] of program.operations) {
    const a = values[ai] ?? 0, b = values[bi] ?? 0, c = values[ci] ?? 0;
    let value = 0;
    switch (op) {
      case 0: value = ci; break;
      case 1: value = luminance; break;
      case 2: value = a + b; break;
      case 3: value = a - b; break;
      case 4: value = a * b; break;
      case 5: value = Math.abs(b) >= 1e-9 ? a / b : 0; break;
      case 6: value = b === 0 ? 1 : a <= 0 ? b < 0 ? 10000 : 0 : Math.pow(a, b); break;
      case 7: value = Math.min(a, b); break;
      case 8: value = Math.max(a, b); break;
      case 9: value = Math.abs(a); break;
      case 10: value = Math.sin(a); break;
      case 11: value = Math.max(Math.min(b, c), Math.min(Math.max(b, c), a)); break;
    }
    values.push(Math.fround(Math.max(-10000, Math.min(10000, value))));
  }
  return values;
}
