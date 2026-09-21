import type { OperatorDefinition } from '../../types/operatorGraph';

/** One entry per adaptive operation; wiring selects the concrete saved variant. */
export function operatorAddMenu(operators: readonly OperatorDefinition[]): OperatorDefinition[] {
  const families = new Map<string, OperatorDefinition>();
  for (const operator of operators) {
    const key = operator.adaptivePorts && operator.family ? operator.family : operator.id;
    if (!families.has(key) || operator.variant === 'scalar') families.set(key, operator);
  }
  return [...families.values()];
}
