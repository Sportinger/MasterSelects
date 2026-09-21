import type { EffectOperatorGraph, OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';
import { IMAGE_OPERATORS } from './imageOperators';

const title = (id: string) => id.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

/** Extract an explicit processing region, exposing signals rather than copying effect-owned parameters.
 * Only unbound literal leaves may be captured. Frame, history and atlas resources stay external.
 */
export function extractImageComposition(source: EffectOperatorGraph, spec: {
  id: string; label: string; description: string; members: string[]; consumers: string[];
  captureLiterals?: boolean; additionalOutputs?: OperatorEndpoint[];
  keepLiteralInputs?: string[];
  inputLabels?: Record<string, string>; outputLabels?: Record<string, string>;
}): OperatorDefinition {
  const nodes = new Map(source.nodes.map(node => [node.id, node]));
  const members = new Set(spec.members);
  const selected = new Set(members);
  if (!members.size || spec.members.some(id => !nodes.has(id))) throw new Error(`Invalid composition members: ${spec.id}`);
  if (spec.captureLiterals !== false) for (const link of source.edges) {
    const from = nodes.get(link.from)!;
    if (members.has(link.to) && from.operator.startsWith('values.') && from.constants && !Object.keys(from.bindings).length
      && !spec.keepLiteralInputs?.includes(from.id)) members.add(from.id);
  }
  const bodyNodes = source.nodes.filter(node => members.has(node.id));
  if (bodyNodes.some(node => Object.keys(node.bindings).length || ['image.frame', 'image.frame-history', 'glyph.atlas'].includes(node.operator))) {
    throw new Error(`Composition ${spec.id} must expose bound values and resources as inputs.`);
  }
  const outputPort = (nodeId: string, portId: string): OperatorPort => {
    const node = nodes.get(nodeId)!;
    const port = IMAGE_OPERATORS.find(operator => operator.id === node.operator)?.outputs.find(port => port.id === portId);
    if (port) return port;
    if (node.operator === 'values.number' && portId === 'value') return { id: portId, label: 'Value', type: 'number' };
    if (node.operator === 'image.frame' && portId === 'image') return { id: portId, label: 'Image', type: 'image' };
    throw new Error(`Unknown composition boundary: ${spec.id} / ${nodeId}.${portId}`);
  };
  const inputs: OperatorPort[] = [], outputs: OperatorPort[] = [];
  const exposedInputs: Record<string, OperatorEndpoint[]> = {}, exposedOutputs: Record<string, OperatorEndpoint> = {};
  const exposeOutput = (endpoint: OperatorEndpoint) => {
    const id = `${endpoint.nodeId}-${endpoint.portId}`;
    if (exposedOutputs[id]) return;
    if (!members.has(endpoint.nodeId)) throw new Error(`Output outside ${spec.id}: ${endpoint.nodeId}`);
    outputs.push({ ...outputPort(endpoint.nodeId, endpoint.portId), id, label: spec.outputLabels?.[id] ?? title(endpoint.nodeId) });
    exposedOutputs[id] = endpoint;
  };
  for (const edge of source.edges) {
    if (selected.has(edge.from) && !members.has(edge.to)) exposeOutput({ nodeId: edge.from, portId: edge.output });
    if (members.has(edge.from) || !members.has(edge.to)) continue;
    const id = `${edge.from}-${edge.output}`;
    if (!exposedInputs[id]) {
      const port = outputPort(edge.from, edge.output);
      inputs.push({ ...port, id, label: spec.inputLabels?.[id]
        ?? `${title(edge.from)}${['value', 'image', 'uv'].includes(edge.output) ? '' : ` (${port.label})`}`, required: true });
      exposedInputs[id] = [];
    }
    exposedInputs[id].push({ nodeId: edge.to, portId: edge.input });
  }
  spec.additionalOutputs?.forEach(exposeOutput);
  if (!outputs.length) throw new Error(`Composition ${spec.id} has no output.`);
  const minX = Math.min(...bodyNodes.map(node => source.layout[node.id].x));
  const minY = Math.min(...bodyNodes.map(node => source.layout[node.id].y));
  return { id: spec.id, version: 1, label: spec.label, description: spec.description, inputs, outputs, parameters: [],
    runtime: 'builtin', invalidates: 'appearance', addable: true, state: 'stateless', fusion: 'inline', implementation: 'shared',
    consumers: spec.consumers, composition: {
      graph: { version: 1, schemaVersion: 1, domain: 'image', nodes: structuredClone(bodyNodes),
        edges: source.edges.filter(edge => members.has(edge.from) && members.has(edge.to)).map(edge => ({ ...edge })),
        layout: Object.fromEntries(bodyNodes.map(node => [node.id, { x: source.layout[node.id].x - minX, y: source.layout[node.id].y - minY }])) },
      inputs: exposedInputs, outputs: exposedOutputs,
    } };
}
