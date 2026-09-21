import type { NodeConnectionVariant } from '../../types/nodeGraph';
import type { OperatorDefinition } from '../../types/operatorGraph';
import { projectOperatorPort } from './operatorPortProjection';

const projected = new WeakMap<OperatorDefinition, NodeConnectionVariant>();
function project(operator: OperatorDefinition): NodeConnectionVariant {
  let result = projected.get(operator);
  if (!result) {
    result = { operatorId: operator.id, inputs: operator.inputs.map(p => projectOperatorPort(p, 'input')),
      outputs: operator.outputs.map(p => projectOperatorPort(p, 'output')) };
    projected.set(operator, result);
  }
  return result;
}

/** Execution support comes from the owner, not from matching catalog labels. */
export function operatorAdaptiveVariants(operator: OperatorDefinition, supported: readonly OperatorDefinition[]) {
  if (!operator.adaptivePorts || !operator.family) return undefined;
  const variants = supported.filter(candidate => candidate.adaptivePorts && candidate.family === operator.family);
  return variants.length > 1 ? variants.map(project) : undefined;
}
