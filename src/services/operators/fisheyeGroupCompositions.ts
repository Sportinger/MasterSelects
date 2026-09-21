import type { OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';
import { createDefaultFisheyeGraph } from './fisheyeEffectGraph';
import { organizeFisheyeGraph } from './fisheyeGraphPresentation';
import { IMAGE_OPERATORS } from './imageOperators';

const source = organizeFisheyeGraph(createDefaultFisheyeGraph());
const nodes = new Map(source.nodes.map(node => [node.id, node]));
const title = (id: string) => id.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const outputPort = (nodeId: string, portId: string): OperatorPort => {
  const node = nodes.get(nodeId)!;
  const port = IMAGE_OPERATORS.find(operator => operator.id === node.operator)?.outputs.find(port => port.id === portId);
  if (port) return port;
  if (node.operator === 'values.number') return { id: portId, label: 'Value', type: 'number' };
  if (node.operator === 'image.frame') return { id: portId, label: 'Image', type: 'image' };
  throw new Error(`Unknown Fisheye group output: ${nodeId}.${portId}`);
};

/** Reuse the executable formulas. Only boundary signals become sockets; literals stay inside.
 * Parameter folders are deliberately excluded: their bindings belong to the original effect.
 * These v1 definitions must retain their port/formula contract when the source graph changes.
 */
export const FISHEYE_GROUP_COMPOSITIONS: readonly OperatorDefinition[] = source.groups!
  .filter(group => !['fisheye-parameters', 'fisheye-constants'].includes(group.id))
  .map(group => {
    const descendants = (id: string): string[] => source.groups!.filter(child => child.parentId === id)
      .flatMap(child => [...child.nodeIds, ...descendants(child.id)]);
    const members = new Set([...group.nodeIds, ...descendants(group.id)]);
    const outputs: OperatorPort[] = [], inputs: OperatorPort[] = [];
    const exposedInputs: Record<string, OperatorEndpoint[]> = {}, exposedOutputs: Record<string, OperatorEndpoint> = {};
    for (const edge of source.edges) {
      if (!members.has(edge.from) || members.has(edge.to)) continue;
      const id = `${edge.from}-${edge.output}`;
      if (exposedOutputs[id]) continue;
      outputs.push({ ...outputPort(edge.from, edge.output), id, label: `${title(edge.from)}${edge.output === 'value' || edge.output === 'image' ? '' : ` (${edge.output})`}` });
      exposedOutputs[id] = { nodeId: edge.from, portId: edge.output };
    }
    // Share immutable constants locally without pulling in effect-owned parameter bindings.
    for (const edge of source.edges) {
      const from = nodes.get(edge.from)!;
      if (members.has(edge.to) && from.operator.startsWith('values.') && from.constants && !Object.keys(from.bindings).length) members.add(from.id);
    }
    for (const edge of source.edges) {
      if (members.has(edge.from) || !members.has(edge.to)) continue;
      const id = `${edge.from}-${edge.output}`;
      if (!exposedInputs[id]) {
        inputs.push({ ...outputPort(edge.from, edge.output), id, label: `${title(edge.from)}${['value', 'image', 'uv'].includes(edge.output) ? '' : ` (${edge.output})`}`, required: true });
        exposedInputs[id] = [];
      }
      exposedInputs[id].push({ nodeId: edge.to, portId: edge.input });
    }
    const bodyNodes = source.nodes.filter(node => members.has(node.id));
    const minX = Math.min(...bodyNodes.map(node => source.layout[node.id].x));
    const minY = Math.min(...bodyNodes.map(node => source.layout[node.id].y));
    return {
      id: `fisheye.${group.id.slice('fisheye-'.length)}`, version: 1, label: group.label,
      description: `${group.label} from Fisheye Lens. Connect its boundary signals and expand to edit the processing nodes.`,
      inputs, outputs, parameters: [], runtime: 'builtin', invalidates: 'appearance', addable: true,
      state: 'stateless', fusion: 'inline', implementation: 'shared', consumers: ['Image graphs', 'Fisheye Lens'],
      composition: {
        graph: { version: 1, schemaVersion: 1, domain: 'image', nodes: bodyNodes,
          edges: source.edges.filter(edge => members.has(edge.from) && members.has(edge.to)),
          layout: Object.fromEntries(bodyNodes.map(node => [node.id, { x: source.layout[node.id].x - minX, y: source.layout[node.id].y - minY }])) },
        inputs: exposedInputs, outputs: exposedOutputs,
      },
    };
  });
