// Exposed graph values without editor dependencies, so render-time consumers such as parameter
// sources can list them; exposing and editing stay in exposedGraphValues.ts.
import type { EffectOperatorGraph } from '../../types/operatorGraph';

const DEFAULT_RANGE = { min: -30, max: 30, step: 0.01 };

export interface ExposedGraphValue {
  nodeId: string;
  /** Effect param key; the animatable property is `effect.<effectId>.<key>`. */
  key: string;
  label: string;
  min: number; max: number; step: number;
  integer: boolean;
}

/** Stable effect param key owned by an exposed value node. */
export const exposedValueKey = (nodeId: string) => `${nodeId}_value`;

export function exposedGraphValues(graph: EffectOperatorGraph | undefined): ExposedGraphValue[] {
  return (graph?.nodes ?? []).flatMap(node => {
    const binding = node.bindings.value;
    if (!node.exposed || typeof binding !== 'string') return [];
    const integer = node.operator === 'values.integer';
    return [{ nodeId: node.id, key: binding, label: node.exposed.label,
      min: node.exposed.min ?? DEFAULT_RANGE.min, max: node.exposed.max ?? DEFAULT_RANGE.max,
      step: node.exposed.step ?? (integer ? 1 : DEFAULT_RANGE.step), integer }];
  });
}

