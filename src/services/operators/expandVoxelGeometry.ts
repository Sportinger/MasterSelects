import type { EffectOperatorGraph, BoundOperatorNode } from '../../types/operatorGraph';
import { getEffectOperator } from './operatorRegistry';

/** Expand the first relief graph without changing its existing output IDs,
 * texture connections, parameter bindings, animation paths or parent groups. */
export function expandVoxelGeometry(input: EffectOperatorGraph): EffectOperatorGraph {
  const legacy = input.nodes.filter(node => node.operator === 'geometry.voxel');
  if (!legacy.length || input.nodes.length + legacy.length * 7 > 64) return input;
  const graph = structuredClone(input);
  for (const old of legacy) {
    const position = graph.layout[old.id] ?? { x: 0, y: 0 };
    const ids: Record<string, string> = {};
    const create = (name: string, operator: string, bindings: BoundOperatorNode['bindings'], x: number, y: number) => {
      let id = `${old.id}-${name}`;
      while (graph.nodes.some(node => node.id === id)) id += '-new';
      ids[name] = id;
      const complete = Object.fromEntries(getEffectOperator(operator)!.parameters.map(param => [param.id, bindings[param.id] ?? `voxel_${id}_${param.id}`]));
      graph.nodes.push({ id, operator, bindings: complete });
      graph.layout[id] = { x: position.x + x, y: position.y + y };
    };
    create('grid', 'geometry.grid', { columns: old.bindings.columns ?? 'columns' }, -560, 360);
    create('box', 'geometry.box', {}, -280, 360);
    create('luminance', 'image.luminance', {}, -1400, 0);
    create('clamp', 'math.clamp', {}, -1120, 0);
    create('contrast', 'math.power', { b: old.bindings.heightContrast ?? 'heightContrast' }, -840, 0);
    create('height', 'math.multiply', { b: old.bindings.height ?? 'height' }, -560, 0);
    create('base', 'math.add', { b: old.bindings.baseHeight ?? 'baseHeight' }, -280, 0);
    const node = graph.nodes.find(value => value.id === old.id)!;
    node.operator = 'geometry.instances';
    node.bindings = Object.fromEntries(['gap', 'limitToVideo'].map(key => [key, old.bindings[key] ?? key]));
    graph.edges = graph.edges.map(edge => edge.to === old.id && edge.input === 'height' ? { ...edge, to: ids.luminance, input: 'texture' } : edge);
    for (const [from, output, to, port] of [
      ['luminance', 'value', 'clamp', 'a'], ['clamp', 'value', 'contrast', 'a'], ['contrast', 'value', 'height', 'a'], ['height', 'value', 'base', 'a'],
      ['base', 'value', '', 'height'], ['grid', 'points', '', 'points'], ['box', 'geometry', '', 'geometry'],
    ]) graph.edges.push({ id: `${old.id}-expanded-${from}-${to}`, from: ids[from], output, to: to ? ids[to] : old.id, input: port });
    const parent = graph.groups?.find(group => group.nodeIds.includes(old.id));
    if ((graph.groups?.length ?? 0) < 32) {
      let groupId = `${old.id}-construction`;
      while (graph.groups?.some(group => group.id === groupId)) groupId += '-new';
      (graph.groups ??= []).push({ id: groupId, label: 'Column construction', color: '#d7a262', nodeIds: Object.values(ids), ...(parent ? { parentId: parent.id } : {}) });
    }
  }
  return graph;
}
