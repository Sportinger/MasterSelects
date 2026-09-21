import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../types/operatorGraph';
import { validateEffectGraph } from './effectGraph';
import { compileImageOperatorGraph, compileImageOperatorPreview, type ImageOperatorPlan, type ImageOperatorPreviewTarget } from './imageOperatorGraph';
import { NEAREST_SEED_FIELD_FORMAT, type ImageOperatorFieldResource } from './imageOperatorFieldResources';
import { IMAGE_OPERATORS } from './imageOperators';
import { getEffectOperator } from './operatorRegistry';
import { createComputeEffectParameterSchema } from '../../effects/geometry/computeEffectFactory';
import type { ImageOperatorCompileContext } from './imageOperatorChoice';

export type ComputeImageStage = {
  nodeId: string;
  kind: 'seed';
  params: Record<string, number | boolean | string>;
} | {
  nodeId: string;
  kind: 'jump-flood';
  input: string;
  params: Record<string, number | boolean | string>;
};

export interface ComputeImagePlan {
  key: string;
  stages: readonly ComputeImageStage[];
  output: string;
  passthrough: boolean;
  imageProgram?: ImageOperatorPlan;
}
export interface ComputeImagePreviewCompilation {
  plan: ImageOperatorPlan;
  requiredStages: readonly ComputeImageStage[];
}

const IMAGE_IDS = new Set(['image.frame', 'values.number', 'values.boolean', 'values.color', 'values.choice',
  ...IMAGE_OPERATORS.map(item => item.id), 'field.read-nearest-seed']);
const STAGE_KIND = new Map<string, ComputeImageStage['kind']>([
  ['geometry.voronoi-seeds', 'seed'], ['geometry.jump-flood', 'jump-flood'],
]);
const hash = (text: string) => {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  return (value >>> 0).toString(16).padStart(8, '0');
};

function primitive(value: OperatorValue, name: string): number | boolean | string {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Compute image parameter ${name} must be finite.`);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  throw new Error(`Compute image parameter ${name} must be primitive.`);
}

function stageParams(node: BoundOperatorNode, params: Record<string, unknown>) {
  const definition = getEffectOperator(node.operator)!;
  return Object.fromEntries(definition.parameters.map(spec => {
    const binding = node.bindings[spec.id];
    const candidate = typeof binding === 'string' ? params[binding] ?? spec.default : node.constants?.[spec.id] ?? spec.default;
    const value = primitive(candidate as OperatorValue, `${node.id}.${spec.id}`);
    if (spec.type === 'number' && typeof value !== 'number') throw new Error(`Compute image parameter ${node.id}.${spec.id} must be numeric.`);
    if (spec.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Compute image parameter ${node.id}.${spec.id} must be Boolean.`);
    if ((spec.type === 'select' || spec.type === 'color') && typeof value !== 'string') throw new Error(`Compute image parameter ${node.id}.${spec.id} must be a string.`);
    if (spec.type === 'select' && !spec.options?.some(option => option.value === value)) {
      throw new Error(`Compute image parameter ${node.id}.${spec.id} has an invalid option.`);
    }
    return [spec.id, value];
  }));
}

function orderedDependencies(graph: EffectOperatorGraph, roots: readonly string[]) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node])), reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id); for (const edge of graph.edges.filter(item => item.to === id)) visit(edge.from);
  };
  roots.forEach(visit);
  const ordered: BoundOperatorNode[] = [], emitted = new Set<string>();
  const emit = (id: string) => {
    if (emitted.has(id) || !reachable.has(id)) return;
    for (const edge of graph.edges.filter(item => item.to === id)) emit(edge.from);
    emitted.add(id); ordered.push(nodes.get(id)!);
  };
  roots.forEach(emit);
  return { ordered, reachable };
}

function stageCandidates(graph: EffectOperatorGraph, ordered: readonly BoundOperatorNode[], params: Record<string, unknown>) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const incoming = (nodeId: string, port?: string) => graph.edges.find(edge => edge.to === nodeId && (!port || edge.input === port));
  return ordered.flatMap((node): ComputeImageStage[] => {
    const kind = STAGE_KIND.get(node.operator); if (!kind) return [];
    const values = stageParams(node, params);
    if (kind === 'seed') return [{ nodeId: node.id, kind, params: values }];
    const input = incoming(node.id, 'field');
    if (!input || !STAGE_KIND.has(nodes.get(input.from)?.operator ?? '')) throw new Error(`Jump Flood ${node.id} requires a compute stage input.`);
    return [{ nodeId: node.id, kind, input: input.from, params: values }];
  });
}

function fieldResources(graph: EffectOperatorGraph, ordered: readonly BoundOperatorNode[]): ImageOperatorFieldResource[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node])), result: ImageOperatorFieldResource[] = [];
  for (const read of ordered.filter(node => node.operator === 'field.read-nearest-seed')) {
    const producerEdge = graph.edges.find(edge => edge.to === read.id && edge.input === 'field')!;
    const producer = nodes.get(producerEdge.from)!;
    if (!STAGE_KIND.has(producer.operator)) throw new Error(`Nearest-seed read ${read.id} requires a compute stage producer.`);
    if (!result.some(item => item.producerNodeId === producer.id)) result.push({ resourceId: `voronoi-field:${producer.id}`,
      producerNodeId: producer.id, outputPort: 'field', format: NEAREST_SEED_FIELD_FORMAT });
  }
  return result;
}

function requiredStages(program: ImageOperatorPlan, candidates: readonly ComputeImageStage[]) {
  const byId = new Map(candidates.map(stage => [stage.nodeId, stage]));
  const used = new Set(program.fieldResources?.map(resource => resource.producerNodeId) ?? []);
  const includeInputs = (id: string) => {
    const stage = byId.get(id);
    if (!stage || !('input' in stage) || used.has(stage.input)) return;
    used.add(stage.input); includeInputs(stage.input);
  };
  [...used].forEach(includeInputs);
  return candidates.filter(stage => used.has(stage.nodeId));
}

function imageProjection(graph: EffectOperatorGraph, included: ReadonlySet<string>): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'image',
    nodes: graph.nodes.filter(node => included.has(node.id)).map(node => ({ ...node, bindings: { ...node.bindings },
      ...(node.constants ? { constants: { ...node.constants } } : {}) })),
    edges: graph.edges.filter(edge => included.has(edge.from) && included.has(edge.to)).map(edge => ({ ...edge })),
    layout: Object.fromEntries([...included].map(id => [id, graph.layout[id] ?? { x: 0, y: 0 }])),
  };
}

function prepare(graph: EffectOperatorGraph, params: Record<string, unknown>, context: ImageOperatorCompileContext) {
  const errors = validateEffectGraph(graph); if (errors.length) throw new Error(errors[0]);
  if (graph.domain !== 'compute-image' || graph.schemaVersion !== 1) throw new Error('Expected a compute-image operator graph.');
  const schema = context.parameterSchema ?? createComputeEffectParameterSchema({ animated: true });
  const defaults = Object.fromEntries(Object.entries(schema).map(([id, spec]) => [id, spec.default]));
  const resolvedParams = { ...defaults, ...params };
  for (const node of graph.nodes) {
    if (!IMAGE_IDS.has(node.operator) && !STAGE_KIND.has(node.operator)) throw new Error(`Unsupported compute-image node: ${node.id}.`);
    if (node.bypassed && !getEffectOperator(node.operator)?.bypass) throw new Error(`Compute-image node cannot be bypassed: ${node.id}.`);
  }
  return resolvedParams;
}

/** Compiles specialized compute stages plus the reachable shared image resolve.
 * Runtime resources are transient; only the normal EffectOperatorGraph persists. */
export function compileComputeImageGraph(graph: EffectOperatorGraph, params: Record<string, unknown> = {},
  context: ImageOperatorCompileContext = {}): ComputeImagePlan {
  const resolvedParams = prepare(graph, params, context);

  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const outputNode = graph.nodes.find(node => node.operator === 'image.output')!;
  const incoming = (nodeId: string, port?: string) => graph.edges.find(edge => edge.to === nodeId && (!port || edge.input === port));
  const outputEdge = incoming(outputNode.id, 'image')!;
  const { ordered, reachable } = orderedDependencies(graph, [outputNode.id]);
  const candidates = stageCandidates(graph, ordered, resolvedParams);

  const outputProducer = nodes.get(outputEdge.from)!;
  const passthrough = outputProducer.operator === 'image.frame';
  if (passthrough) {
    const stable = JSON.stringify({ stages: [], output: outputProducer.id });
    return { key: `compute-image-v1-${hash(stable)}`, stages: [], output: outputProducer.id, passthrough: true };
  }

  const fields = fieldResources(graph, ordered);
  const imageProgram = compileImageOperatorGraph(imageProjection(graph, reachable), resolvedParams, { ...context, fieldResources: fields });
  const stages = requiredStages(imageProgram, candidates);
  const stableStages = stages.map(stage => ({ nodeId: stage.nodeId, kind: stage.kind, ...('input' in stage ? { input: stage.input } : {}) }));
  const stable = JSON.stringify({ stages: stableStages, output: outputProducer.id, imageKey: imageProgram.key,
    fields: fields.map(item => [item.resourceId, item.producerNodeId, item.outputPort, item.format]) });
  return { key: `compute-image-v1-${hash(stable)}`, stages, output: outputProducer.id, passthrough: false, imageProgram };
}

/** Compiles one explicit preview target without dispatching its required compute stages. */
export function compileComputeImagePreview(graph: EffectOperatorGraph, params: Record<string, unknown>,
  target: ImageOperatorPreviewTarget, context: ImageOperatorCompileContext = {}): ComputeImagePreviewCompilation {
  const resolvedParams = prepare(graph, params, context);
  if (!graph.nodes.some(node => node.id === target.nodeId)) throw new Error(`Compute image preview target ${target.nodeId} is missing.`);
  const { ordered, reachable } = orderedDependencies(graph, graph.nodes.map(node => node.id));
  const fields = fieldResources(graph, ordered);
  const plan = compileImageOperatorPreview(imageProjection(graph, reachable), resolvedParams, target, { ...context, fieldResources: fields });
  return { plan, requiredStages: requiredStages(plan, stageCandidates(graph, ordered, resolvedParams)) };
}
