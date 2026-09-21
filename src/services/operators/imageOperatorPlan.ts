import type { EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import type { ImageOperatorPlan, ImageOperatorPreviewTarget } from './imageOperatorGraph';

type CompileSingle = (graph: EffectOperatorGraph, params: Record<string, unknown>, preview?: ImageOperatorPreviewTarget) => ImageOperatorPlan;
interface Cut { nodeId: string; producerNodeId: string; producerPort: string; resourceId: string; passId: string; edgeId?: string }

/** Adds explicit and required neighborhood barriers while every pass still uses the canonical image instruction compiler. */
export function compileImageOperatorPassPlan(graph: EffectOperatorGraph, params: Record<string, unknown>, compileSingle: CompileSingle,
  preview?: ImageOperatorPreviewTarget): ImageOperatorPlan {
  if (graph.nodes.some(item => item.operator === 'image.resource-input')) throw new Error('image.resource-input is compiler-internal and cannot be persisted.');
  const incoming = new Map<string, OperatorEdge>();
  for (const item of graph.edges) {
    const key = `${item.to}:${item.input}`;
    if (incoming.has(key)) throw new Error(`Image input ${key} is connected more than once.`);
    incoming.set(key, item);
  }
  const nodes = new Map(graph.nodes.map(item => [item.id, item]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const assertAcyclic = (id: string) => {
    if (visiting.has(id)) throw new Error('Image graph contains a cycle.');
    if (visited.has(id)) return;
    visiting.add(id); for (const item of graph.edges) if (item.from === id) assertAcyclic(item.to);
    visiting.delete(id); visited.add(id);
  };
  for (const id of nodes.keys()) assertAcyclic(id);
  const root = preview?.direction === 'output' ? preview.nodeId
    : preview?.direction === 'input' ? incoming.get(`${preview.nodeId}:${preview.portId}`)?.from
    : incoming.get(`${graph.nodes.find(item => item.operator === 'image.output')?.id}:image`)?.from;
  const reachable = new Set<string>();
  const mark = (id: string | undefined) => { if (!id || reachable.has(id)) return; reachable.add(id); for (const edge of graph.edges) if (edge.to === id) mark(edge.from); };
  mark(root);
  const cuts: Cut[] = [];
  for (const item of graph.nodes) if (item.operator === 'image.materialize' && reachable.has(item.id)) {
    const source = incoming.get(`${item.id}:image`);
    if (!source) throw new Error(`Image materialize ${item.id}:image is not connected.`);
    cuts.push({ nodeId: item.id, producerNodeId: source.from, producerPort: source.output,
      resourceId: `image-resource:${item.id}:image`, passId: `image-pass:${item.id}` });
  }
  const hasNeighborhoodUpstream = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false; seen.add(id);
    if (nodes.get(id)?.operator === 'image.materialize') return false;
    if (nodes.get(id)?.operator === 'image.kernel-grid-reduce' || nodes.get(id)?.operator === 'image.sequence-reduce') return true;
    return graph.edges.some(edge => edge.to === id && hasNeighborhoodUpstream(edge.from, seen));
  };
  for (const reducer of graph.nodes) if ((reducer.operator === 'image.kernel-grid-reduce' || reducer.operator === 'image.sequence-reduce') && reachable.has(reducer.id)) {
    const sample = incoming.get(`${reducer.id}:sample`);
    const boundaries: OperatorEdge[] = [], seen = new Set<string>();
    const collectSampleBoundaries = (id: string) => {
      if (seen.has(id)) return; seen.add(id);
      if (nodes.get(id)?.operator === 'image.materialize') return;
      if (nodes.get(id)?.operator === 'image.sample') { const boundary = incoming.get(`${id}:image`); if (boundary) boundaries.push(boundary); return; }
      for (const item of graph.edges) if (item.to === id) collectSampleBoundaries(item.from);
    };
    if (sample) collectSampleBoundaries(sample.from);
    const cutEdges = boundaries.filter(item => hasNeighborhoodUpstream(item.from));
    if (!cutEdges.length && sample && hasNeighborhoodUpstream(sample.from)) cutEdges.push(sample);
    for (const [index, cutEdge] of cutEdges.entries()) {
      const nodeId = `__auto-materialize-${reducer.id}-${index}`;
      cuts.push({ nodeId, producerNodeId: cutEdge.from, producerPort: cutEdge.output, edgeId: cutEdge.id,
        resourceId: `image-resource:${cutEdge.from}:${cutEdge.output}`, passId: `image-pass:${cutEdge.from}:${cutEdge.output}` });
    }
  }
  if (!cuts.length) return compileSingle(graph, params, preview);
  const producerCuts = cuts.filter((cut, index) => cuts.findIndex(item => item.resourceId === cut.resourceId) === index);
  const transformed = structuredClone(graph);
  for (const cut of cuts) {
    if (cut.edgeId) {
      transformed.nodes.push({ id: cut.nodeId, operator: 'image.resource-input', operatorVersion: 1, bindings: { resource: cut.resourceId } });
      const edge = transformed.edges.find(item => item.id === cut.edgeId)!; edge.from = cut.nodeId; edge.output = 'image';
    } else {
      const materialize = transformed.nodes.find(item => item.id === cut.nodeId)!;
      materialize.operator = 'image.resource-input'; materialize.bindings = { resource: cut.resourceId };
      transformed.edges = transformed.edges.filter(item => !(item.to === cut.nodeId && item.input === 'image'));
    }
  }
  const programs = new Map<string, ImageOperatorPlan>();
  for (const cut of producerCuts) programs.set(cut.resourceId, compileSingle(transformed, params,
    { nodeId: cut.producerNodeId, direction: 'output', portId: cut.producerPort }));
  const ordered: Cut[] = [], pending = new Set(producerCuts.map(item => item.resourceId));
  while (pending.size) {
    const ready = producerCuts.filter(cut => pending.has(cut.resourceId)
      && (programs.get(cut.resourceId)?.resourceInputs ?? []).every(id => !pending.has(id)));
    if (!ready.length) throw new Error('Image materialization plan contains a resource cycle.');
    for (const cut of ready) { ordered.push(cut); pending.delete(cut.resourceId); }
  }
  const finalProgram = compileSingle(transformed, params, preview);
  const passes: Array<{ id: string; program: ImageOperatorPlan; inputResources: readonly string[]; outputResource?: string }> = ordered.map(cut => ({ id: cut.passId, program: programs.get(cut.resourceId)!,
    inputResources: programs.get(cut.resourceId)!.resourceInputs ?? [], outputResource: cut.resourceId }));
  passes.push({ id: 'image-pass:final', program: finalProgram, inputResources: finalProgram.resourceInputs ?? [] });
  const resources = ordered.map(cut => ({ id: cut.resourceId, producerPassId: cut.passId, format: 'rgba16float' as const }));
  const previewResourceId = preview?.direction === 'output' && preview.portId === 'image'
    ? cuts.find(cut => cut.nodeId === preview.nodeId && !cut.edgeId)?.resourceId : undefined;
  return { ...finalProgram, passes, resources, key: `${finalProgram.key}-plan-${passes.map(pass => pass.program.key).join('-')}`,
    ...(previewResourceId ? { previewResourceId } : {}) };
}
