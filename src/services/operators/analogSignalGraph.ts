import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorValue } from '../../types/operatorGraph';
import { getEffectOperator } from './operatorRegistry';
import { operatorPortsCompatible } from './portContracts';
import { createAnalogDisplayResolveIsland } from './analogDisplayResolveGraph';
import { IMAGE_OPERATORS } from './imageOperators';
import { effectGraphLimits } from './effectGraphLimits';
import { compileImageOperatorGraph, compileImageOperatorPreview, type ImageOperatorCompileContext, type ImageOperatorPlan,
  type ImageOperatorPreviewTarget } from './imageOperatorGraph';
import { ANALOG_SIGNAL_LAB_PARAMS } from '../../effects/analog/signal-lab/parameters';

export type AnalogSignalStageKind = 'encode' | 'rf' | 'vhs' | 'analyze' | 'decode' | 'resolve';
export interface AnalogSignalStage {
  nodeId: string; kind: AnalogSignalStageKind; input?: string; source?: string; receiver?: string;
  params: Record<string, number | boolean | string>;
  imageProgram?: ImageOperatorPlan;
  imagePreview?: { graph: EffectOperatorGraph; params: Record<string, unknown>; context: ImageOperatorCompileContext };
}
export interface AnalogSignalPlan { key: string; stages: AnalogSignalStage[]; output: string; passthrough: boolean }
export interface AnalogSignalPreviewCompilation { plan: AnalogSignalPlan; stage: AnalogSignalStage; program: ImageOperatorPlan }

const node = (id: string, operator: string, parameters = true): BoundOperatorNode => {
  const definition = getEffectOperator(operator);
  return { id, operator, operatorVersion: 1, bindings: parameters
    ? Object.fromEntries((definition?.parameters ?? []).map(spec => [spec.id, spec.id])) : {} };
};
const edge = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });

export function createDefaultAnalogSignalGraph(): EffectOperatorGraph {
  const island = createAnalogDisplayResolveIsland({ prefix: 'display', source: { node: 'frame', port: 'image' },
    decoded: { node: 'decode', port: 'image' }, signalAmount: { node: 'decode', port: 'signalAmount' }, anchor: { x: 1800, y: 0 } });
  return {
    version: 1, schemaVersion: 1, domain: 'analog-signal',
    nodes: [node('frame', 'image.frame', false), node('encode', 'analog.pal-encode'), node('rf', 'analog.rf-channel'),
      node('vhs', 'analog.vhs-transport'), node('analyze', 'analog.receiver-analyze'), node('decode', 'analog.pal-decode'),
      ...island.nodes, node('output', 'image.output', false)],
    edges: [edge('frame-encode', 'frame', 'image', 'encode', 'image'), edge('encode-rf', 'encode', 'signal', 'rf', 'signal'),
      edge('rf-vhs', 'rf', 'signal', 'vhs', 'signal'), edge('vhs-analyze', 'vhs', 'signal', 'analyze', 'signal'),
      edge('vhs-decode', 'vhs', 'signal', 'decode', 'signal'), edge('analyze-decode', 'analyze', 'lines', 'decode', 'receiver'),
      ...island.edges, edge('resolve-output', island.output.node, island.output.port, 'output', 'image')],
    layout: { frame: { x: 0, y: 0 }, encode: { x: 300, y: 0 }, rf: { x: 600, y: 0 }, vhs: { x: 900, y: 0 },
      analyze: { x: 1200, y: 300 }, decode: { x: 1500, y: 0 }, ...island.layout, output: { x: 11100, y: 0 } }, groups: island.groups,
  };
}

const ALLOWED = new Set(['image.frame', 'image.output', 'analog.pal-encode', 'analog.rf-channel', 'analog.vhs-transport',
  'analog.receiver-analyze', 'analog.pal-decode', 'analog.display-resolve', 'values.number', 'values.boolean', 'values.color', 'values.choice',
  ...IMAGE_OPERATORS.map(item => item.id)]);

/** Returns validation errors; compilation throws the first error. */
export function validateAnalogSignalGraph(graph: EffectOperatorGraph): string[] {
  if (graph.version !== 1 || graph.schemaVersion !== 1 || graph.domain !== 'analog-signal') return ['Invalid Analog Signal graph version or domain.'];
  const limits = effectGraphLimits(graph.domain);
  if (graph.nodes.length > limits.nodes || graph.edges.length > limits.edges) return ['Analog Signal graph is too large.'];
  const errors: string[] = [], nodes = new Map(graph.nodes.map(item => [item.id, item]));
  if (nodes.size !== graph.nodes.length) errors.push('Duplicate Analog Signal node ID.');
  for (const item of graph.nodes) {
    const definition = getEffectOperator(item.operator);
    if (!ALLOWED.has(item.operator) || !definition || item.operatorVersion !== 1) errors.push(`Invalid Analog Signal node: ${item.id}.`);
    if (item.operator === 'image.named-input' || item.operator === 'image.resource-input') errors.push(`Named image inputs are compiler-owned: ${item.id}.`);
    if (item.operator.startsWith('image.derivative.')) errors.push(`Analog compute resolve does not support fragment derivatives: ${item.id}.`);
    if (item.bypassed && !definition?.bypass) errors.push(`Node cannot be bypassed: ${item.id}.`);
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
  if (outputSource && outputSource.operator !== 'image.frame' && outputSource.operator !== 'analog.display-resolve' && !IMAGE_OPERATORS.some(item => item.id === outputSource.operator)) {
    errors.push('Analog Signal output must receive a frame or display-resolved image.');
  }
  const imageOperators = new Set(IMAGE_OPERATORS.map(item => item.id));
  for (const connection of graph.edges) {
    const from = nodes.get(connection.from), to = nodes.get(connection.to);
    if (!from || !to) continue;
    const toImageIsland = imageOperators.has(to.operator) && to.operator !== 'image.output';
    const fromImageIsland = imageOperators.has(from.operator);
    if (toImageIsland && !fromImageIsland && !['values.number', 'values.boolean', 'values.color', 'values.choice'].includes(from.operator)) {
      const validBoundary = (from.operator === 'image.frame' && connection.output === 'image')
        || (from.operator === 'analog.pal-decode' && (connection.output === 'image' || connection.output === 'signalAmount'));
      if (!validBoundary) errors.push(`Invalid Analog Signal image-island boundary: ${connection.id}.`);
    }
    if (fromImageIsland && !toImageIsland && to.operator !== 'image.output') errors.push(`Invalid Analog Signal image-island output: ${connection.id}.`);
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
  const outputProducer = nodes.get(incoming(outputNode.id, 'image')!.from)!;
  const hasImageIsland = outputProducer.operator !== 'image.frame' && outputProducer.operator !== 'analog.display-resolve';
  const imageOperatorIds = new Set(IMAGE_OPERATORS.map(item => item.id));
  const reachable = new Set<string>();
  const dependencies = (id: string) => {
    const item = nodes.get(id)!;
    const bypassInput = item.bypassed ? item.operator === 'analog.display-resolve' ? 'source'
      : item.operator === 'analog.rf-channel' || item.operator === 'analog.vhs-transport' ? 'signal' : undefined : undefined;
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
    if (item.operator === 'image.output') { if (!hasImageIsland) aliases.set(item.id, resolveId(incoming(item.id, 'image')!.from)); continue; }
    if (imageOperatorIds.has(item.operator) || ['values.number', 'values.boolean', 'values.color', 'values.choice'].includes(item.operator)) continue;
    if (item.bypassed) {
      const bypassPort = item.operator === 'analog.display-resolve' ? 'source' : 'signal';
      aliases.set(item.id, resolveId(incoming(item.id, bypassPort)!.from)); continue;
    }
    const kind = kindByOperator[item.operator];
    if (!kind) continue;
    const values = stageParams(item, definition, params);
    const primaryPort = kind === 'resolve' ? 'decoded' : kind === 'decode' ? 'signal' : definition.inputs[0]?.id;
    const stage: AnalogSignalStage = { nodeId: item.id, kind, params: values };
    if (primaryPort) stage.input = resolveId(incoming(item.id, primaryPort)!.from);
    if (kind === 'resolve') stage.source = resolveId(incoming(item.id, 'source')!.from);
    if (kind === 'decode') stage.receiver = resolveId(incoming(item.id, 'receiver')!.from);
    stages.push(stage);
  }
  const stageById = new Map(stages.map(stage => [stage.nodeId, stage]));
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
  let output = resolveId(outputNode.id);
  if (hasImageIsland) {
    const islandNodes = new Set<string>(), frameBoundaries = new Set<string>(), decodeBoundaries = new Map<string, Set<string>>();
    const collect = (id: string, outputPort?: string) => {
      if (islandNodes.has(id)) return;
      const item = nodes.get(id); if (!item) return;
      if (item.operator === 'image.frame') { frameBoundaries.add(id); return; }
      if (item.operator === 'analog.pal-decode') {
        const ports = decodeBoundaries.get(id) ?? new Set<string>(); if (outputPort) ports.add(outputPort); decodeBoundaries.set(id, ports); return;
      }
      islandNodes.add(id); for (const dependency of graph.edges.filter(edgeItem => edgeItem.to === id)) collect(dependency.from, dependency.output);
    };
    collect(outputProducer.id);
    if (frameBoundaries.size > 1 || decodeBoundaries.size > 1) throw new Error('Analog image island supports at most one frame and one decode boundary.');
    const frameId = [...frameBoundaries][0], decodeId = [...decodeBoundaries.keys()][0], decodePorts = decodeId ? decodeBoundaries.get(decodeId)! : new Set<string>();
    const decode = decodeId ? stages.find(stage => stage.nodeId === decodeId && stage.kind === 'decode') : undefined;
    if (decodeId && !decode) throw new Error('Analog image island decode boundary is not reachable.');
    const signalAmount = decode ? Math.max(0, Math.min(1, Math.max(Number(decode.params.palAmount ?? 0), Number(decode.params.rfAmount ?? 0),
      Number(decode.params.vhsAmount ?? 0), Number(decode.params.receiverAmount ?? 0)))) : 0;
    const usedIds = new Set(graph.nodes.map(item => item.id));
    const uniqueId = (base: string) => { let id = base, suffix = 1; while (usedIds.has(id)) id = `${base}-${suffix++}`; usedIds.add(id); return id; };
    const usedEdgeIds = new Set(graph.edges.map(item => item.id));
    const uniqueEdgeId = (base: string) => { let id = base, suffix = 1; while (usedEdgeIds.has(id)) id = `${base}-${suffix++}`; usedEdgeIds.add(id); return id; };
    const sourceNode: BoundOperatorNode = { id: uniqueId('__analog-source'), operator: 'image.named-input', operatorVersion: 1, bindings: { resource: 'source' } };
    const decodedNode: BoundOperatorNode = { id: uniqueId('__analog-decoded'), operator: 'image.named-input', operatorVersion: 1, bindings: { resource: 'decoded' } };
    const amountNode: BoundOperatorNode = { id: uniqueId('__analog-signal-amount'), operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: signalAmount } };
    const imageOutput: BoundOperatorNode = { id: uniqueId('__analog-output'), operator: 'image.output', operatorVersion: 1, bindings: {} };
    const replace = (id: string, port: string) => id === frameId ? { id: sourceNode.id, port: 'image' }
      : id === decodeId && port === 'image' ? { id: decodedNode.id, port: 'image' }
        : id === decodeId && port === 'signalAmount' ? { id: amountNode.id, port: 'value' } : { id, port };
    const imageEdges = graph.edges.filter(item => islandNodes.has(item.to)).map(item => {
      const from = replace(item.from, item.output);
      return { ...item, from: from.id, output: from.port };
    });
    imageEdges.push(edge(uniqueEdgeId('__analog-output-edge'), outputProducer.id, incoming(outputNode.id, 'image')!.output, imageOutput.id, 'image'));
    const boundaryNodes = [...(frameId ? [sourceNode] : []), ...(decodePorts.has('image') ? [decodedNode] : []), ...(decodePorts.has('signalAmount') ? [amountNode] : [])];
    const imageGraph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image',
      nodes: [...graph.nodes.filter(item => islandNodes.has(item.id)), ...boundaryNodes, imageOutput], edges: imageEdges, layout: {} };
    const defaults = Object.fromEntries(Object.entries(ANALOG_SIGNAL_LAB_PARAMS).map(([id, spec]) => [id, spec.default]));
    const imageParams = { ...defaults, ...params };
    const imageContext: ImageOperatorCompileContext = { parameterSchema: ANALOG_SIGNAL_LAB_PARAMS,
      namedImages: [{ id: 'source', sampling: 'manual-bilinear-clamp' }, { id: 'decoded', sampling: 'manual-bilinear-clamp' }] };
    const imageProgram = compileImageOperatorGraph(imageGraph, imageParams, imageContext);
    if (imageProgram.capabilities.includes('derivative')) throw new Error('Analog compute resolve does not support fragment derivatives.');
    const expectedResources = [...(frameId ? ['source'] : []), ...(decodePorts.has('image') ? ['decoded'] : [])];
    if (imageProgram.passes?.length || (imageProgram.resourceInputs?.length ?? 0) !== expectedResources.length
      || expectedResources.some(id => !imageProgram.resourceInputs?.includes(id))) {
      throw new Error('Analog image island compiled unexpected passes or resource inputs.');
    }
    stages.push({ nodeId: outputProducer.id, kind: 'resolve', ...(decodeId ? { input: decodeId } : {}), ...(frameId ? { source: frameId } : {}), params: {
      palAmount: decode?.params.palAmount ?? 0, rfAmount: decode?.params.rfAmount ?? 0, vhsAmount: decode?.params.vhsAmount ?? 0,
      receiverAmount: decode?.params.receiverAmount ?? 0, signalAmount,
    }, imageProgram, imagePreview: { graph: imageGraph, params: imageParams, context: imageContext } });
    output = outputProducer.id;
  }
  const stable = JSON.stringify({ stages, output });
  return { key: `analog-signal-v1-${hash(stable)}`, stages, output, passthrough: stages.length === 0 };
}

/** Reuses the normal Analog compiler by projecting an explicit preview target onto a temporary image output. */
export function compileAnalogSignalPreview(graph: EffectOperatorGraph, params: Record<string, unknown>, target: ImageOperatorPreviewTarget): AnalogSignalPreviewCompilation {
  const previewGraph: EffectOperatorGraph = { ...graph, nodes: graph.nodes.map(item => ({ ...item, bindings: { ...item.bindings },
    ...(item.constants ? { constants: { ...item.constants } } : {}) })), edges: graph.edges.map(item => ({ ...item })), layout: { ...graph.layout },
    ...(graph.groups ? { groups: graph.groups.map(group => ({ ...group, nodeIds: [...group.nodeIds] })) } : {}) };
  const targetNode = previewGraph.nodes.find(item => item.id === target.nodeId);
  if (!targetNode) throw new Error(`Analog preview target node ${target.nodeId} is missing.`);
  let from = targetNode.id, output = target.portId;
  let effectiveTarget = target;
  if (target.direction === 'input') {
    const linked = previewGraph.edges.find(item => item.to === target.nodeId && item.input === target.portId);
    if (!linked) throw new Error(`Analog preview target input ${target.nodeId}:${target.portId} is not connected.`);
    from = linked.from; output = linked.output;
    effectiveTarget = { nodeId: linked.from, direction: 'output', portId: linked.output };
  }
  const sourceNode = previewGraph.nodes.find(item => item.id === from)!;
  const sourcePort = getEffectOperator(sourceNode.operator)?.outputs.find(port => port.id === output);
  if (!sourcePort) throw new Error(`Analog preview target port ${from}:${output} is invalid.`);
  const used = new Set(previewGraph.nodes.map(item => item.id));
  const unique = (base: string) => { let id = base, suffix = 1; while (used.has(id)) id = `${base}-${suffix++}`; used.add(id); return id; };
  const append = (operator: string, constants?: Record<string, OperatorValue>) => {
    const id = unique(`__analog-preview-${operator.replaceAll('.', '-')}`);
    previewGraph.nodes.push({ id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants } : {}) }); previewGraph.layout[id] = { x: 0, y: 0 }; return id;
  };
  const connect = (source: string, sourcePortId: string, to: string, input: string) => previewGraph.edges.push({
    id: `__analog-preview-edge-${previewGraph.edges.length}`, from: source, output: sourcePortId, to, input,
  });
  let projectedType = sourcePort.type;
  if (projectedType === 'boolean') {
    const zero = append('values.number', { value: 0 }), one = append('values.number', { value: 1 }), select = append('select.scalar');
    connect(zero, 'value', select, 'falseValue'); connect(one, 'value', select, 'trueValue'); connect(from, output, select, 'condition');
    from = select; output = 'value'; projectedType = 'number';
  }
  if (projectedType === 'vec2' || projectedType === 'vec3') {
    const split = append(`vector.split.${projectedType}`), zero = append('values.number', { value: 0 });
    const one = append('values.number', { value: 1 }), combine = append('vector.combine.vec4');
    connect(from, output, split, 'value'); connect(split, 'x', combine, 'x'); connect(split, 'y', combine, 'y');
    connect(projectedType === 'vec3' ? split : zero, projectedType === 'vec3' ? 'z' : 'value', combine, 'z');
    connect(one, 'value', combine, 'w'); from = combine; output = 'value'; projectedType = 'vec4';
  }
  if (projectedType === 'rgb') {
    const alpha = append('values.number', { value: 1 }), combine = append('vector.combine.rgba');
    connect(from, output, combine, 'rgb'); connect(alpha, 'value', combine, 'alpha'); from = combine; output = 'image';
  } else if (projectedType === 'number' || projectedType === 'alpha') {
    const vector = append('convert.scalar-to-vec4'), image = append('convert.vec4-to-image');
    connect(from, output, vector, 'value'); connect(vector, 'value', image, 'value'); from = image; output = 'image';
  } else if (projectedType === 'vec4') {
    const image = append('convert.vec4-to-image'); connect(from, output, image, 'value'); from = image; output = 'image';
  } else if (projectedType !== 'image') throw new Error(`Analog preview target type ${projectedType} cannot be projected as an image.`);
  const imageOutput = previewGraph.nodes.find(item => item.operator === 'image.output');
  if (!imageOutput) throw new Error('Analog preview graph has no image output.');
  previewGraph.edges = previewGraph.edges.filter(item => item.to !== imageOutput.id);
  connect(from, output, imageOutput.id, 'image');
  const plan = compileAnalogSignalGraph(previewGraph, params);
  const stage = plan.stages.find(item => item.kind === 'resolve' && item.imagePreview?.graph.nodes.some(node => node.id === effectiveTarget.nodeId));
  if (!stage?.imagePreview) throw new Error('Analog preview target did not produce an image resolve stage.');
  const program = compileImageOperatorPreview(stage.imagePreview.graph, stage.imagePreview.params, effectiveTarget, stage.imagePreview.context);
  return { plan, stage, program };
}
