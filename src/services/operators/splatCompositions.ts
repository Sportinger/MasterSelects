import type { OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';
import { primitiveSplatGraph } from './splatGraphDefaults';
import { SCENE_OPERATORS } from './sceneOperators';

const source = primitiveSplatGraph(true);
/** Versioned recipes use public signals, never a particular clip or effect's bindings. */
export const SPLAT_COMPOSITION_REGIONS = [
  { id: 'splat.clean-surface', label: 'Cleanup', members: ['limit', 'fade'], description: 'Clamp Gaussian radii and fade near the camera.' },
  { id: 'splat.ray-field', label: 'Rays', members: ['selection', 'stretch', 'motion', 'alpha'], description: 'Select splats, stretch their axes, animate orientation and adjust color and opacity.' },
  { id: 'splat.particle-system', label: 'Particle System', members: ['emit', 'size', 'simulation', 'particle-fade'], description: 'Emit particles from Gaussian centers, integrate connected forces, preserve Gaussian attributes and fade near the camera.' },
  { id: 'splat.mesh-overlay', label: 'Mesh Overlay', members: ['reconstruct', 'wireframe', 'mesh'], description: 'Reconstruct a density isosurface from Gaussian centers and render it with a connected wireframe material.' },
] as const;

export const SPLAT_COMPOSITIONS: readonly OperatorDefinition[] = SPLAT_COMPOSITION_REGIONS.map(region => {
  const members = new Set<string>(region.members);
  const nodes = source.graph.nodes.filter(node => members.has(node.id));
  const inputs: OperatorPort[] = [], outputs: OperatorPort[] = [];
  const publicInputs: Record<string, OperatorEndpoint[]> = {}, publicOutputs: Record<string, OperatorEndpoint> = {};
  const port = (nodeId: string, id: string, direction: 'inputs' | 'outputs') => {
    const node = source.graph.nodes.find(n => n.id === nodeId)!;
    return SCENE_OPERATORS.find(o => o.id === node.operator)![direction].find(p => p.id === id)!;
  };
  for (const node of nodes) {
    const operator = SCENE_OPERATORS.find(o => o.id === node.operator)!;
    for (const input of operator.inputs) {
      if (source.graph.edges.some(e => e.to === node.id && e.input === input.id && members.has(e.from))) continue;
      const id = `${node.id}-${input.id}`;
      inputs.push({ ...input, id, label: `${operator.label}: ${input.label}` });
      publicInputs[id] = [{ nodeId: node.id, portId: input.id }];
    }
  }
  for (const edge of source.graph.edges.filter(e => members.has(e.from) && !members.has(e.to))) {
    const id = `${edge.from}-${edge.output}`;
    if (publicOutputs[id]) continue;
    outputs.push({ ...port(edge.from, edge.output, 'outputs'), id });
    publicOutputs[id] = { nodeId: edge.from, portId: edge.output };
  }
  return { id: region.id, version: 1, label: region.label, description: region.description,
    inputs, outputs, parameters: [], addable: true, runtime: 'builtin', invalidates: 'simulation',
    state: region.id === 'splat.particle-system' ? 'simulation' : 'stateless', fusion: 'inline',
    implementation: 'shared', consumers: ['Gaussian splat scene graphs', 'Splat Exploration'],
    composition: {
      graph: { version: 1, domain: 'scene', nodes: nodes.map(node => ({ id: node.id, operator: node.operator, operatorVersion: 1, bindings: {},
        constants: Object.fromEntries(Object.entries(node.bindings).map(([id, binding]) => [id, source.params[binding as string]])) })),
        edges: source.graph.edges.filter(e => members.has(e.from) && members.has(e.to)),
        layout: Object.fromEntries(nodes.map((node, i) => [node.id, { x: i * 300, y: 0 }])) },
      inputs: publicInputs, outputs: publicOutputs,
    },
  };
});
