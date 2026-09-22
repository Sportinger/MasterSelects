import type { SceneOperatorGraph } from '../../types/operatorGraph';
import { primitiveSplatGraph } from './splatGraphDefaults';
import { SPLAT_COMPOSITIONS, SPLAT_COMPOSITION_REGIONS } from './splatCompositions';

/** The same composition instances/expansion metadata as image effects; no second group format. */
export function defaultSplatGraph(exploration = false): SceneOperatorGraph {
  const source = primitiveSplatGraph(exploration);
  return exploration ? composeSplatGraph(source) : source;
}

export function composeSplatGraph(source: SceneOperatorGraph): SceneOperatorGraph {
  const result = structuredClone(source), { graph } = result;
  if (graph.groups?.length || !SPLAT_COMPOSITION_REGIONS.every(r => r.members.every(id => graph.nodes.some(n => n.id === id)))) return source;
  // Only organize the original bound recipe. Leave user-authored or edited graphs untouched.
  if (SPLAT_COMPOSITIONS.some(definition => definition.composition!.graph.nodes.some(template => {
    const node = graph.nodes.find(n => n.id === template.id)!;
    return node.operator !== template.operator || node.bypassed || node.enabled || Object.keys(node.constants ?? {}).length
      || Object.keys(template.constants ?? {}).some(key => typeof node.bindings[key] !== 'string');
  }))) return source;
  graph.groups = [];
  SPLAT_COMPOSITIONS.forEach((definition, index) => {
    const body = definition.composition!, members = new Set(body.graph.nodes.map(n => n.id));
    const id = `splat-module-${index}`, groupId = `compound-${id}`, outerId = `splat-branch-${index}`;
    const controls: string[] = [];
    const position = { x: 350, y: index * 500 };
    for (const template of body.graph.nodes) {
      const node = graph.nodes.find(n => n.id === template.id)!;
      for (const [parameter, binding] of Object.entries(node.bindings)) {
        if (typeof binding !== 'string' || !body.inputs[`${node.id}-${parameter}`]) continue;
        const controlId = `${node.id}-${parameter}-control`;
        if (graph.nodes.some(n => n.id === controlId)) throw new Error('Splat control identity collision.');
        graph.nodes.push({ id: controlId, operator: 'values.number', operatorVersion: 1, bindings: { value: binding } });
        if (!graph.edges.some(e => e.to === node.id && e.input === parameter)) {
          graph.edges.push({ id: `${controlId}-input`, from: controlId, output: 'value', to: node.id, input: parameter });
        }
        graph.layout[controlId] = { x: position.x - 280, y: position.y + controls.length * 140 };
        controls.push(controlId);
      }
      node.bindings = {};
      node.constants = { ...template.constants };
      node.operatorVersion = 1;
    }
    const output = ['surface', 'rays', 'particles'][index];
    const extras = index === 2 ? ['turbulence', 'gravity', 'drag'] : [];
    graph.groups!.push({ id: outerId, label: ['Original Splats', 'Rays', 'Particles', 'Mesh Overlay'][index], color: '#6298a3',
      nodeIds: [output, ...extras].filter(id => graph.nodes.some(n => n.id === id)), collapsedByDefault: true });
    graph.groups!.push({ id: groupId, label: definition.label, color: '#799ab4', nodeIds: [...members], parentId: outerId, collapsedByDefault: true,
      composition: { instance: { id, operator: definition.id, operatorVersion: 1, bindings: {},
        composition: { nodeIds: Object.fromEntries([...members].map(id => [id, id])), layout: body.graph.layout } }, position } });
    graph.groups!.push({ id: `${id}-controls`, label: 'Controls', color: '#817799', nodeIds: controls, parentId: outerId, collapsedByDefault: true });
  });
  return result;
}
