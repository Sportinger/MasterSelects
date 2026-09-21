export const SAMPLE_MATH_OPERATIONS = ['add', 'subtract', 'multiply', 'divide-ieee', 'min', 'max',
  'clamp', 'abs', 'sin', 'cos', 'floor', 'fract', 'mix'] as const;
export type SharedScalarOperation = typeof SAMPLE_MATH_OPERATIONS[number];

/** Pure scalar-family reference semantics. Registries remain authoritative for IDs, ports and execution metadata. */
export function evaluateScalarOperation(operation: SharedScalarOperation, a: number, b = 0, c = 0): number {
  if (operation === 'add') return a + b;
  if (operation === 'subtract') return a - b;
  if (operation === 'multiply') return a * b;
  if (operation === 'min') return Math.min(a, b);
  if (operation === 'abs') return Math.abs(a);
  if (operation === 'max') return Math.max(a, b);
  if (operation === 'divide-ieee') return a / b;
  if (operation === 'sin') return Math.sin(a);
  if (operation === 'cos') return Math.cos(a);
  if (operation === 'floor') return Math.floor(a);
  if (operation === 'fract') return a - Math.floor(a);
  if (operation === 'mix') return a + (b - a) * c;
  return Math.max(Math.min(b, c), Math.min(Math.max(b, c), a));
}
