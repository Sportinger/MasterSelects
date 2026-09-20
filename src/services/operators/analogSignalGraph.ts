import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorValue } from '../../types/operatorGraph';
import { getEffectOperator } from './operatorRegistry';
import { operatorPortsCompatible } from './portContracts';

export type AnalogSignalStageKind = 'encode' | 'rf' | 'vhs' | 'analyze' | 'decode' | 'resolve';
export interface AnalogSignalStage {
  nodeId: string; kind: AnalogSignalStageKind; input?: string; source?: string; receiver?: string;
  params: Record<string, number | boolean | string>;
}
export interface AnalogSignalPlan { key: string; stages: AnalogSignalStage[]; output: string; passthrough: boolean }

const node = (id: string, operator: string, parameters = true): BoundOperatorNode => {
  const definition = getEffectOperator(operator);
  return { id, operator, operatorVersion: 1, bindings: parameters
    ? Object.fromEntries((definition?.parameters ?? []).map(spec => [spec.id, spec.id])) : {} };
};
const edge = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });

export function createDefaultAnalogSignalGraph(): EffectOperatorGraph {
  return {
    version: 1, schemaVersion: 1, domain: 'analog-signal',
    nodes: [node('frame', 'image.frame', false), node('encode', 'analog.pal-encode'), node('rf', 'analog.rf-channel'),
      node('vhs', 'analog.vhs-transport'), node('analyze', 'analog.receiver-analyze'), node('decode', 'analog.pal-decode'),
      node('resolve', 'analog.display-resolve'), node('output', 'image.output', false)],
    edges: [edge('frame-encode', 'frame', 'image', 'encode', 'image'), edge('encode-rf', 'encode', 'signal', 'rf', 'signal'),
      edge('rf-vhs', 'rf', 'signal', 'vhs', 'signal'), edge('vhs-analyze', 'vhs', 'signal', 'analyze', 'signal'),
      edge('vhs-decode', 'vhs', 'signal', 'decode', 'signal'), edge('analyze-decode', 'analyze', 'lines', 'decode', 'receiver'),
      edge('frame-resolve', 'frame', 'image', 'resolve', 'source'), edge('decode-resolve', 'decode', 'image', 'resolve', 'decoded'),
      edge('resolve-output', 'resolve', 'image', 'output', 'image')],
    layout: { frame: { x: 0, y: 0 }, encode: { x: 300, y: 0 }, rf: { x: 600, y: 0 }, vhs: { x: 900, y: 0 },
      analyze: { x: 1200, y: 300 }, decode: { x: 1500, y: 0 }, resolve: { x: 1800, y: 0 }, output: { x: 2100, y: 0 } },
  };
}

const ALLOWED = new Set(['image.frame', 'image.output', 'analog.pal-encode', 'analog.rf-channel', 'analog.vhs-transport',
  'analog.receiver-analyze', 'analog.pal-decode', 'analog.display-resolve']);

/** Returns validation errors; compilation throws the first error. */
export function validateAnalogSignalGraph(graph: EffectOperatorGraph): string[] {
  if (graph.version !== 1 || graph.schemaVersion !== 1 || graph.domain !== 'analog-signal') return ['Invalid Analog Signal graph version or domain.'];
  if (graph.nodes.length > 64 || graph.edges.length > 256) return ['Analog Signal graph is too large.'];
  const errors: string[] = [], nodes = new Map(graph.nodes.map(item => [item.id, item]));
  if (nodes.size !== graph.nodes.length) errors.push('Duplicate Analog Signal node ID.');
  for (const item of graph.nodes) {
    const definition = getEffectOperator(item.operator);
    if (!ALLOWED.has(item.operator) || !definition || item.operatorVersion !== 1) errors.push(`Invalid Analog Signal node: ${item.id}.`);
    if (item.bypassed && !['analog.rf-channel', 'analog.vhs-transport', 'analog.display-resolve'].includes(item.operator)) errors.push(`Node cannot be bypassed: ${item.id}.`);
  }
  const occupied = new Set<string>();
  for (const connection of graph.edges) {
    const from = nodes.get(connection.from), to = nodes.get(connection.to);
    const output = getEffectOperator(from?.operator ?? '')?.outputs.find(port => port.id === connection.output);
    const input = getEffectOperator(to?.operator ?? '')?.inputs.find(port => port.id === connection.input);
    const key = `${connection.to}:${connection.input}`;
    if (!from || !to || !output || !input || !operatorPortsCompatible(output, input) || occupied.has(key)) errors.push(`Invalid Analog Signal connection: ${connection.id}.`);
    occupied.add(key);
  }
  const incomingEdge = (id: string, input: string) => graph.edges.find(item => item.to === id && item.input === input);
  for (const item of graph.nodes) {
    if (item.operator === 'analog.pal-encode' && nodes.get(incomingEdge(item.id, 'image')?.from ?? '')?.operator !== 'image.frame') {
      errors.push(`PAL Encode requires an image.frame source: ${item.id}.`);
    }
    if (item.operator === 'analog.display-resolve' && nodes.get(incomingEdge(item.id, 'source')?.from ?? '')?.operator !== 'image.frame') {
      errors.push(`Display Resolve requires an image.frame original: ${item.id}.`);
    }
  }
  for (const item of graph.nodes) for (const input of getEffectOperator(item.operator)?.inputs ?? []) {
    if (input.required && !occupied.has(`${item.id}:${input.id}`) && !(item.operator === 'analog.display-resolve' && item.bypassed && input.id === 'decoded')) {
      errors.push(`Missing Analog Signal input: ${item.id}.${input.id}.`);
    }
  }
  if (graph.nodes.filter(item => item.operator === 'image.output').length !== 1) errors.push('Analog Signal graph needs one image output.');
  const output = graph.nodes.find(item => item.operator === 'image.output');
  const outputSource = output ? nodes.get(incomingEdge(output.id, 'image')?.from ?? '') : undefined;
  if (outputSource && outputSource.operator !== 'image.frame' && outputSource.operator !== 'analog.display-resolve') {
    errors.push('Analog Signal output must receive a frame or display-resolved image.');
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id);
    if (graph.edges.filter(item => item.from === id).some(item => cyclic(item.to))) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (graph.nodes.some(item => cyclic(item.id))) errors.push('Analog Signal graph cannot contain cycles.');
  return errors;
}

const kindByOperator: Record<string, AnalogSignalStageKind> = {
  'analog.pal-encode': 'encode', 'analog.rf-channel': 'rf', 'analog.vhs-transport': 'vhs',
  'analog.receiver-analyze': 'analyze', 'analog.pal-decode': 'decode', 'analog.display-resolve': 'resolve',
};
const hash = (text: string) => { let value = 0x811c9dc5; for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193); return (value >>> 0).toString(16).padStart(8, '0'); };
const primitive = (value: OperatorValue): number | boolean | string => {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Analog Signal parameters must be finite.');
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  throw new Error('Analog Signal parameters must be primitive values.');
};
function stageParams(item: BoundOperatorNode, definition: OperatorDefinition, params: Record<string, unknown>) {
  return Object.fromEntries(definition.parameters.map(spec => {
    const binding = item.bindings[spec.id];
    const value = item.constants?.[spec.id] ?? (typeof binding === 'string' ? params[binding] : undefined) ?? spec.default;
    const resolved = primitive(value as OperatorValue);
    if (spec.type === 'select' && !spec.options?.some(option => option.value === resolved)) throw new Error(`Invalid ${spec.id} option.`);
    return [spec.id, resolved];
  }));
}

export function compileAnalogSignalGraph(graph: EffectOperatorGraph, params: Record<string, unknown> = {}): AnalogSignalPlan {
  const errors = validateAnalogSignalGraph(graph); if (errors.length) throw new Error(errors[0]);
  const nodes = new Map(graph.nodes.map(item => [item.id, item]));
  const incoming = (id: string, port?: string) => graph.edges.find(item => item.to === id && (!port || item.input === port));
  const outputNode = graph.nodes.find(item => item.operator === 'image.output')!;
  const reachable = new Set<string>();
  const dependencies = (id: string) => {
    const item = nodes.get(id)!;
    const bypassInput = item.bypassed ? (item.operator === 'analog.display-resolve' ? 'source' : 'signal') : undefined;
    return graph.edges.filter(edgeItem => edgeItem.to === id && (!bypassInput || edgeItem.input === bypassInput));
  };
  const visit = (id: string) => { if (reachable.has(id)) return; reachable.add(id); for (const item of dependencies(id)) visit(item.from); };
  visit(outputNode.id);
  const order: BoundOperatorNode[] = [], emitted = new Set<string>();
  const emit = (id: string) => { if (emitted.has(id) || !reachable.has(id)) return; for (const item of dependencies(id)) emit(item.from); emitted.add(id); order.push(nodes.get(id)!); };
  emit(outputNode.id);
  const aliases = new Map<string, string>();
  const resolveId = (id: string): string => aliases.has(id) ? resolveId(aliases.get(id)!) : id;
  const stages: AnalogSignalStage[] = [];
  for (const item of order) {
    const definition = getEffectOperator(item.operator)!;
    if (item.operator === 'image.frame') continue;
    if (item.operator === 'image.output') { aliases.set(item.id, resolveId(incoming(item.id, 'image')!.from)); continue; }
    if (item.bypassed) {
      const bypassPort = item.operator === 'analog.display-resolve' ? 'source' : 'signal';
      aliases.set(item.id, resolveId(incoming(item.id, bypassPort)!.from)); continue;
    }
    const kind = kindByOperator[item.operator], values = stageParams(item, definition, params);
    const primaryPort = kind === 'resolve' ? 'decoded' : kind === 'decode' ? 'signal' : definition.inputs[0]?.id;
    const stage: AnalogSignalStage = { nodeId: item.id, kind, params: values };
    if (primaryPort) stage.input = resolveId(incoming(item.id, primaryPort)!.from);
    if (kind === 'resolve') stage.source = resolveId(incoming(item.id, 'source')!.from);
    if (kind === 'decode') stage.receiver = resolveId(incoming(item.id, 'receiver')!.from);
    stages.push(stage);
  }
  const output = resolveId(outputNode.id), stageById = new Map(stages.map(stage => [stage.nodeId, stage]));
  const signalLineage = (start: string | undefined) => {
    const lineage: AnalogSignalStage[] = [], seen = new Set<string>(); let current = start;
    while (current && !seen.has(current)) { seen.add(current); const stage = stageById.get(current); if (!stage) break; lineage.push(stage); current = stage.input; }
    return lineage;
  };
  const decodeStages = stages.filter(stage => stage.kind === 'decode');
  for (const stage of stages.filter(candidate => candidate.kind !== 'encode' && candidate.kind !== 'decode' && candidate.kind !== 'resolve')) {
    const inherited = Object.assign({}, ...signalLineage(stage.input).reverse().map(upstream => upstream.params));
    stage.params = { ...inherited, ...stage.params };
  }
  for (const decode of decodeStages) {
    const lineage = signalLineage(decode.input);
    const receiver = decode.receiver ? stageById.get(decode.receiver) : undefined;
    const inherited = Object.assign({}, ...[...lineage].reverse().map(upstream => upstream.params));
    decode.params = { ...inherited, ...(receiver?.kind === 'analyze' ? receiver.params : {}), ...decode.params };
    if (!lineage.some(stage => stage.kind === 'rf')) decode.params.rfAmount = 0;
    if (!lineage.some(stage => stage.kind === 'vhs')) decode.params.vhsAmount = 0;
  }
  for (const resolve of stages.filter(stage => stage.kind === 'resolve')) {
    const decode = resolve.input ? stageById.get(resolve.input) : undefined;
    const lineage = decode?.kind === 'decode' ? signalLineage(decode.input) : [];
    const encode = lineage.find(stage => stage.kind === 'encode');
    const rfStage = lineage.find(stage => stage.kind === 'rf');
    const vhsStage = lineage.find(stage => stage.kind === 'vhs');
    if (encode) resolve.params.palAmount = encode.params.palAmount;
    resolve.params.rfAmount = rfStage?.params.rfAmount ?? 0;
    resolve.params.vhsAmount = vhsStage?.params.vhsAmount ?? 0;
    const receiver = decode?.receiver ? stageById.get(decode.receiver) : undefined;
    resolve.params.receiverAmount = receiver?.params.receiverAmount ?? 0;
  }
  const stable = JSON.stringify({ stages, output });
  return { key: `analog-signal-v1-${hash(stable)}`, stages, output, passthrough: stages.length === 0 };
}
