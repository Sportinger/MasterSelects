import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { effectOperatorGraph } from '../../services/operators/effectGraphOwner';

// These generated groups have explicit neutral bypass routes. Under the linear
// parameter guards, disabling any of them preserves the directional time field.
const neutralGroups = new Set(['scan-protection', 'subject-protection', 'time-map', 'rgb-time',
  'field-shaping', 'field-combination', 'field-noise', 'field-motion']);
let reference: EffectOperatorGraph | undefined;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

function semantics(graph: EffectOperatorGraph) {
  return JSON.stringify(canonical({ domain: graph.domain,
    // Expanded leaf nodes own execution; composition layout is editor metadata.
    nodes: graph.nodes.map(({ composition: _composition, ...node }) => node).toSorted((a, b) => a.id.localeCompare(b.id)),
    edges: graph.edges.map(({ from, output, to, input }) => [from, output, to, input]).toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    groups: graph.groups?.map(group => ({ id: group.id, nodeIds: group.nodeIds.toSorted(), parentId: group.parentId,
      bypassed: !!group.bypassed, bypassOutputs: group.bypassOutputs })).toSorted((a, b) => a.id.localeCompare(b.id)),
  }));
}

/** Accept presentation changes and known neutral bypasses, never arbitrary wiring. */
export function isLinearTemporalGraph(graph: EffectOperatorGraph): boolean {
  if (graph.incomplete) return false;
  reference ??= effectOperatorGraph({ type: 'slit-scan', params: {} });
  const states = new Map(graph.groups?.map(group => [group.id, !!group.bypassed]));
  const expected = { ...reference, groups: reference.groups?.map(group => neutralGroups.has(group.id)
    ? { ...group, bypassed: states.get(group.id) } : group) };
  return semantics(graph) === semantics(expected);
}
