import type { OperatorDefinition } from '../../types/operatorGraph';
import { collapseOperatorFamilies } from './operatorTaxonomy';

/** One entry per operation family; wiring or the inspector selects the concrete saved variant. */
export function operatorAddMenu(operators: readonly OperatorDefinition[]): OperatorDefinition[] {
  return collapseOperatorFamilies(operators);
}
