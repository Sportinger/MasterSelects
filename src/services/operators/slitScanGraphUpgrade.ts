import { withSlitScanFieldGroups } from './slitScanFieldGroups';
import { withSlitScanRgbTime } from './slitScanRgbTimeGraph';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultSlitScanGraph } from './slitScanEffectGraph';
import { withSlitScanProtection } from './slitScanProtectionGraph';
import { withSlitScanTimeMap } from './slitScanTimeMapGraph';
import { withSlitScanGroupBypasses } from './slitScanGroupBypass';
import { withSlitScanMotion } from './slitScanMotionGraph';

// Upgrade the initial in-session graph without replacing edits to existing nodes.
const additions = new Set(['bands', 'radial-distance', 'ring-frequency', 'ring-position', 'ring-time', 'ring-cycles',
  'ring-tau', 'ring-radians', 'ring-sine', 'ring-amplitude', 'rings', 'radial-threshold', 'is-radial',
  'rings-threshold', 'is-rings', 'radial-scan', 'radial-profile', 'spatial-profile', 'integer-bands',
  'band-count', 'band-upper-edge', 'band-position', 'band-grid', 'band-index', 'band-divisor',
  'stepped-time', 'use-bands', 'smooth-or-banded']);

export function upgradeSlitScanGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  // Raise only the original safety ceiling; preserve user-authored limits and wiring.
  const legacyLimit = graph.nodes.find(node => node.id === 'max-delay' && node.operator === 'values.number'
    && node.constants?.value === 4 && !Object.keys(node.bindings ?? {}).length);
  if (legacyLimit && graph.edges.some(edge => edge.from === legacyLimit.id && edge.to === 'safe-delay' && edge.input === 'max')) {
    graph = { ...graph, nodes: graph.nodes.map(node => node === legacyLimit
      ? { ...node, constants: { ...node.constants, value: 60 } } : node) };
  }
  return withSlitScanFieldGroups(withSlitScanRgbTime(withSlitScanMotion(withSlitScanGroupBypasses(withSlitScanTimeMap(withSlitScanProtection(
    separateProfilesFromProtection(upgradeProfiles(graph))))))));
}

/** Radial/ring profile nodes and the centre distance they share with the protection mask. */
const PROFILE_DISTANCE_NODES = new Set(['size', 'aspect', 'aspect-scale', 'aspect-uv', 'radius-distance', 'radial-distance',
  'ring-frequency', 'ring-position', 'ring-time', 'ring-cycles', 'ring-tau', 'ring-radians', 'ring-sine', 'ring-amplitude', 'rings',
  'radial-threshold', 'is-radial', 'rings-threshold', 'is-rings', 'radial-scan', 'radial-profile', 'spatial-profile']);

/**
 * Graphs saved before 2026-10 kept the Radial and Time rings profiles in the Protected Center folder, whose
 * mute routed the profile back to Linear/Center/Wave: with Protected Center muted (the default for new
 * effects) Radial scan and Time rings rendered as Wave. Move those nodes to the profile folder and drop
 * that route; muting Protected Center then removes only the protection mask.
 */
function separateProfilesFromProtection(graph: EffectOperatorGraph): EffectOperatorGraph {
  const protection = graph.groups?.find(group => group.id === 'scan-protection');
  const profile = graph.groups?.find(group => group.id === 'scan-wave');
  if (!protection || !profile || !protection.nodeIds.includes('spatial-profile')) return graph;
  const moved = protection.nodeIds.filter(id => PROFILE_DISTANCE_NODES.has(id));
  const bypassOutputs = protection.bypassOutputs && Object.fromEntries(Object.entries(protection.bypassOutputs)
    .filter(([output]) => !PROFILE_DISTANCE_NODES.has(output.split(':')[0])));
  return { ...graph, groups: graph.groups!.map(group => group === protection
    ? { ...group, nodeIds: group.nodeIds.filter(id => !PROFILE_DISTANCE_NODES.has(id)), ...(bypassOutputs ? { bypassOutputs } : {}) }
    : group === profile ? { ...group, nodeIds: [...group.nodeIds, ...moved] } : group) };
}

/** New effects start with optional graph branches muted; existing saved graphs keep their states. */
export function createInitialSlitScanGraph(): EffectOperatorGraph {
  const graph = upgradeSlitScanGraph(createDefaultSlitScanGraph());
  const muted = new Set(['scan-protection', 'subject-protection', 'time-map', 'rgb-time',
    'field-shaping', 'field-combination', 'field-noise', 'field-motion']);
  return { ...graph, groups: graph.groups?.map(group => muted.has(group.id) ? { ...group, bypassed: true } : group) };
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
