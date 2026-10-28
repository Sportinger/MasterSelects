import { applyOperatorGroupBypasses } from './operatorGroupBypass';
import type { ImageOperatorCompileContext } from './imageOperatorChoice';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { finiteEffectNumber } from '../../effects/_shared/effectNumberParam';
import type { ImageOperatorPlan, ImageOperatorPreviewTarget } from './imageOperatorGraph';
import { materializeMotionImages } from './motionImagePasses';
import { bypassIdentityImageFilters } from './imageFilterShortcuts';
import { expandTemporalSmoothing } from './temporalSmoothPasses';
import { cacheImageScale } from './imageResourceScale';
import { SEGMENT_SORT_OPERATOR, segmentSortSettings, type SegmentSortSettings } from './imageSegmentSortAxis';
import type { ImageOperatorPass } from './imageOperatorPlanTypes';

type CompileSingle = (graph: EffectOperatorGraph, params: Record<string, unknown>, preview?: ImageOperatorPreviewTarget) => ImageOperatorPlan;
/** Cache Image `maxEdge` (pixels of the longer side; 0 = full size, at most 8192), a constant or a bound
 * effect parameter read once per compile (imagePlanResourceSignature recompiles when it changes).
 * Downscaled caches hold statistics and analysis images; reads from them are filtered like any other resource. */
export function materializeMaxEdge(node: Pick<BoundOperatorNode, 'bindings' | 'constants'>, params: Record<string, unknown>): number | undefined {
  const binding = node.bindings?.maxEdge;
  const value = finiteEffectNumber(typeof binding === 'string' ? params[binding] : node.constants?.maxEdge, 0);
  return value >= 1 ? Math.round(Math.min(8192, value)) : undefined;
}
interface Cut { nodeId: string; producerNodeId: string; producerPort: string; resourceId: string; passId: string; edgeId?: string; maxEdge?: number; scale?: number;
  /** A Segment Sort's colour copy: its pass reads the sort's Image input, the graph itself is not rewritten. */
  colorOf?: string;
  /** A Segment Sort: the pass renders the control image, then sorts `colorResource` by it. */
  sort?: { settings: SegmentSortSettings; colorResource: string } }
/** Nodes whose output is a pass resource: neighbourhood scans and reducer boundaries stop there. */
const isPassBoundary = (operator: string | undefined) => operator === 'image.materialize' || operator === SEGMENT_SORT_OPERATOR;

/** Adds explicit and required neighborhood barriers while every pass still uses the canonical image instruction compiler. */
export function compileImageOperatorPassPlan(graph: EffectOperatorGraph, params: Record<string, unknown>, compileSingle: CompileSingle,
  preview?: ImageOperatorPreviewTarget, context: ImageOperatorCompileContext = {}): ImageOperatorPlan {
  if (graph.nodes.some(item => item.operator === 'image.resource-input')) throw new Error('image.resource-input is compiler-internal and cannot be persisted.');
  if (graph.groups?.some(group => group.bypassed)) {
    graph = applyOperatorGroupBypasses(graph);
    graph = { ...graph, groups: graph.groups?.map(group => ({ ...group, bypassed: false })) };
  }
  graph = expandTemporalSmoothing(materializeMotionImages(bypassIdentityImageFilters(graph, params, context), params));
  if (preview?.direction === 'output' && preview.portId === 'image'
    && graph.nodes.some(node => node.id === `__motion-field:${preview!.nodeId}`)) {
    preview = { ...preview, nodeId: `__motion-field:${preview.nodeId}` };
  }
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
    if (item.bindings.scale !== undefined) throw new Error(`Cache Image ${item.id}: Resolution is a fixed setting and cannot be bound to a parameter.`);
    cuts.push({ nodeId: item.id, producerNodeId: source.from, producerPort: source.output,
      resourceId: `image-resource:${item.id}:image`, passId: `image-pass:${item.id}`,
      maxEdge: materializeMaxEdge(item, params), scale: cacheImageScale(item.constants) });
  }
  for (const item of graph.nodes) if (item.operator === SEGMENT_SORT_OPERATOR && reachable.has(item.id)) {
    const image = incoming.get(`${item.id}:image`), key = incoming.get(`${item.id}:key`);
    if (!image || !key) throw new Error(`Segment Sort ${item.id} needs its Image and Key inputs connected.`);
    // A full-size cache or another sort already is a frame-size resource: sort it directly.
    const source = nodes.get(image.from);
    const direct = source && (source.operator === SEGMENT_SORT_OPERATOR
      || (source.operator === 'image.materialize' && !materializeMaxEdge(source, params) && !cacheImageScale(source.constants)));
    const colorResource = direct ? `image-resource:${source.id}:image` : `image-resource:${item.id}:color`;
    if (!direct) cuts.push({ nodeId: `__segment-sort-color-${item.id}`, producerNodeId: image.from, producerPort: image.output,
      resourceId: colorResource, passId: `image-pass:${item.id}:color`, colorOf: item.id });
    cuts.push({ nodeId: item.id, producerNodeId: `__segment-sort-control-${item.id}`, producerPort: 'image',
      resourceId: `image-resource:${item.id}:image`, passId: `image-pass:${item.id}`,
      sort: { settings: segmentSortSettings(item, params), colorResource } });
  }
  const hasNeighborhoodUpstream = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false; seen.add(id);
    if (isPassBoundary(nodes.get(id)?.operator)) return false;
    if (['image.kernel-grid-reduce', 'image.kernel-rect-reduce', 'image.sequence-reduce', 'image.sequence-blend'].includes(nodes.get(id)?.operator ?? '')) return true;
    return graph.edges.some(edge => edge.to === id && hasNeighborhoodUpstream(edge.from, seen));
  };
  for (const reducer of graph.nodes) if (['image.kernel-grid-reduce', 'image.kernel-rect-reduce', 'image.sequence-reduce', 'image.sequence-blend'].includes(reducer.operator) && reachable.has(reducer.id)) {
    const sample = incoming.get(`${reducer.id}:sample`);
    const boundaries: OperatorEdge[] = [], seen = new Set<string>();
    const collectSampleBoundaries = (id: string) => {
      if (seen.has(id)) return; seen.add(id);
      if (isPassBoundary(nodes.get(id)?.operator)) return;
      if (nodes.get(id)?.operator === 'image.sample' || nodes.get(id)?.operator === 'image.load-pixel-clamped') {
        const boundary = incoming.get(`${id}:image`); if (boundary) boundaries.push(boundary); return;
      }
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
    if (cut.colorOf) continue;
    if (cut.sort) { replaceSegmentSort(transformed, cut.nodeId, cut.resourceId); continue; }
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
      && [...(programs.get(cut.resourceId)?.resourceInputs ?? []), ...(cut.sort ? [cut.sort.colorResource] : [])].every(id => !pending.has(id)));
    if (!ready.length) throw new Error('Image materialization plan contains a resource cycle.');
    for (const cut of ready) { ordered.push(cut); pending.delete(cut.resourceId); }
  }
  const finalProgram = compileSingle(transformed, params, preview);
  const passes: ImageOperatorPass[] = ordered.map(cut => ({ id: cut.passId, program: programs.get(cut.resourceId)!,
    inputResources: programs.get(cut.resourceId)!.resourceInputs ?? [], outputResource: cut.resourceId, ...(cut.sort ? { segmentSort: cut.sort } : {}) }));
  passes.push({ id: 'image-pass:final', program: finalProgram, inputResources: finalProgram.resourceInputs ?? [] });
  const resources = ordered.map(cut => ({ id: cut.resourceId, producerPassId: cut.passId, format: 'rgba16float' as const, maxEdge: cut.maxEdge,
    ...(cut.scale ? { scale: cut.scale } : {}) }));
  // Reduced-resolution caches change texture sizes, not shader code: they still need their own plan key.
  const scaleKey = ordered.some(cut => cut.scale) ? `-scale-${ordered.map(cut => cut.scale ?? 1).join('_')}` : '';
  const externalResources = passes.flatMap(pass => pass.program.externalResources ?? [])
    .filter((resource, index, all) => all.findIndex(candidate => candidate.id === resource.id) === index);
  const fieldResources = passes.flatMap(pass => pass.program.fieldResources ?? [])
    .filter((resource, index, all) => all.findIndex(candidate => candidate.resourceId === resource.resourceId) === index);
  const frameHistoryResource = passes.find(pass => pass.program.frameHistoryResource)?.program.frameHistoryResource;
  const previewResourceId = preview?.direction === 'output' && preview.portId === 'image'
    ? cuts.find(cut => cut.nodeId === preview.nodeId && !cut.edgeId)?.resourceId : undefined;
  return { ...finalProgram, passes, resources, key: `${finalProgram.key}-plan-${passes.map(pass => pass.program.key).join('-')}${scaleKey}`,
    ...(externalResources.length ? { externalResources } : {}), ...(fieldResources.length ? { fieldResources } : {}),
    ...(frameHistoryResource ? { frameHistoryResource } : {}),
    ...(previewResourceId ? { previewResourceId } : {}) };
}

/**
 * Rewrites a Segment Sort node for pass compilation: the node becomes the input of its sorted resource, and a
 * compiler-owned control image (Key, Run Start, Angle, 1) takes over its scalar inputs; unconnected inputs are 0.
 */
function replaceSegmentSort(graph: EffectOperatorGraph, id: string, resourceId: string): void {
  const node = graph.nodes.find(item => item.id === id)!;
  const inputs = new Map(graph.edges.filter(edge => edge.to === id).map(edge => [edge.input, edge]));
  graph.edges = graph.edges.filter(edge => edge.to !== id);
  node.operator = 'image.resource-input'; node.bindings = { resource: resourceId }; delete node.constants;
  const zero = `__segment-sort-zero-${id}`, one = `__segment-sort-one-${id}`, combined = `__segment-sort-control-vec4-${id}`;
  graph.nodes.push(
    { id: zero, operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0 } },
    { id: one, operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 } },
    { id: combined, operator: 'vector.combine.vec4', operatorVersion: 1, bindings: {} },
    { id: `__segment-sort-control-${id}`, operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} });
  const link = (component: string, input?: string) => {
    const edge = input ? inputs.get(input) : undefined;
    const [from, output] = edge ? [edge.from, edge.output] : [input ? zero : one, 'value'];
    graph.edges.push({ id: `${combined}-${component}`, from, output, to: combined, input: component });
  };
  link('x', 'key'); link('y', 'start'); link('z', 'angle'); link('w');
  graph.edges.push({ id: `${combined}-image`, from: combined, output: 'value', to: `__segment-sort-control-${id}`, input: 'value' });
}
