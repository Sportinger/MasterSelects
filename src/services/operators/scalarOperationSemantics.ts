export type SharedScalarOperation = 'add' | 'subtract' | 'multiply' | 'min' | 'clamp';

/** Pure scalar-family reference semantics. Registries remain authoritative for IDs, ports and execution metadata. */
export function evaluateScalarOperation(operation: SharedScalarOperation, a: number, b: number, c = 0): number {
  if (operation === 'add') return a + b;
  if (operation === 'subtract') return a - b;
  if (operation === 'multiply') return a * b;
  if (operation === 'min') return Math.min(a, b);
  return Math.max(Math.min(b, c), Math.min(Math.max(b, c), a));
}
