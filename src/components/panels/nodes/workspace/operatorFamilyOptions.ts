import type { OperatorDefinition } from '../../../../types/operatorGraph';
import { EFFECT_OPERATORS } from '../../../../services/operators/operatorRegistry';
import { operatorVariantLabel } from '../../../../services/operators/operatorTaxonomy';

export function operatorFamilyOptions(operator: OperatorDefinition): Array<{ value: string; label: string }> {
  if (!operator.family) return [];
  return EFFECT_OPERATORS.filter(candidate => candidate.family === operator.family && candidate.variant
    && (candidate.addable !== false || candidate.id === operator.id))
    .map(candidate => ({ value: candidate.id, label: operatorVariantLabel(candidate) }));
}
