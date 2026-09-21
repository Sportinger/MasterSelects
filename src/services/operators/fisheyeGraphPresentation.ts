import type { EffectOperatorGraph, OperatorGroup } from '../../types/operatorGraph';
import { createDefaultFisheyeGraph } from './fisheyeEffectGraph';

let originalGroups: OperatorGroup[] | undefined;
const cache = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();

/** Presentation-only upgrade of the original six folders. User-authored grouping stays intact. */
export function organizeFisheyeGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  const cached = cache.get(source); if (cached) return cached;
  originalGroups ??= createDefaultFisheyeGraph().groups!;
  if (source.groups?.length !== originalGroups.length || originalGroups.some(expected => {
    const actual = source.groups!.find(group => group.id === expected.id);
    return !actual || actual.parentId || actual.composition || actual.label !== expected.label
      || actual.nodeIds.length !== expected.nodeIds.length || expected.nodeIds.some(id => !actual.nodeIds.includes(id));
  })) return source;
  const groups = structuredClone(source.groups);
  const area = (id: string) => groups.find(group => group.id === `fisheye-${id}`)!;
  for (const group of groups) group.collapsedByDefault ??= true;
  // The reduction consumes the entire sample expression; it belongs at the end,
  // not beside the lexical sample-index input (which creates a visual folder cycle).
  const finish = ['aa-weight', 'aa-reduce', 'aa-weight-vector', 'aa-average'];
  area('aa').nodeIds = area('aa').nodeIds.filter(id => !finish.includes(id));
  area('resolve').nodeIds.push(...finish);
  area('parameters').nodeIds = area('parameters').nodeIds.filter(id => id !== 'frame');
  area('resolve').nodeIds = area('resolve').nodeIds.filter(id => id !== 'output');
  const section = (parent: string, id: string, label: string, members: string[]) => {
    const owner = area(parent), nodeIds = owner.nodeIds.filter(id => members.includes(id));
    owner.nodeIds = owner.nodeIds.filter(id => !nodeIds.includes(id));
    groups.push({ id: `fisheye-${id}`, label, color: owner.color, parentId: owner.id, nodeIds, collapsedByDefault: true });
  };
  section('parameters', 'constants', 'Lens Constants', source.nodes.filter(node =>
    node.operator === 'values.number' && node.constants && area('parameters').nodeIds.includes(node.id)).map(node => node.id));
  section('aa', 'jitter-pattern', 'Eight Sample Offsets', area('aa').nodeIds.filter(id => /^jitter-(?:\d|threshold|before|select)/.test(id)));
  section('lens', 'lens-coordinates', 'Image to Lens Coordinates', [
    'center', 'centered-uv', 'aspect-scale', 'aspect-delta', 'aspect-select', 'negative-rotation', 'lens-rotate-in',
    'squeeze-scale', 'squeezed', 'radius-half', 'radius-half-safe', 'lens-position', 'lens-position-radius', 'safe-radius', 'lens-direction',
  ]);
  section('lens', 'projection-model', 'Projection Model', [
    'fov-half', 'fov-max', 'max-theta', 'tan-max-theta', 'rectilinear-scale', 'unproject-radius', 'unproject-tangent',
    'positive-target-radius', 'negative-scaled-radius', 'negative-theta', 'project-radius', 'projection-direction',
  ]);
  section('lens', 'radius-curve', 'Radius Curve and Zoom', [
    'radius-squared', 'radius-cubed', 'cubic-delta', 'curve-delta', 'strength-direction', 'bias-direction', 'biased-curve',
    'biased-target', 'nonnegative-target', 'absolute-strength', 'mixed-radius', 'safe-zoom', 'sample-radius',
  ]);
  section('edges', 'edge-coordinates', 'Frame Coordinate Modes', [
    'edge-zero-vector', 'edge-one-vector', 'edge-clamped-uv', 'edge-mirrored-uv', 'edge-repeated-uv',
    'edge-above-mirror', 'edge-above-repeat', 'edge-mirror-or-repeat', 'edge-adjusted-uv',
  ]);
  section('edges', 'edge-coverage', 'Frame Coverage', area('edges').nodeIds.filter(id =>
    !['edge-uv', 'edge-sample', 'edge-mode-select', 'edge-mode-nontransparent'].includes(id)));
  section('chroma', 'channel-resolve', 'Combine Chromatic Channels', [
    'red-rgba', 'green-rgba', 'blue-rgba', 'red-channel-split', 'green-channel-split', 'blue-channel-split',
    'alpha-red-green', 'alpha-sum', 'alpha-average', 'chroma-rgba', 'chroma-image',
  ]);
  section('resolve', 'vignette', 'Vignette', area('resolve').nodeIds.filter(id => id.startsWith('vignette-') || id === 'lens-split'));
  section('resolve', 'lens-coverage', 'Lens Coverage', [
    'lens-hard-coverage', 'lens-feather-start-raw', 'lens-feather-start', 'lens-feather-mask', 'lens-soft-coverage', 'lens-feather-enabled',
  ]);
  section('resolve', 'sample-average', 'Average Samples', [...finish, 'fisheye-image']);
  const graph = { ...source, groups };
  cache.set(source, graph); cache.set(graph, graph);
  return graph;
}
