import type { OperatorDefinition } from '../../../../types/operatorGraph';
import { EFFECT_OPERATORS } from '../../../../services/operators/operatorRegistry';

export function operatorFamilyOptions(operator: OperatorDefinition): Array<{ value: string; label: string }> {
  if (!operator.family) return [];
  return EFFECT_OPERATORS.filter(candidate => candidate.family === operator.family && candidate.variant)
    .map(candidate => ({ value: candidate.id, label: candidate.variant!.toUpperCase() }));
}
