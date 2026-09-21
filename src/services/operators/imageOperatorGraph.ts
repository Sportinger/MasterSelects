import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import { getEffectOperator } from './operatorRegistry';
import { IMAGE_OPERATOR_PARAMETER_CAPACITY } from './imageOperatorParameters';
import { IMAGE_EFFECT_GRAPH_LIMITS, IMAGE_SCOPED_INSTRUCTION_LIMIT } from './effectGraphLimits';
import { colorToRgba } from '../../effects/_shared/catalogColor';
import { compileImageOperatorPassPlan } from './imageOperatorPlan';
import { emitImageOperatorWgsl } from './imageOperatorWgslEmitter';
import { migrateImageOperatorGraph } from './imageOperatorMigration';
import { compositionGroupInterface, expandOperatorCompositions } from './operatorComposition';
import { resolveImageOperatorChoice, type ImageOperatorCompileContext } from './imageOperatorChoice';
import { IMAGE_FRAME_HISTORY_RESOURCE_ID, type ImageOperatorResourceSampling } from './imageOperatorResources';
import { imageDegreesToRadians } from './imageAngleSemantics';
import { commonPureImageBranchValues, hasUpstreamImageDerivative } from './imageOperatorScopes';
import { lowerMarchingSquaresTopology } from './imageOperatorJointLowering';
import type { ImageOperatorExternalResource } from './imageOperatorExternalResources';
import type { ImageOperatorFieldResource } from './imageOperatorFieldResources';
import { createImageOperatorResourceLowering, validateImageOperatorResourceContext } from './imageOperatorResourceLowering';
import type { ImageOperatorCapability, ImageOperatorPlan, ImageOperatorSampleScope, ImagePlanInstruction, ImagePlanValue } from './imageOperatorPlanTypes';
export { createDefaultInvertImageGraph, migrateImageOperatorGraph } from './imageOperatorMigration';
export { createImageOperatorEvaluator, evaluateImageOperatorPlan } from './imageOperatorEvaluation';
export type { ImageOperatorCapability, ImageOperatorEvaluationContext, ImageOperatorPlan, ImageOperatorSampleScope, ImagePlanInstruction, ImagePlanValue } from './imageOperatorPlanTypes';
export interface ImageOperatorPreviewTarget { nodeId: string; direction: 'input' | 'output'; portId: string }
export type { ImageOperatorCompileContext } from './imageOperatorChoice';
export type { ImageOperatorExternalResource, ImageOperatorGlyphAtlasBindings, ResolveImageOperatorGlyphAtlas } from './imageOperatorGlyphResources';
export type { ImageOperatorMemoryWindowOptions, ImageOperatorMemoryWindowResource } from './imageOperatorExternalResources';

function compileImageOperatorTarget(graph: EffectOperatorGraph, params: Record<string, unknown>, preview?: ImageOperatorPreviewTarget,
  context: ImageOperatorCompileContext = {}): ImageOperatorPlan {
  graph = migrateImageOperatorGraph(graph);
  if (graph.domain !== 'image') throw new Error('Expected an image operator graph.');
  if (graph.schemaVersion !== 1) throw new Error(`Unsupported image graph schema version: ${String(graph.schemaVersion)}.`);
  if (graph.nodes.some(item => item.operatorVersion !== 1)) throw new Error('Unsupported image operator version.');
  for (const item of graph.nodes.filter(item => item.operator === 'values.number' || item.operator === 'values.integer')) {
    const binding = item.bindings.value;
    const resolved = typeof binding === 'string' ? params[binding] : item.constants?.value;
    if (resolved !== undefined && (typeof resolved !== 'number' || !Number.isFinite(resolved))) {
      throw new Error(`Image scalar ${item.id} must be finite.`);
    }
  }
  for (const item of graph.nodes.filter(item => item.operator === 'values.boolean')) {
    const binding = item.bindings.value;
    const resolved = typeof binding === 'string' ? params[binding] : item.constants?.value;
    if (resolved !== undefined && typeof resolved !== 'boolean') throw new Error(`Image Boolean ${item.id} must be Boolean.`);
  }
  for (const item of graph.nodes.filter(item => item.operator === 'values.choice')) resolveImageOperatorChoice(item.bindings.value, params, context);
  const namedImages = validateImageOperatorResourceContext(graph, context);
  const nodes = new Map(graph.nodes.map(item => [item.id, item]));
  if (nodes.size !== graph.nodes.length) throw new Error('Image graph contains duplicate node ids.');
  const outputs = graph.nodes.filter(item => item.operator === 'image.output');
  if (outputs.length !== 1) throw new Error('Image graph must contain exactly one image.output.');
  const incoming = new Map<string, typeof graph.edges>();
  for (const item of graph.edges) {
    const from = nodes.get(item.from), to = nodes.get(item.to);
    if (!from || !to) throw new Error(`Image edge ${item.id} references a missing node.`);
    const fromPort = getEffectOperator(from.operator)?.outputs.find(port => port.id === item.output);
    const toPort = getEffectOperator(to.operator)?.inputs.find(port => port.id === item.input);
    if (!fromPort || !toPort || fromPort.type !== toPort.type) throw new Error(`Image edge ${item.id} has incompatible ports.`);
    const key = `${item.to}:${item.input}`;
    if (incoming.has(key)) throw new Error(`Image input ${key} is connected more than once.`);
    incoming.set(key, [item]);
  }
  const downstream = new Map<string, string[]>();
  for (const item of graph.edges) downstream.set(item.from, [...(downstream.get(item.from) ?? []), item.to]);
  const checked = new Set<string>(), checking = new Set<string>();
  const assertAcyclic = (id: string) => {
    if (checking.has(id)) throw new Error('Image graph contains a cycle.');
    if (checked.has(id)) return;
    checking.add(id); for (const next of downstream.get(id) ?? []) assertAcyclic(next);
    checking.delete(id); checked.add(id);
  };
  for (const id of nodes.keys()) assertAcyclic(id);
  const instructions: ImagePlanInstruction[] = [], registers = new Map<string, number>(), visiting = new Set<string>();
  const parameterSlots = new Map<string, number>(), parameterValues: number[] = [];
  const resourceInputs: string[] = [], resourceSampling: ImageOperatorResourceSampling[] = [];
  const externalResources: ImageOperatorExternalResource[] = [];
  const fieldResources: ImageOperatorFieldResource[] = [];
  const sampleScopes: ImageOperatorSampleScope[] = [];
  const kernelScopes: Array<{ id: number; sample: number; weight: number }> = [];
  const rectScopes: Array<{ id: number; sample: number; weight: number }> = [];
  const sequenceScopes: Array<{ id: number; sample: number; weight: number }> = [];
  const segmentSortScopes: Array<{ id: number; sample: number }> = [];
  const quadtreeScopes: Array<{ id: number; sample: number }> = [];
  const scopeBySource = new Map<string, number>(), scopeParents = new Map<number, number>(), capturable = new Set<string>(); let nextScopeId = 1;
  let activeScope = 0, activeKernelScope: number | undefined, activeSequenceScope: number | undefined, activePixelLoad = false, activeSegmentSort = false, activeQuadtree = false;
  const reducerContext = (): ImageOperatorSampleScope['reducerContext'] => activeKernelScope !== undefined
    ? { kind: 'kernel', id: activeKernelScope }
    : activeSequenceScope !== undefined ? { kind: 'sequence', id: activeSequenceScope } : undefined;
  const reducerContextKey = (capture = reducerContext()) => capture ? `${capture.kind}:${capture.id}` : 'root';
  const emit = (instruction: ImagePlanInstruction) => {
    if (instructions.length >= IMAGE_SCOPED_INSTRUCTION_LIMIT) {
      throw new Error(`Image graph scoped expansion exceeds ${IMAGE_SCOPED_INSTRUCTION_LIMIT} instructions.`);
    }
    return instructions.push({ ...instruction, scope: activeScope }) - 1;
  };
  function source(target: BoundOperatorNode, input: string) {
    const item = incoming.get(`${target.id}:${input}`)?.[0];
    if (!item) throw new Error(`Image input ${target.id}:${input} is not connected.`);
    return { node: nodes.get(item.from)!, output: item.output };
  }
  function visitSource(target: BoundOperatorNode, input: string) {
    const linked = source(target, input);
    return visit(linked.node, linked.output);
  }
  const lowerResource = createImageOperatorResourceLowering({ context, params, namedImages, parameterSlots, parameterValues,
    state: { resourceInputs, resourceSampling, externalResources, fieldResources }, emit, source, visitSource, activePixelLoad: () => activePixelLoad });
  function visit(current: BoundOperatorNode, output: string): number {
    const cacheKey = `${activeScope}:${current.id}:${output}`;
    const cached = registers.get(cacheKey); if (cached !== undefined) return cached;
    for (let scope = scopeParents.get(activeScope); scope !== undefined; scope = scopeParents.get(scope)) {
      const parentKey = `${scope}:${current.id}:${output}`;
      if (capturable.has(parentKey)) return registers.get(parentKey)!;
    }
    const visitKey = `${activeScope}:${current.id}`;
    if (visiting.has(visitKey)) throw new Error('Image graph contains a cycle.');
    visiting.add(visitKey);
    let register: number;
    const resourceRegister = lowerResource(current, output);
    if (resourceRegister !== undefined) { visiting.delete(visitKey); registers.set(cacheKey, resourceRegister); return resourceRegister; }
    switch (current.operator) {
      case 'image.frame': register = emit({ nodeId: current.id, operation: 'input', type: 'image', inputs: [] }); break;
      case 'image.normalized-uv': register = emit({ nodeId: current.id, operation: 'uv', type: 'vec2', inputs: [] }); break;
      case 'image.resolution': register = emit({ nodeId: current.id, operation: 'resolution', type: 'vec2', inputs: [] }); break;
      case 'image.timeline-time': register = emit({ nodeId: current.id, operation: 'time', type: 'scalar', inputs: [] }); break;
      case 'image.derivative.auto.scalar': case 'image.derivative.fine.scalar': case 'image.derivative.coarse.scalar': {
        if (activeScope !== 0 || activeKernelScope !== undefined || activeSequenceScope !== undefined) {
          throw new Error('Image derivatives are only available in the root evaluation scope.');
        }
        const linked = source(current, 'value');
        if (hasUpstreamImageDerivative(linked.node, graph.edges, nodes)) throw new Error('Higher-order image derivatives are not supported.');
        const mode = current.operator.split('.')[2] as 'auto' | 'fine' | 'coarse';
        register = emit({ nodeId: current.id, operation: `derivative-${mode}`, type: 'vec2', inputs: [visit(linked.node, linked.output)] });
        break;
      }
      case 'image.kernel-index': {
        if (activeKernelScope === undefined) throw new Error('image.kernel-index is only available inside a kernel reduction scope.');
        register = emit({ nodeId: current.id, operation: 'kernel-index', type: 'vec2', inputs: [] }); break;
      }
      case 'image.sequence-index': {
        if (activeSequenceScope === undefined) throw new Error('image.sequence-index is only available inside a sequence reduction scope.');
        register = emit({ nodeId: current.id, operation: output === 't' ? 'sequence-t' : 'sequence-index', type: 'scalar', inputs: [] }); break;
      }
      case 'image.sample': {
        const linked = source(current, 'image'), parentScope = activeScope;
        if (current.bypassed) { register = visit(linked.node, linked.output); break; }
        const uv = visitSource(current, 'uv');
        const capture = reducerContext();
        const sourceKey = `${reducerContextKey(capture)}:${linked.node.id}:${linked.output}`;
        let scope = scopeBySource.get(sourceKey);
        if (scope === undefined) {
          scope = nextScopeId++; scopeBySource.set(sourceKey, scope);
          const previousPixelLoad = activePixelLoad;
          activeScope = scope; activePixelLoad = false;
          const scopedOutput = visit(linked.node, linked.output);
          activeScope = parentScope; activePixelLoad = previousPixelLoad;
          sampleScopes.push({ id: scope, output: scopedOutput, ...(capture ? { reducerContext: capture } : {}) });
        }
        register = emit({ nodeId: current.id, operation: 'sample-image', type: 'image', inputs: [uv], value: scope });
        break;
      }
      case 'image.load-pixel-clamped': {
        const linked = source(current, 'image'), parentScope = activeScope;
        if (current.bypassed) { register = visit(linked.node, linked.output); break; }
        const pixel = visitSource(current, 'pixel'), capture = reducerContext();
        const sourceKey = `pixel:${reducerContextKey(capture)}:${linked.node.id}:${linked.output}`;
        let scope = scopeBySource.get(sourceKey);
        if (scope === undefined) {
          scope = nextScopeId++; scopeBySource.set(sourceKey, scope);
          const previousPixelLoad = activePixelLoad;
          activeScope = scope; activePixelLoad = true;
          const scopedOutput = visit(linked.node, linked.output);
          activeScope = parentScope; activePixelLoad = previousPixelLoad;
          sampleScopes.push({ id: scope, output: scopedOutput, coordinate: 'pixel', ...(capture ? { reducerContext: capture } : {}) });
        }
        register = emit({ nodeId: current.id, operation: 'load-image', type: 'image', inputs: [pixel], value: scope });
        break;
      }
      case 'image.segment-sort-luma': {
        const linked = source(current, 'image');
        if (current.bypassed) { register = visit(linked.node, linked.output); break; }
        if (activeScope !== 0 || activeKernelScope !== undefined || activeSequenceScope !== undefined || activeSegmentSort || activeQuadtree) {
          throw new Error('Image segment sort is only available in the root scope and cannot be nested in another scoped operation.');
        }
        const scale = visitSource(current, 'scale'), parentScope = activeScope, scope = nextScopeId++;
        activeScope = scope; activePixelLoad = true; activeSegmentSort = true;
        const sample = visit(linked.node, linked.output);
        activeScope = parentScope; activePixelLoad = false; activeSegmentSort = false;
        sampleScopes.push({ id: scope, output: sample, coordinate: 'pixel' });
        segmentSortScopes.push({ id: scope, sample });
        register = emit({ nodeId: current.id, operation: 'segment-sort-luma', type: 'image', inputs: [scale], value: scope });
        break;
      }
      case 'image.quadtree-partition': {
        if (activeScope !== 0 || activeKernelScope !== undefined || activeSequenceScope !== undefined || activeSegmentSort || activeQuadtree) {
          throw new Error('Image quadtree partition is only available in the root scope and cannot be nested in another scoped operation.');
        }
        const existing = registers.get(`${activeScope}:${current.id}:partition`);
        if (existing !== undefined) {
          register = output === 'origin' ? registers.get(`${activeScope}:${current.id}:origin`)! : registers.get(`${activeScope}:${current.id}:size`)!;
          break;
        }
        const scale = visitSource(current, 'scale'), threshold = visitSource(current, 'threshold');
        const time = visitSource(current, 'time'), speed = visitSource(current, 'speed');
        const linked = source(current, 'image'), parentScope = activeScope, scope = nextScopeId++;
        activeScope = scope; activePixelLoad = true; activeQuadtree = true;
        const sample = visit(linked.node, linked.output);
        activeScope = parentScope; activePixelLoad = false; activeQuadtree = false;
        sampleScopes.push({ id: scope, output: sample, coordinate: 'pixel' }); quadtreeScopes.push({ id: scope, sample });
        const partition = emit({ nodeId: current.id, operation: 'quadtree-partition', type: 'vec3', inputs: [scale, threshold, time, speed], value: scope });
        const origin = emit({ nodeId: current.id, operation: 'quadtree-origin', type: 'vec2', inputs: [partition] });
        const size = emit({ nodeId: current.id, operation: 'quadtree-size', type: 'scalar', inputs: [partition] });
        registers.set(`${parentScope}:${current.id}:partition`, partition); registers.set(`${parentScope}:${current.id}:origin`, origin);
        registers.set(`${parentScope}:${current.id}:size`, size); register = output === 'origin' ? origin : size;
        break;
      }
      case 'geometry.marching-squares-topology':
        register = lowerMarchingSquaresTopology({ node: current, output, scope: activeScope, registers,
          visitInput: id => visitSource(current, id), emit }); break;
      case 'image.kernel-grid-reduce': {
        if (activeSegmentSort || activeQuadtree || activeKernelScope !== undefined || activeSequenceScope !== undefined) throw new Error('Nested image neighborhood reductions are not supported.');
        const existingSum = registers.get(`${activeScope}:${current.id}:sum`);
        if (existingSum !== undefined) { register = output === 'sum' ? existingSum : registers.get(`${activeScope}:${current.id}:weightSum`)!; break; }
        const parentScope = activeScope, extent = visitSource(current, 'extent'), scope = nextScopeId++;
        activeScope = scope; activeKernelScope = scope;
        const sample = visitSource(current, 'sample'), weight = visitSource(current, 'weight');
        activeScope = parentScope; activeKernelScope = undefined;
        kernelScopes.push({ id: scope, sample, weight });
        const sum = emit({ nodeId: current.id, operation: 'kernel-sum', type: 'vec4', inputs: [extent], value: scope });
        const weightSum = emit({ nodeId: current.id, operation: 'kernel-weight-sum', type: 'scalar', inputs: [sum], value: scope });
        registers.set(`${parentScope}:${current.id}:sum`, sum); registers.set(`${parentScope}:${current.id}:weightSum`, weightSum);
        register = output === 'sum' ? sum : weightSum; break;
      }
      case 'image.kernel-rect-reduce': {
        if (activeSegmentSort || activeQuadtree || activeKernelScope !== undefined || activeSequenceScope !== undefined) throw new Error('Nested image neighborhood reductions are not supported.');
        const existing = registers.get(`${activeScope}:${current.id}:sum`);
        if (existing !== undefined) { register = output === 'sum' ? existing : registers.get(`${activeScope}:${current.id}:weightSum`)!; break; }
        const parentScope = activeScope, width = visitSource(current, 'width'), height = visitSource(current, 'height'), scope = nextScopeId++;
        activeScope = scope; activeKernelScope = scope; const sample = visitSource(current, 'sample'), weight = visitSource(current, 'weight'); activeScope = parentScope; activeKernelScope = undefined; rectScopes.push({ id: scope, sample, weight });
        const sum = emit({ nodeId: current.id, operation: 'rect-sum', type: 'vec4', inputs: [width, height], value: scope });
        const weightSum = emit({ nodeId: current.id, operation: 'rect-weight-sum', type: 'scalar', inputs: [sum], value: scope });
        registers.set(`${parentScope}:${current.id}:sum`, sum); registers.set(`${parentScope}:${current.id}:weightSum`, weightSum); register = output === 'sum' ? sum : weightSum; break;
      }
      case 'image.sequence-reduce': {
        if (activeSegmentSort || activeQuadtree || activeKernelScope !== undefined || activeSequenceScope !== undefined) throw new Error('Nested image neighborhood reductions are not supported.');
        const existing = registers.get(`${activeScope}:${current.id}:sum`);
        if (existing !== undefined) { register = output === 'sum' ? existing : registers.get(`${activeScope}:${current.id}:weightSum`)!; break; }
        const parentScope = activeScope, count = visitSource(current, 'count'), scope = nextScopeId++;
        activeScope = scope; activeSequenceScope = scope;
        const sample = visitSource(current, 'sample'), weight = visitSource(current, 'weight');
        activeScope = parentScope; activeSequenceScope = undefined; sequenceScopes.push({ id: scope, sample, weight });
        const sum = emit({ nodeId: current.id, operation: 'sequence-sum', type: 'vec4', inputs: [count], value: scope });
        const weightSum = emit({ nodeId: current.id, operation: 'sequence-weight-sum', type: 'scalar', inputs: [sum], value: scope });
        registers.set(`${parentScope}:${current.id}:sum`, sum); registers.set(`${parentScope}:${current.id}:weightSum`, weightSum);
        register = output === 'sum' ? sum : weightSum; break;
      }
      case 'control.select.image': case 'control.select.scalar': {
        const scalar = current.operator === 'control.select.scalar';
        const condition = visitSource(current, 'condition'), parentScope = activeScope;
        const branchValues = [source(current, 'falseValue'), source(current, 'trueValue')];
        for (const shared of commonPureImageBranchValues(branchValues, nodes, incoming)) {
          const key = `${parentScope}:${shared.node.id}:${shared.output}`, sharedRegister = visit(shared.node, shared.output);
          if (!registers.has(key)) registers.set(key, sharedRegister);
          capturable.add(key);
        }
        const branch = (input: 'falseValue' | 'trueValue') => {
          const linked = source(current, input), scope = nextScopeId++, capture = reducerContext();
          scopeParents.set(scope, parentScope);
          activeScope = scope; const branchOutput = visit(linked.node, linked.output); activeScope = parentScope;
          sampleScopes.push({ id: scope, output: branchOutput, ...(scalar ? { type: 'scalar' as const } : {}),
            ...(capture ? { reducerContext: capture } : {}) }); return scope;
        };
        const falseScope = branch('falseValue'), trueScope = branch('trueValue');
        register = emit({ nodeId: current.id, operation: scalar ? 'select-lazy-scalar' : 'select-image', type: scalar ? 'scalar' : 'image',
          inputs: [condition, falseScope, trueScope] }); break;
      }
      case 'values.integer':
      case 'values.number': {
        const binding = current.bindings.value;
        const raw = typeof binding === 'string' ? params[binding] : undefined;
        const literal = current.constants?.value;
        const value = typeof raw === 'number' ? raw : typeof literal === 'number' ? literal : 1;
        if (!Number.isFinite(value)) throw new Error(`Image scalar ${current.id} must be finite.`);
        if (typeof binding === 'string') {
          const slotKey = `number:${binding}`;
          let slot = parameterSlots.get(slotKey);
          if (slot === undefined) {
            slot = parameterValues.length;
            if (slot >= IMAGE_OPERATOR_PARAMETER_CAPACITY) throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
            parameterSlots.set(slotKey, slot); parameterValues.push(value);
          }
          register = emit({ nodeId: current.id, operation: 'parameter', type: 'scalar', inputs: [], value: slot });
        } else register = emit({ nodeId: current.id, operation: 'constant', type: 'scalar', inputs: [], value });
        if (current.operator === 'values.integer') register = emit({ nodeId: current.id, operation: 'trunc-scalar', type: 'scalar', inputs: [register] });
        break;
      }
      case 'values.choice': {
        const binding = current.bindings.value;
        const value = resolveImageOperatorChoice(binding, params, context);
        const slotKey = `choice:${String(binding)}`;
        let slot = parameterSlots.get(slotKey);
        if (slot === undefined) {
          slot = parameterValues.length;
          if (slot >= IMAGE_OPERATOR_PARAMETER_CAPACITY) throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
          parameterSlots.set(slotKey, slot); parameterValues.push(value);
        }
        register = emit({ nodeId: current.id, operation: 'parameter', type: 'scalar', inputs: [], value: slot });
        break;
      }
      case 'values.boolean': {
        const binding = current.bindings.value;
        const raw = typeof binding === 'string' ? params[binding] : current.constants?.value;
        const value = typeof raw === 'boolean' ? raw : false;
        if (typeof binding !== 'string') {
          register = emit({ nodeId: current.id, operation: 'constant', type: 'boolean', inputs: [], value: value ? 1 : 0 }); break;
        }
        const slotKey = `boolean:${String(binding)}`;
        let slot = typeof binding === 'string' ? parameterSlots.get(slotKey) : undefined;
        if (slot === undefined) {
          slot = parameterValues.length;
          if (slot >= IMAGE_OPERATOR_PARAMETER_CAPACITY) throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
          if (typeof binding === 'string') parameterSlots.set(slotKey, slot);
          parameterValues.push(value ? 1 : 0);
        }
        register = emit({ nodeId: current.id, operation: 'parameter-boolean', type: 'boolean', inputs: [], value: slot }); break;
      }
      case 'values.color': {
        const binding = current.bindings.value;
        const raw = typeof binding === 'string' ? params[binding] : current.constants?.value;
        const declaredDefault = getEffectOperator('values.color')?.parameters.find(item => item.id === 'value')?.default;
        const fallback = typeof declaredDefault === 'string' ? declaredDefault : '#111827';
        const color = Array.isArray(raw) && raw.length === 4 && raw.every(value => typeof value === 'number' && Number.isFinite(value))
          ? raw as [number, number, number, number] : colorToRgba(typeof raw === 'string' ? raw : undefined, fallback);
        if (typeof binding !== 'string') { register = emit({ nodeId: current.id, operation: 'constant-color', type: 'vec4', inputs: [], color }); break; }
        const slotKey = `color:${binding}`;
        let slot = parameterSlots.get(slotKey);
        if (slot === undefined) {
          slot = parameterValues.length;
          if (slot + 4 > IMAGE_OPERATOR_PARAMETER_CAPACITY) throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
          parameterSlots.set(slotKey, slot); parameterValues.push(...color);
        }
        register = emit({ nodeId: current.id, operation: 'parameter-color', type: 'vec4', inputs: [], value: slot }); break;
      }
      case 'math.subtract.scalar': {
        const b = visitSource(current, 'b');
        register = current.bypassed ? b : emit({ nodeId: current.id, operation: 'subtract', type: 'scalar', inputs: [visitSource(current, 'a'), b] });
        break;
      }
      case 'math.add.scalar': case 'math.multiply.scalar': case 'math.divide-ieee.scalar': {
        const a = visitSource(current, 'a');
        const operation = current.operator === 'math.add.scalar' ? 'add-scalar'
          : current.operator === 'math.multiply.scalar' ? 'multiply-scalar' : 'divide-ieee-scalar';
        register = current.bypassed ? a : emit({ nodeId: current.id, operation, type: 'scalar', inputs: [a, visitSource(current, 'b')] });
        break;
      }
      case 'math.reciprocal.scalar': case 'math.exp2.scalar': case 'math.fract.scalar': {
        const value = visitSource(current, 'value');
        const operation = current.operator === 'math.reciprocal.scalar' ? 'reciprocal-scalar'
          : current.operator === 'math.exp2.scalar' ? 'exp2-scalar' : 'fract-scalar';
        register = current.bypassed ? value : emit({ nodeId: current.id, operation, type: 'scalar', inputs: [value] });
        break;
      }
      case 'math.floor.scalar': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'floor-scalar', type: 'scalar', inputs: [value] });
        break;
      }
      case 'math.round-even.scalar': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'round-even-scalar', type: 'scalar', inputs: [value] });
        break;
      }
      case 'math.step.scalar': register = emit({ nodeId: current.id, operation: 'step-scalar', type: 'scalar',
        inputs: [visitSource(current, 'edge'), visitSource(current, 'value')] }); break;
      case 'math.max.scalar': {
        const a = visitSource(current, 'a');
        register = current.bypassed ? a : emit({ nodeId: current.id, operation: 'max-scalar', type: 'scalar', inputs: [a, visitSource(current, 'b')] });
        break;
      }
      case 'math.min.scalar': case 'math.power.scalar': {
        const a = visitSource(current, 'a'), operation = current.operator === 'math.min.scalar' ? 'min-scalar' : 'power-scalar';
        register = current.bypassed ? a : emit({ nodeId: current.id, operation, type: 'scalar', inputs: [a, visitSource(current, 'b')] }); break;
      }
      case 'math.atan2.scalar': register = emit({ nodeId: current.id, operation: 'atan2-scalar', type: 'scalar', inputs: [visitSource(current, 'y'), visitSource(current, 'x')] }); break;
      case 'math.tan.scalar': case 'math.atan.scalar': case 'math.abs.scalar': {
        const value = visitSource(current, 'value');
        const operation = current.operator === 'math.tan.scalar' ? 'tan-scalar' : current.operator === 'math.atan.scalar' ? 'atan-scalar' : 'abs-scalar';
        register = current.bypassed ? value : emit({ nodeId: current.id, operation, type: 'scalar', inputs: [value] }); break;
      }
      case 'convert.degrees-to-radians.scalar': {
        const linked = source(current, 'value');
        if (current.bypassed) { register = visit(linked.node, linked.output); break; }
        if (linked.node.operator !== 'values.number') {
          register = emit({ nodeId: current.id, operation: 'degrees-to-radians', type: 'scalar', inputs: [visit(linked.node, linked.output)] }); break;
        }
        const binding = linked.node.bindings.value;
        const raw = typeof binding === 'string' ? params[binding] : undefined;
        const literal = linked.node.constants?.value;
        const degrees = typeof raw === 'number' ? raw : typeof literal === 'number' ? literal : 1;
        const radians = imageDegreesToRadians(degrees);
        if (!Number.isFinite(radians)) throw new Error(`Image angle ${current.id} must convert to a finite value.`);
        if (typeof binding !== 'string') {
          register = emit({ nodeId: current.id, operation: 'constant', type: 'scalar', inputs: [], value: radians }); break;
        }
        const slotKey = `degrees-radians:${binding}`;
        let slot = parameterSlots.get(slotKey);
        if (slot === undefined) {
          slot = parameterValues.length;
          if (slot >= IMAGE_OPERATOR_PARAMETER_CAPACITY) throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
          parameterSlots.set(slotKey, slot); parameterValues.push(radians);
        }
        register = emit({ nodeId: current.id, operation: 'parameter', type: 'scalar', inputs: [], value: slot }); break;
      }
      case 'coordinates.rotate.vec2': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'rotate-vec2', type: 'vec2', inputs: [value, visitSource(current, 'angle')] });
        break; }
      case 'coordinates.integer-cell-origin.vec2': register = emit({ nodeId: current.id, operation: 'integer-cell-origin', type: 'vec2', inputs: [visitSource(current, 'pixel'), visitSource(current, 'size')] }); break;
      case 'vector.normalize.vec2': { const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'normalize-vec2', type: 'vec2', inputs: [value] }); break; }
      case 'pattern.bayer4.vec2': register = emit({ nodeId: current.id, operation: 'bayer4-vec2', type: 'scalar', inputs: [visitSource(current, 'value')] }); break;
      case 'optics.project-radius.scalar': register = emit({ nodeId: current.id, operation: 'project-radius', type: 'scalar', inputs: [visitSource(current, 'theta'), visitSource(current, 'maxTheta'), visitSource(current, 'model')] }); break;
      case 'optics.unproject-radius.scalar': register = emit({ nodeId: current.id, operation: 'unproject-radius', type: 'scalar', inputs: [visitSource(current, 'radius'), visitSource(current, 'maxTheta'), visitSource(current, 'model')] }); break;
      case 'math.clamp.scalar': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'clamp-scalar', type: 'scalar',
          inputs: [value, visitSource(current, 'min'), visitSource(current, 'max')] });
        break;
      }
      case 'math.sqrt.scalar': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'sqrt-scalar', type: 'scalar', inputs: [value] });
        break;
      }
      case 'math.gaussian.scalar': register = emit({ nodeId: current.id, operation: 'gaussian-scalar', type: 'scalar',
        inputs: [visitSource(current, 'value'), visitSource(current, 'sigma')] }); break;
      case 'math.smoothstep.scalar': register = emit({ nodeId: current.id, operation: 'smoothstep-scalar', type: 'scalar',
        inputs: [visitSource(current, 'edge0'), visitSource(current, 'edge1'), visitSource(current, 'value')] }); break;
      case 'math.mix.scalar': {
        const a = visitSource(current, 'a');
        register = current.bypassed ? a : emit({ nodeId: current.id, operation: 'mix-scalar', type: 'scalar',
          inputs: [a, visitSource(current, 'b'), visitSource(current, 't')] });
        break;
      }
      case 'math.add.vec2': case 'math.subtract.vec2': case 'math.multiply.vec2': case 'math.divide-ieee.vec2': {
        const a = visitSource(current, 'a');
        register = current.bypassed ? a : emit({ nodeId: current.id,
          operation: current.operator === 'math.add.vec2' ? 'add-vec2' : current.operator === 'math.subtract.vec2' ? 'subtract-vec2'
            : current.operator === 'math.multiply.vec2' ? 'multiply-vec2' : 'divide-vec2', type: 'vec2',
          inputs: [a, visitSource(current, 'b')] });
        break;
      }
      case 'vector.dot.vec2': register = emit({ nodeId: current.id, operation: 'dot-vec2', type: 'scalar',
        inputs: [visitSource(current, 'a'), visitSource(current, 'b')] }); break;
      case 'vector.length.vec2': register = emit({ nodeId: current.id, operation: 'length-vec2', type: 'scalar',
        inputs: [visitSource(current, 'value')] }); break;
      case 'vector.unit-direction.scalar': register = emit({ nodeId: current.id, operation: 'unit-direction', type: 'vec2', inputs: [visitSource(current, 'angle')] }); break;
      case 'math.floor.vec2': {
        const value = visitSource(current, 'value'); register = current.bypassed ? value
          : emit({ nodeId: current.id, operation: 'floor-vec2', type: 'vec2', inputs: [value] }); break;
      }
      case 'math.fract.vec2': {
        const value = visitSource(current, 'value'); register = current.bypassed ? value
          : emit({ nodeId: current.id, operation: 'fract-vec2', type: 'vec2', inputs: [value] }); break;
      }
      case 'coordinates.mirror-repeat.vec2': {
        const value = visitSource(current, 'value'); register = current.bypassed ? value
          : emit({ nodeId: current.id, operation: 'mirror-repeat-vec2', type: 'vec2', inputs: [value] }); break;
      }
      case 'math.clamp.vec2': {
        const value = visitSource(current, 'value'); register = current.bypassed ? value
          : emit({ nodeId: current.id, operation: 'clamp-vec2', type: 'vec2', inputs: [value, visitSource(current, 'min'), visitSource(current, 'max')] }); break;
      }
      case 'vector.reduce-min.vec2': register = emit({ nodeId: current.id, operation: 'reduce-min-vec2', type: 'scalar',
        inputs: [visitSource(current, 'value')] }); break;
      case 'noise.hash2d.vec2': register = emit({ nodeId: current.id, operation: 'hash2d-vec2', type: 'scalar',
        inputs: [visitSource(current, 'value')] }); break;
      case 'math.sin.scalar': case 'math.cos.scalar': case 'math.exp.scalar': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id,
          operation: current.operator === 'math.sin.scalar' ? 'sin-scalar' : current.operator === 'math.cos.scalar' ? 'cos-scalar' : 'exp-scalar', type: 'scalar', inputs: [value] });
        break;
      }
      case 'convert.scalar-to-vec2': register = emit({ nodeId: current.id, operation: 'scalar-to-vec2', type: 'vec2',
        inputs: [visitSource(current, 'value')] }); break;
      case 'convert.scalar-to-vec4': register = emit({ nodeId: current.id, operation: 'scalar-to-vec4', type: 'vec4', inputs: [visitSource(current, 'value')] }); break;
      case 'math.divide-ieee.vec4': {
        const a = visitSource(current, 'a'); register = current.bypassed ? a : emit({ nodeId: current.id, operation: 'divide-vec4', type: 'vec4', inputs: [a, visitSource(current, 'b')] }); break;
      }
      case 'math.multiply.vec4': {
        const a = visitSource(current, 'a'); register = current.bypassed ? a : emit({ nodeId: current.id, operation: 'multiply-vec4', type: 'vec4', inputs: [a, visitSource(current, 'b')] }); break;
      }
      case 'math.multiply.image-scalar': case 'math.multiply.rgb-scalar': case 'math.multiply.vec2-scalar': {
        const a = visitSource(current, 'a'), type = current.operator.includes('.image-') ? 'image' : current.operator.includes('.rgb-') ? 'rgb' : 'vec2';
        register = current.bypassed ? a : emit({ nodeId: current.id, operation: 'multiply-vector-scalar', type, inputs: [a, visitSource(current, 'b')] }); break;
      }
      case 'math.divide-ieee.rgb-scalar': case 'math.divide-ieee.vec2-scalar': {
        const a = visitSource(current, 'a'); register = current.bypassed ? a : emit({ nodeId: current.id,
          operation: 'divide-vector-scalar', type: current.operator === 'math.divide-ieee.rgb-scalar' ? 'rgb' : 'vec2',
          inputs: [a, visitSource(current, 'b')] }); break;
      }
      case 'math.clamp.rgb-scalar': { const value = visitSource(current, 'value'); register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'clamp-rgb-scalar', type: 'rgb', inputs: [value, visitSource(current, 'min'), visitSource(current, 'max')] }); break; }
      case 'convert.vec4-to-rgb': register = emit({ nodeId: current.id, operation: 'vec4-to-rgb', type: 'rgb', inputs: [visitSource(current, 'value')] }); break;
      case 'compare.greater.scalar': register = emit({ nodeId: current.id, operation: 'greater-scalar', type: 'boolean',
        inputs: [visitSource(current, 'a'), visitSource(current, 'b')] }); break;
      case 'logic.and.boolean': register = emit({ nodeId: current.id, operation: 'and-boolean', type: 'boolean',
        inputs: [visitSource(current, 'a'), visitSource(current, 'b')] }); break;
      case 'select.scalar': register = emit({ nodeId: current.id, operation: 'select-scalar', type: 'scalar',
        inputs: [visitSource(current, 'falseValue'), visitSource(current, 'trueValue'), visitSource(current, 'condition')] }); break;
      case 'select.vec2': register = emit({ nodeId: current.id, operation: 'select-vec2', type: 'vec2',
        inputs: [visitSource(current, 'falseValue'), visitSource(current, 'trueValue'), visitSource(current, 'condition')] }); break;
      case 'convert.image-to-vec4': register = emit({ nodeId: current.id, operation: 'image-to-vec4', type: 'vec4', inputs: [visitSource(current, 'image')] }); break;
      case 'convert.vec4-to-image': register = emit({ nodeId: current.id, operation: 'vec4-to-image', type: 'image', inputs: [visitSource(current, 'value')] }); break;
      case 'vector.split.vec2': case 'vector.split.vec3': case 'vector.split.vec4': {
        const component = ['x', 'y', 'z', 'w'].indexOf(output);
        if (component < 0) throw new Error(`Unsupported vector component: ${output}`);
        register = emit({ nodeId: current.id, operation: 'split-component', type: 'scalar', inputs: [visitSource(current, 'value')], value: component }); break;
      }
      case 'vector.combine.vec2': case 'vector.combine.vec3': case 'vector.combine.vec4': {
        const size = Number(current.operator.at(-1));
        register = emit({ nodeId: current.id, operation: 'combine-vector', type: `vec${size}` as ImagePlanValue,
          inputs: ['x', 'y', 'z', 'w'].slice(0, size).map(id => visitSource(current, id)) }); break;
      }
      case 'vector.split.rgba': register = emit({ nodeId: current.id, operation: output === 'alpha' ? 'split-alpha' : 'split-rgb', type: output === 'alpha' ? 'alpha' : 'rgb', inputs: [visitSource(current, 'image')] }); break;
      case 'convert.scalar-to-rgb': register = emit({ nodeId: current.id, operation: 'scalar-to-rgb', type: 'rgb', inputs: [visitSource(current, 'value')] }); break;
      case 'math.subtract.rgb': {
        const b = visitSource(current, 'b');
        register = current.bypassed ? b : emit({ nodeId: current.id, operation: 'subtract-rgb', type: 'rgb', inputs: [visitSource(current, 'a'), b] });
        break;
      }
      case 'math.add.rgb': {
        const a = visitSource(current, 'a');
        register = current.bypassed ? a : emit({ nodeId: current.id, operation: 'add-rgb', type: 'rgb', inputs: [a, visitSource(current, 'b')] });
        break;
      }
      case 'math.multiply.rgb': {
        const a = visitSource(current, 'a');
        register = current.bypassed ? a : emit({ nodeId: current.id, operation: 'multiply-rgb', type: 'rgb', inputs: [a, visitSource(current, 'b')] });
        break;
      }
      case 'math.divide-ieee.rgb': case 'math.max.rgb': case 'math.power.rgb': {
        const a = visitSource(current, 'a');
        const operation = current.operator === 'math.divide-ieee.rgb' ? 'divide-ieee-rgb'
          : current.operator === 'math.max.rgb' ? 'max-rgb' : 'power-rgb';
        register = current.bypassed ? a : emit({ nodeId: current.id, operation, type: 'rgb', inputs: [a, visitSource(current, 'b')] });
        break;
      }
      case 'math.floor.rgb': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'floor-rgb', type: 'rgb', inputs: [value] });
        break;
      }
      case 'math.clamp.rgb': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id, operation: 'clamp-rgb', type: 'rgb', inputs: [value, visitSource(current, 'min'), visitSource(current, 'max')] });
        break;
      }
      case 'math.mix.rgb': {
        const b = visitSource(current, 'b');
        register = current.bypassed ? b : emit({ nodeId: current.id, operation: 'mix-rgb', type: 'rgb', inputs: [visitSource(current, 'a'), b, visitSource(current, 't')] });
        break;
      }
      case 'math.mix.vec4': {
        const b = visitSource(current, 'b');
        register = current.bypassed ? b : emit({ nodeId: current.id, operation: 'mix-rgb', type: 'vec4', inputs: [visitSource(current, 'a'), b, visitSource(current, 't')] });
        break;
      }
      case 'math.mix-components.rgb': {
        const b = visitSource(current, 'b');
        register = current.bypassed ? b : emit({ nodeId: current.id, operation: 'mix-components-rgb', type: 'rgb',
          inputs: [visitSource(current, 'a'), b, visitSource(current, 't')] });
        break;
      }
      case 'vector.reduce-min.rgb': case 'vector.reduce-max.rgb': register = emit({ nodeId: current.id,
        operation: current.operator === 'vector.reduce-min.rgb' ? 'reduce-min-rgb' : 'reduce-max-rgb', type: 'scalar', inputs: [visitSource(current, 'rgb')] }); break;
      case 'color.luminance-rec601.rgb': register = emit({ nodeId: current.id, operation: 'luminance-rec601', type: 'scalar', inputs: [visitSource(current, 'rgb')] }); break;
      case 'color.luminance-rec709.rgb': case 'color.luminance-rec709.image': register = emit({ nodeId: current.id, operation: 'luminance-rec709', type: 'scalar',
        inputs: [visitSource(current, current.operator.endsWith('.image') ? 'image' : 'rgb')] }); break;
      case 'convert.rgb-to-vec3': register = emit({ nodeId: current.id, operation: 'rgb-to-vec3', type: 'vec3', inputs: [visitSource(current, 'rgb')] }); break;
      case 'convert.vec3-to-rgb': register = emit({ nodeId: current.id, operation: 'vec3-to-rgb', type: 'rgb', inputs: [visitSource(current, 'value')] }); break;
      case 'convert.rgb-to-hsv': register = emit({ nodeId: current.id, operation: 'rgb-to-hsv', type: 'vec3', inputs: [visitSource(current, 'rgb')] }); break;
      case 'convert.hsv-to-rgb': register = emit({ nodeId: current.id, operation: 'hsv-to-rgb', type: 'rgb', inputs: [visitSource(current, 'value')] }); break;
      case 'vector.combine.rgba': register = emit({ nodeId: current.id, operation: 'combine', type: 'image', inputs: [visitSource(current, 'rgb'), visitSource(current, 'alpha')] }); break;
      default: throw new Error(`Unsupported local image operator: ${current.operator}`);
    }
    visiting.delete(visitKey); registers.set(cacheKey, register); return register;
  }
  const previewNode = preview ? nodes.get(preview.nodeId) : undefined;
  if (preview && !previewNode) throw new Error(`Image preview node ${preview.nodeId} is missing.`);
  if (previewNode && preview) {
    const definition = getEffectOperator(previewNode.operator);
    const { direction, nodeId, portId } = preview;
    const port = (direction === 'input' ? definition?.inputs : definition?.outputs)?.find(item => item.id === portId);
    if (!port || !['image', 'rgb', 'alpha', 'number', 'boolean', 'vec2', 'vec3', 'vec4'].includes(port.type)) throw new Error(`Image preview port ${nodeId}:${portId} is unsupported.`);
  }
  const selected = previewNode && preview
    ? preview.direction === 'input' ? source(previewNode, preview.portId) : { node: previewNode, output: preview.portId }
    : source(outputs[0], 'image');
  const output = visit(selected.node, selected.output);
  const capabilities: ImageOperatorCapability[] = [];
  if (instructions.some(item => item.operation === 'uv' || item.operation === 'kernel-sum' || item.operation === 'rect-sum' || item.operation === 'sequence-sum'
    || item.operation === 'segment-sort-luma' || item.operation === 'quadtree-partition' || item.operation === 'resource-input' || item.operation === 'resource-load-input')) capabilities.push('uv');
  if (instructions.some(item => item.operation === 'resolution' || item.operation === 'load-image' || item.operation === 'field-load-nearest-seed' || item.operation === 'segment-sort-luma' || item.operation === 'quadtree-partition')) capabilities.push('resolution');
  if (instructions.some(item => item.operation === 'time')) capabilities.push('time');
  if (instructions.some(item => item.operation === 'sample-image')) capabilities.push('sample');
  if (instructions.some(item => item.operation === 'load-image' || item.operation === 'field-load-nearest-seed' || item.operation === 'segment-sort-luma' || item.operation === 'quadtree-partition')) capabilities.push('pixel-load');
  if (instructions.some(item => item.operation.startsWith('derivative-'))) capabilities.push('derivative');
  const emitted = emitImageOperatorWgsl({ instructions, output, capabilities, sampleScopes, kernelScopes, rectScopes, sequenceScopes, segmentSortScopes, quadtreeScopes,
    parameterValues, resourceInputs, resourceSampling });
  return { fusion: 'inline', capabilities, instructions, output, sampleScopes, kernelScopes, rectScopes, sequenceScopes, segmentSortScopes, quadtreeScopes, values: parameterValues,
    ...emitted, ...(resourceInputs.length ? { resourceInputs } : {}), ...(resourceSampling.length ? { resourceSampling } : {}),
    ...(externalResources.length ? { externalResources } : {}),
    ...(fieldResources.length ? { fieldResources } : {}),
    ...(resourceInputs.includes(IMAGE_FRAME_HISTORY_RESOURCE_ID) ? { frameHistoryResource: IMAGE_FRAME_HISTORY_RESOURCE_ID } : {}) };
}

function assertImageGraphBudget(graph: EffectOperatorGraph) {
  if (graph.nodes.length > IMAGE_EFFECT_GRAPH_LIMITS.nodes || graph.edges.length > IMAGE_EFFECT_GRAPH_LIMITS.edges) {
    throw new Error('Image graph exceeds its node or edge budget.');
  }
}

function assertDerivativeInputsAreRootLocal(graph: EffectOperatorGraph) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  const prohibited = (operator: string) => operator === 'control.select.image' || operator === 'control.select.scalar' || operator === 'image.materialize'
    || operator === 'image.resource-input' || operator.endsWith('-reduce');
  for (const derivative of graph.nodes.filter(node => node.operator.startsWith('image.derivative.'))) {
    const valueEdge = graph.edges.find(edge => edge.to === derivative.id && edge.input === 'value');
    if (!valueEdge) continue;
    const seen = new Set<string>();
    const inspect = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = nodes.get(id)!;
      if (prohibited(node.operator)) throw new Error(`Image derivative ${derivative.id} requires a root-local input expression.`);
      for (const parent of incoming.get(id) ?? []) inspect(parent);
    };
    inspect(valueEdge.from);
  }
}

export function compileImageOperatorGraph(graph: EffectOperatorGraph, params: Record<string, unknown> = {}, context: ImageOperatorCompileContext = {}): ImageOperatorPlan {
  graph = expandOperatorCompositions(graph);
  assertImageGraphBudget(graph);
  assertDerivativeInputsAreRootLocal(graph);
  return compileImageOperatorPassPlan(graph, params, (singleGraph, singleParams, preview) => compileImageOperatorTarget(singleGraph, singleParams, preview, context));
}

export function compileImageOperatorPreview(graph: EffectOperatorGraph, params: Record<string, unknown>, target: ImageOperatorPreviewTarget,
  context: ImageOperatorCompileContext = {}): ImageOperatorPlan {
  graph = expandOperatorCompositions(graph);
  const group = graph.groups?.find(group => group.composition?.instance.id === target.nodeId);
  if (group) {
    const ports = compositionGroupInterface(graph, group)!;
    const endpoint = (target.direction === 'input' ? ports.inputs : ports.outputs).find(port => port.id === target.portId)?.endpoints[0];
    if (!endpoint) throw new Error('Unknown composition preview port.');
    target = { ...target, nodeId: endpoint.nodeId, portId: endpoint.portId };
  }
  assertImageGraphBudget(graph);
  assertDerivativeInputsAreRootLocal(graph);
  return compileImageOperatorPassPlan(graph, params, (singleGraph, singleParams, preview) => compileImageOperatorTarget(singleGraph, singleParams, preview, context), target);
}
