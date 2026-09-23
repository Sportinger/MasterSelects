import { createDefaultEdgeDetectGraph } from './edgeDetectEffectGraph';
import { extractImageComposition } from './extractImageComposition';

/** The existing eight-tap edge recipe, exposing its unclamped scalar magnitude. */
export function edgeTimeFieldComposition() {
  const graph = createDefaultEdgeDetectGraph();
  const downstream = new Set(['frame', 'uv', 'resolution', 'strength', 'invert', 'scaled', 'clamped',
    'inverse', 'selected', 'rgba', 'image', 'output']);
  const definition = extractImageComposition(graph, {
    id: 'field.sobel', label: 'Edge Strength Field',
    description: 'Eight-tap Sobel luminance magnitude. Image, UV and resolution are explicit; normalize the magnitude before using it as a time field.',
    members: graph.nodes.filter(node => !downstream.has(node.id) && !node.operator.startsWith('values.')).map(node => node.id),
    consumers: ['Image graphs', 'Slit Scan'],
    inputLabels: { 'frame-image': 'Image', 'uv-uv': 'UV', 'resolution-value': 'Resolution' },
    outputLabels: { 'magnitude-value': 'Edge strength' },
  });
  const names: Record<string, string> = { 'frame-image': 'image', 'uv-uv': 'uv', 'resolution-value': 'resolution', 'magnitude-value': 'value' };
  definition.inputs = definition.inputs.map(port => ({ ...port, id: names[port.id] ?? port.id }));
  definition.outputs = definition.outputs.map(port => ({ ...port, id: names[port.id] ?? port.id }));
  definition.composition!.inputs = Object.fromEntries(Object.entries(definition.composition!.inputs).map(([id, endpoints]) => [names[id] ?? id, endpoints]));
  definition.composition!.outputs = Object.fromEntries(Object.entries(definition.composition!.outputs).map(([id, endpoint]) => [names[id] ?? id, endpoint]));
  return definition;
}
