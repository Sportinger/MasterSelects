import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import { IMAGE_EFFECT_GRAPH_LIMITS } from './effectGraphLimits';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings });
const edge = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });
export function createDefaultInvertImageGraph(): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: [node('frame', 'image.frame'), node('rgba', 'convert.image-to-vec4'), node('split', 'vector.split.vec4'),
    { ...node('one', 'values.number'), constants: { value: 1 } }, node('invert-r', 'math.subtract.scalar'), node('invert-g', 'math.subtract.scalar'), node('invert-b', 'math.subtract.scalar'),
    node('combine', 'vector.combine.vec4'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')], edges: [
    edge('frame-rgba', 'frame', 'image', 'rgba', 'image'), edge('rgba-split', 'rgba', 'value', 'split', 'value'), edge('one-r', 'one', 'value', 'invert-r', 'a'),
    edge('one-g', 'one', 'value', 'invert-g', 'a'), edge('one-b', 'one', 'value', 'invert-b', 'a'), edge('r-invert', 'split', 'x', 'invert-r', 'b'),
    edge('g-invert', 'split', 'y', 'invert-g', 'b'), edge('b-invert', 'split', 'z', 'invert-b', 'b'), edge('invert-r-combine', 'invert-r', 'value', 'combine', 'x'),
    edge('invert-g-combine', 'invert-g', 'value', 'combine', 'y'), edge('invert-b-combine', 'invert-b', 'value', 'combine', 'z'), edge('alpha-combine', 'split', 'w', 'combine', 'w'),
    edge('combine-image', 'combine', 'value', 'image', 'value'), edge('image-output', 'image', 'image', 'output', 'image')],
    layout: { frame: { x: 0, y: 0 }, rgba: { x: 300, y: 0 }, split: { x: 600, y: 0 }, one: { x: 600, y: 400 }, 'invert-r': { x: 900, y: 0 },
      'invert-g': { x: 900, y: 400 }, 'invert-b': { x: 900, y: 800 }, combine: { x: 1200, y: 0 }, image: { x: 1500, y: 0 }, output: { x: 1800, y: 0 } } };
}

/** Upgrades short-lived Paket-A IDs without retaining a second executable model. */
export function migrateImageOperatorGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  const migrated = structuredClone(graph);
  for (const item of migrated.nodes) { if (item.operator === 'image.rgb-split') item.operator = 'vector.split.rgba'; if (item.operator === 'image.rgb-combine') item.operator = 'vector.combine.rgba'; }
  const ids = new Set(migrated.nodes.map(item => item.id)), edgeIds = new Set(migrated.edges.map(item => item.id));
  const unique = (base: string, values: Set<string>) => { let candidate = base, suffix = 2; while (values.has(candidate)) candidate = `${base}-${suffix++}`; values.add(candidate); return candidate; };
  for (const legacy of migrated.nodes.filter(item => item.operator === 'color.invert.rgb')) {
    if (migrated.nodes.length + 2 > IMAGE_EFFECT_GRAPH_LIMITS.nodes)
      throw new Error(`Image graph migration exceeds ${IMAGE_EFFECT_GRAPH_LIMITS.nodes} nodes.`);
    const oneId = unique(`${legacy.id}-one`, ids), splatId = unique(`${legacy.id}-ones`, ids); legacy.operator = 'math.subtract.rgb';
    migrated.nodes.push({ ...node(oneId, 'values.number'), constants: { value: 1 } }, node(splatId, 'convert.scalar-to-rgb'));
    for (const item of migrated.edges.filter(item => item.to === legacy.id && item.input === 'rgb')) item.input = 'b';
    for (const item of migrated.edges.filter(item => item.from === legacy.id && item.output === 'rgb')) item.output = 'value';
    migrated.edges.push(edge(unique(`${oneId}-splat`, edgeIds), oneId, 'value', splatId, 'value'), edge(unique(`${splatId}-subtract`, edgeIds), splatId, 'rgb', legacy.id, 'a'));
    const position = migrated.layout[legacy.id] ?? { x: 0, y: 0 }; migrated.layout[oneId] = { x: position.x - 220, y: position.y + 180 }; migrated.layout[splatId] = { x: position.x, y: position.y + 180 };
    for (const group of migrated.groups ?? []) if (group.nodeIds.includes(legacy.id)) group.nodeIds.push(oneId, splatId);
  }
  return migrated;
}
