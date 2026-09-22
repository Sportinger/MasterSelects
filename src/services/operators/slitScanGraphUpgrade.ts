import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultSlitScanGraph } from './slitScanEffectGraph';
import { withSlitScanProtection } from './slitScanProtectionGraph';
import { withSlitScanTimeMap } from './slitScanTimeMapGraph';

// Upgrade the initial in-session graph without replacing edits to existing nodes.
const additions = new Set(['bands', 'radial-distance', 'ring-frequency', 'ring-position', 'ring-time', 'ring-cycles',
  'ring-tau', 'ring-radians', 'ring-sine', 'ring-amplitude', 'rings', 'radial-threshold', 'is-radial',
  'rings-threshold', 'is-rings', 'radial-scan', 'radial-profile', 'spatial-profile', 'integer-bands',
  'band-count', 'band-upper-edge', 'band-position', 'band-grid', 'band-index', 'band-divisor',
  'stepped-time', 'use-bands', 'smooth-or-banded']);

export function upgradeSlitScanGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  return withSlitScanTimeMap(withSlitScanProtection(upgradeProfiles(graph)));
}

function upgradeProfiles(graph: EffectOperatorGraph): EffectOperatorGraph {
  const route = graph.edges.find(edge => edge.to === 'masked-delay' && edge.input === 'a' && edge.from === 'profile-offset');
  if (!route || graph.nodes.some(node => additions.has(node.id)) || !graph.nodes.some(node => node.id === 'radius-distance')) return graph;
  const template = createDefaultSlitScanGraph();
  const addedNodes = template.nodes.filter(node => additions.has(node.id));
  const existing = new Set(graph.nodes.map(node => node.id));
  const addedEdges = template.edges.filter(edge => additions.has(edge.to));
  if (addedEdges.some(edge => !existing.has(edge.from) && !additions.has(edge.from))) return graph;
  return { ...graph, nodes: [...graph.nodes, ...addedNodes],
    edges: [...graph.edges.map(edge => edge === route ? { ...edge, from: 'smooth-or-banded', output: 'value' } : edge), ...addedEdges],
    layout: { ...graph.layout, ...Object.fromEntries(Object.entries(template.layout ?? {}).filter(([id]) => additions.has(id))) },
    groups: graph.groups?.map(group => ({ ...group, nodeIds: [...group.nodeIds,
      ...(template.groups?.find(item => item.id === group.id)?.nodeIds.filter(id => additions.has(id)) ?? [])] })),
  };
}
