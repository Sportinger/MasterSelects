import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import type { ImageOperatorProgram } from '../../types/imageOperatorProgram';
import { getEffectOperator } from './operatorRegistry';
import { evaluateScalarOperation } from './scalarOperationSemantics';
import { imageFract, imageHsvToRgb, imageRgbToHsv } from './imageColorSemantics';
import { IMAGE_OPERATOR_PARAMETER_CAPACITY, IMAGE_OPERATOR_PARAMETER_VEC4_COUNT } from './imageOperatorParameters';

export type ImagePlanValue = 'image' | 'rgb' | 'alpha' | 'scalar' | 'boolean' | 'vec2' | 'vec3' | 'vec4';
export type ImageOperatorCapability = 'uv' | 'resolution' | 'time' | 'sample';
export interface ImageOperatorEvaluationContext {
  uv?: [number, number]; resolution?: [number, number]; timelineTimeSeconds?: number;
  sampleImage?: (uv: [number, number]) => [number, number, number, number];
}
export interface ImagePlanInstruction {
  nodeId: string;
  operation: 'input' | 'uv' | 'resolution' | 'time' | 'sample-image' | 'constant' | 'parameter' | 'parameter-boolean' | 'subtract' | 'add-scalar' | 'multiply-scalar' | 'divide-ieee-scalar' | 'reciprocal-scalar' | 'exp2-scalar' | 'fract-scalar' | 'max-scalar' | 'smoothstep-scalar' | 'mix-scalar' | 'greater-scalar' | 'and-boolean' | 'select-scalar' | 'add-vec2' | 'subtract-vec2' | 'multiply-vec2' | 'divide-vec2' | 'floor-vec2' | 'dot-vec2' | 'length-vec2' | 'sin-scalar' | 'cos-scalar' | 'scalar-to-vec2' | 'subtract-rgb' | 'add-rgb' | 'multiply-rgb' | 'divide-ieee-rgb' | 'max-rgb' | 'power-rgb' | 'floor-rgb' | 'clamp-rgb' | 'mix-rgb' | 'mix-components-rgb' | 'reduce-min-rgb' | 'reduce-max-rgb' | 'luminance-rec601' | 'luminance-rec709' | 'scalar-to-rgb' | 'rgb-to-vec3' | 'vec3-to-rgb' | 'rgb-to-hsv' | 'hsv-to-rgb' | 'split-rgb' | 'split-alpha' | 'combine' | 'image-to-vec4' | 'vec4-to-image' | 'split-component' | 'combine-vector';
  type: ImagePlanValue;
  inputs: number[];
  value?: number;
  scope?: number;
}
export interface ImageOperatorPlan extends ImageOperatorProgram {
  fusion: 'inline';
  capabilities: readonly ImageOperatorCapability[];
  instructions: ImagePlanInstruction[];
  output: number;
  sampleScopes: readonly { id: number; output: number }[];
}
export interface ImageOperatorPreviewTarget { nodeId: string; direction: 'input' | 'output'; portId: string }

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings });
const edge = (id: string, from: string, output: string, to: string, input: string) => ({ id, from, output, to, input });

export function createDefaultInvertImageGraph(): EffectOperatorGraph {
  return {
    version: 1, schemaVersion: 1, domain: 'image', incomplete: undefined,
    nodes: [node('frame', 'image.frame'), node('rgba', 'convert.image-to-vec4'), node('split', 'vector.split.vec4'),
      { ...node('one', 'values.number'), constants: { value: 1 } }, node('invert-r', 'math.subtract.scalar'),
      node('invert-g', 'math.subtract.scalar'), node('invert-b', 'math.subtract.scalar'), node('combine', 'vector.combine.vec4'),
      node('image', 'convert.vec4-to-image'), node('output', 'image.output')],
    edges: [
      edge('frame-rgba', 'frame', 'image', 'rgba', 'image'), edge('rgba-split', 'rgba', 'value', 'split', 'value'),
      edge('one-r', 'one', 'value', 'invert-r', 'a'), edge('one-g', 'one', 'value', 'invert-g', 'a'), edge('one-b', 'one', 'value', 'invert-b', 'a'),
      edge('r-invert', 'split', 'x', 'invert-r', 'b'), edge('g-invert', 'split', 'y', 'invert-g', 'b'), edge('b-invert', 'split', 'z', 'invert-b', 'b'),
      edge('invert-r-combine', 'invert-r', 'value', 'combine', 'x'), edge('invert-g-combine', 'invert-g', 'value', 'combine', 'y'),
      edge('invert-b-combine', 'invert-b', 'value', 'combine', 'z'), edge('alpha-combine', 'split', 'w', 'combine', 'w'),
      edge('combine-image', 'combine', 'value', 'image', 'value'), edge('image-output', 'image', 'image', 'output', 'image'),
    ],
    layout: { frame: { x: 0, y: 0 }, rgba: { x: 300, y: 0 }, split: { x: 600, y: 0 }, one: { x: 600, y: 400 },
      'invert-r': { x: 900, y: 0 }, 'invert-g': { x: 900, y: 400 }, 'invert-b': { x: 900, y: 800 }, combine: { x: 1200, y: 0 }, image: { x: 1500, y: 0 }, output: { x: 1800, y: 0 } },
  };
}

/** Upgrades short-lived Paket-A IDs without retaining a second executable model. */
export function migrateImageOperatorGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  const migrated = structuredClone(graph);
  for (const item of migrated.nodes) {
    if (item.operator === 'image.rgb-split') item.operator = 'vector.split.rgba';
    if (item.operator === 'image.rgb-combine') item.operator = 'vector.combine.rgba';
  }
  const ids = new Set(migrated.nodes.map(item => item.id));
  const edgeIds = new Set(migrated.edges.map(item => item.id));
  const uniqueId = (base: string) => {
    let candidate = base, suffix = 2;
    while (ids.has(candidate)) candidate = `${base}-${suffix++}`;
    ids.add(candidate); return candidate;
  };
  const uniqueEdgeId = (base: string) => {
    let candidate = base, suffix = 2;
    while (edgeIds.has(candidate)) candidate = `${base}-${suffix++}`;
    edgeIds.add(candidate); return candidate;
  };
  for (const legacy of migrated.nodes.filter(item => item.operator === 'color.invert.rgb')) {
    if (migrated.nodes.length + 2 > 64) throw new Error('Image graph migration exceeds 64 nodes.');
    const oneId = uniqueId(`${legacy.id}-one`), splatId = uniqueId(`${legacy.id}-ones`);
    legacy.operator = 'math.subtract.rgb';
    migrated.nodes.push({ ...node(oneId, 'values.number'), constants: { value: 1 } }, node(splatId, 'convert.scalar-to-rgb'));
    const incoming = migrated.edges.filter(item => item.to === legacy.id && item.input === 'rgb');
    for (const item of incoming) item.input = 'b';
    for (const item of migrated.edges.filter(item => item.from === legacy.id && item.output === 'rgb')) item.output = 'value';
    migrated.edges.push(edge(uniqueEdgeId(`${oneId}-splat`), oneId, 'value', splatId, 'value'),
      edge(uniqueEdgeId(`${splatId}-subtract`), splatId, 'rgb', legacy.id, 'a'));
    const position = migrated.layout[legacy.id] ?? { x: 0, y: 0 };
    migrated.layout[oneId] = { x: position.x - 220, y: position.y + 180 };
    migrated.layout[splatId] = { x: position.x, y: position.y + 180 };
    for (const group of migrated.groups ?? []) if (group.nodeIds.includes(legacy.id)) group.nodeIds.push(oneId, splatId);
  }
  return migrated;
}

const f32 = (value: number) => Number.isInteger(value) ? `${value}.0` : String(value);
const parameterExpression = (slot: number) => `imageParameters.values[${Math.floor(slot / 4)}].${'xyzw'[slot % 4]}`;
const IMAGE_PARAMETER_WGSL = `struct ImageOperatorParameters {
  values: array<vec4f, ${IMAGE_OPERATOR_PARAMETER_VEC4_COUNT}>,
};`;
const IMAGE_COLOR_WGSL = `
fn imageGraphRgbToHsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y); let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn imageGraphHsvToRgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}`;
const hash = (value: string) => {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { result ^= value.charCodeAt(index); result = Math.imul(result, 0x01000193); }
  return (result >>> 0).toString(16).padStart(8, '0');
};

function compileImageOperatorTarget(graph: EffectOperatorGraph, params: Record<string, unknown>, preview?: ImageOperatorPreviewTarget): ImageOperatorPlan {
  graph = migrateImageOperatorGraph(graph);
  if (graph.domain !== 'image') throw new Error('Expected an image operator graph.');
  if (graph.schemaVersion !== 1) throw new Error(`Unsupported image graph schema version: ${String(graph.schemaVersion)}.`);
  if (graph.nodes.some(item => item.operatorVersion !== 1)) throw new Error('Unsupported image operator version.');
  for (const item of graph.nodes.filter(item => item.operator === 'values.number')) {
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
  const sampleScopes: Array<{ id: number; output: number }> = [];
  const scopeBySource = new Map<string, number>(); let nextScopeId = 1;
  let activeScope = 0;
  const emit = (instruction: ImagePlanInstruction) => instructions.push({ ...instruction, scope: activeScope }) - 1;
  function source(target: BoundOperatorNode, input: string) {
    const item = incoming.get(`${target.id}:${input}`)?.[0];
    if (!item) throw new Error(`Image input ${target.id}:${input} is not connected.`);
    return { node: nodes.get(item.from)!, output: item.output };
  }
  function visitSource(target: BoundOperatorNode, input: string) {
    const linked = source(target, input);
    return visit(linked.node, linked.output);
  }
  function visit(current: BoundOperatorNode, output: string): number {
    const cacheKey = `${activeScope}:${current.id}:${output}`;
    const cached = registers.get(cacheKey); if (cached !== undefined) return cached;
    const visitKey = `${activeScope}:${current.id}`;
    if (visiting.has(visitKey)) throw new Error('Image graph contains a cycle.');
    visiting.add(visitKey);
    let register: number;
    switch (current.operator) {
      case 'image.frame': register = emit({ nodeId: current.id, operation: 'input', type: 'image', inputs: [] }); break;
      case 'image.normalized-uv': register = emit({ nodeId: current.id, operation: 'uv', type: 'vec2', inputs: [] }); break;
      case 'image.resolution': register = emit({ nodeId: current.id, operation: 'resolution', type: 'vec2', inputs: [] }); break;
      case 'image.timeline-time': register = emit({ nodeId: current.id, operation: 'time', type: 'scalar', inputs: [] }); break;
      case 'image.sample': {
        const linked = source(current, 'image'), parentScope = activeScope;
        if (current.bypassed) { register = visit(linked.node, linked.output); break; }
        const uv = visitSource(current, 'uv');
        const sourceKey = `${linked.node.id}:${linked.output}`;
        let scope = scopeBySource.get(sourceKey);
        if (scope === undefined) {
          scope = nextScopeId++; scopeBySource.set(sourceKey, scope);
          activeScope = scope; const scopedOutput = visit(linked.node, linked.output); activeScope = parentScope;
          sampleScopes.push({ id: scope, output: scopedOutput });
        }
        register = emit({ nodeId: current.id, operation: 'sample-image', type: 'image', inputs: [uv], value: scope });
        break;
      }
      case 'values.number': {
        const binding = current.bindings.value;
        const raw = typeof binding === 'string' ? params[binding] : undefined;
        const literal = current.constants?.value;
        const value = typeof raw === 'number' ? raw : typeof literal === 'number' ? literal : 1;
        if (!Number.isFinite(value)) throw new Error(`Image scalar ${current.id} must be finite.`);
        if (typeof binding === 'string') {
          let slot = parameterSlots.get(binding);
          if (slot === undefined) {
            slot = parameterValues.length;
            if (slot >= IMAGE_OPERATOR_PARAMETER_CAPACITY) throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
            parameterSlots.set(binding, slot); parameterValues.push(value);
          }
          register = emit({ nodeId: current.id, operation: 'parameter', type: 'scalar', inputs: [], value: slot });
        } else register = emit({ nodeId: current.id, operation: 'constant', type: 'scalar', inputs: [], value });
        break;
      }
      case 'values.boolean': {
        const binding = current.bindings.value;
        const raw = typeof binding === 'string' ? params[binding] : current.constants?.value;
        const value = typeof raw === 'boolean' ? raw : false;
        if (typeof binding !== 'string') {
          register = emit({ nodeId: current.id, operation: 'constant', type: 'boolean', inputs: [], value: value ? 1 : 0 }); break;
        }
        let slot = typeof binding === 'string' ? parameterSlots.get(binding) : undefined;
        if (slot === undefined) {
          slot = parameterValues.length;
          if (slot >= IMAGE_OPERATOR_PARAMETER_CAPACITY) throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
          if (typeof binding === 'string') parameterSlots.set(binding, slot);
          parameterValues.push(value ? 1 : 0);
        }
        register = emit({ nodeId: current.id, operation: 'parameter-boolean', type: 'boolean', inputs: [], value: slot }); break;
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
      case 'math.max.scalar': {
        const a = visitSource(current, 'a');
        register = current.bypassed ? a : emit({ nodeId: current.id, operation: 'max-scalar', type: 'scalar', inputs: [a, visitSource(current, 'b')] });
        break;
      }
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
      case 'math.floor.vec2': {
        const value = visitSource(current, 'value'); register = current.bypassed ? value
          : emit({ nodeId: current.id, operation: 'floor-vec2', type: 'vec2', inputs: [value] }); break;
      }
      case 'math.sin.scalar': case 'math.cos.scalar': {
        const value = visitSource(current, 'value');
        register = current.bypassed ? value : emit({ nodeId: current.id,
          operation: current.operator === 'math.sin.scalar' ? 'sin-scalar' : 'cos-scalar', type: 'scalar', inputs: [value] });
        break;
      }
      case 'convert.scalar-to-vec2': register = emit({ nodeId: current.id, operation: 'scalar-to-vec2', type: 'vec2',
        inputs: [visitSource(current, 'value')] }); break;
      case 'compare.greater.scalar': register = emit({ nodeId: current.id, operation: 'greater-scalar', type: 'boolean',
        inputs: [visitSource(current, 'a'), visitSource(current, 'b')] }); break;
      case 'logic.and.boolean': register = emit({ nodeId: current.id, operation: 'and-boolean', type: 'boolean',
        inputs: [visitSource(current, 'a'), visitSource(current, 'b')] }); break;
      case 'select.scalar': register = emit({ nodeId: current.id, operation: 'select-scalar', type: 'scalar',
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
      case 'math.mix-components.rgb': {
        const b = visitSource(current, 'b');
        register = current.bypassed ? b : emit({ nodeId: current.id, operation: 'mix-components-rgb', type: 'rgb',
          inputs: [visitSource(current, 'a'), b, visitSource(current, 't')] });
        break;
      }
      case 'vector.reduce-min.rgb': case 'vector.reduce-max.rgb': register = emit({ nodeId: current.id,
        operation: current.operator === 'vector.reduce-min.rgb' ? 'reduce-min-rgb' : 'reduce-max-rgb', type: 'scalar', inputs: [visitSource(current, 'rgb')] }); break;
      case 'color.luminance-rec601.rgb': register = emit({ nodeId: current.id, operation: 'luminance-rec601', type: 'scalar', inputs: [visitSource(current, 'rgb')] }); break;
      case 'color.luminance-rec709.rgb': register = emit({ nodeId: current.id, operation: 'luminance-rec709', type: 'scalar', inputs: [visitSource(current, 'rgb')] }); break;
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
  if (instructions.length > 256) throw new Error('Image graph scoped expansion exceeds 256 instructions.');
  const capabilities: ImageOperatorCapability[] = [];
  if (instructions.some(item => item.operation === 'uv' && (item.scope ?? 0) === 0)) capabilities.push('uv');
  if (instructions.some(item => item.operation === 'resolution')) capabilities.push('resolution');
  if (instructions.some(item => item.operation === 'time')) capabilities.push('time');
  if (instructions.some(item => item.operation === 'sample-image')) capabilities.push('sample');
  const contextCallArgs = (uv: string) => [uv,
    ...(capabilities.includes('resolution') ? ['inputResolution'] : []),
    ...(capabilities.includes('time') ? ['timelineTimeSeconds'] : []),
    ...(parameterValues.length ? ['imageParameters'] : [])].join(', ');
  const expressions = instructions.map((item, index) => {
    const args = item.inputs.map(input => `v${input}`);
    const expression = item.operation === 'input' ? 'pixel' : item.operation === 'uv' ? 'inputUv' : item.operation === 'resolution' ? 'inputResolution'
      : item.operation === 'time' ? 'timelineTimeSeconds' : item.operation === 'sample-image'
        ? `evaluateImageScope${item.value}(sampleImageGraphSource(${args[0]}), ${contextCallArgs(args[0])})`
      : item.operation === 'constant' ? item.type === 'boolean' ? (item.value ? 'true' : 'false') : f32(item.value ?? 0)
      : item.operation === 'parameter' ? parameterExpression(item.value ?? 0)
      : item.operation === 'parameter-boolean' ? `${parameterExpression(item.value ?? 0)} > 0.5`
      : item.operation === 'subtract' ? `${args[0]} - ${args[1]}` : item.operation === 'split-rgb' ? `${args[0]}.rgb`
      : item.operation === 'add-scalar' ? `${args[0]} + ${args[1]}` : item.operation === 'multiply-scalar' ? `${args[0]} * ${args[1]}`
      : item.operation === 'divide-ieee-scalar' ? `${args[0]} / ${args[1]}` : item.operation === 'reciprocal-scalar' ? `1.0 / ${args[0]}`
      : item.operation === 'exp2-scalar' ? `exp2(${args[0]})` : item.operation === 'fract-scalar' ? `fract(${args[0]})`
      : item.operation === 'max-scalar' ? `max(${args[0]}, ${args[1]})` : item.operation === 'greater-scalar' ? `${args[0]} > ${args[1]}`
      : item.operation === 'and-boolean' ? `${args[0]} && ${args[1]}`
      : item.operation === 'smoothstep-scalar' ? `smoothstep(${args[0]}, ${args[1]}, ${args[2]})`
      : item.operation === 'mix-scalar' ? `mix(${args[0]}, ${args[1]}, ${args[2]})`
      : item.operation === 'add-vec2' ? `${args[0]} + ${args[1]}` : item.operation === 'subtract-vec2' ? `${args[0]} - ${args[1]}` : item.operation === 'multiply-vec2' ? `${args[0]} * ${args[1]}`
      : item.operation === 'divide-vec2' ? `${args[0]} / ${args[1]}` : item.operation === 'floor-vec2' ? `floor(${args[0]})`
      : item.operation === 'dot-vec2' ? `dot(${args[0]}, ${args[1]})` : item.operation === 'length-vec2' ? `length(${args[0]})`
      : item.operation === 'sin-scalar' ? `sin(${args[0]})` : item.operation === 'cos-scalar' ? `cos(${args[0]})` : item.operation === 'scalar-to-vec2' ? `vec2f(${args[0]})`
      : item.operation === 'select-scalar' ? `select(${args[0]}, ${args[1]}, ${args[2]})`
      : item.operation === 'split-alpha' ? `${args[0]}.a` : item.operation === 'subtract-rgb' ? `${args[0]} - ${args[1]}`
      : item.operation === 'add-rgb' ? `${args[0]} + ${args[1]}` : item.operation === 'multiply-rgb' ? `${args[0]} * ${args[1]}`
      : item.operation === 'divide-ieee-rgb' ? `${args[0]} / ${args[1]}` : item.operation === 'max-rgb' ? `max(${args[0]}, ${args[1]})`
      : item.operation === 'power-rgb' ? `pow(${args[0]}, ${args[1]})`
      : item.operation === 'floor-rgb' ? `floor(${args[0]})`
      : item.operation === 'clamp-rgb' ? `clamp(${args[0]}, min(${args[1]}, ${args[2]}), max(${args[1]}, ${args[2]}))` : item.operation === 'mix-rgb' ? `mix(${args[0]}, ${args[1]}, ${args[2]})`
      : item.operation === 'mix-components-rgb' ? `mix(${args[0]}, ${args[1]}, ${args[2]})`
      : item.operation === 'reduce-min-rgb' ? `min(min(${args[0]}.r, ${args[0]}.g), ${args[0]}.b)`
      : item.operation === 'reduce-max-rgb' ? `max(max(${args[0]}.r, ${args[0]}.g), ${args[0]}.b)`
      : item.operation === 'luminance-rec601' ? `dot(${args[0]}, vec3f(0.299, 0.587, 0.114))`
      : item.operation === 'luminance-rec709' ? `dot(${args[0]}, vec3f(0.2126, 0.7152, 0.0722))`
      : item.operation === 'scalar-to-rgb' ? `vec3f(${args[0]})` : item.operation === 'image-to-vec4' || item.operation === 'vec4-to-image' ? args[0]
      : item.operation === 'rgb-to-vec3' || item.operation === 'vec3-to-rgb' ? args[0]
      : item.operation === 'rgb-to-hsv' ? `imageGraphRgbToHsv(${args[0]})` : item.operation === 'hsv-to-rgb' ? `imageGraphHsvToRgb(${args[0]})`
      : item.operation === 'split-component' ? `${args[0]}[${item.value}]` : item.operation === 'combine-vector' ? `vec${item.inputs.length}f(${args.join(', ')})`
      : `vec4f(${args[0]}, ${args[1]})`;
    const type = item.type === 'image' || item.type === 'vec4' ? 'vec4f' : item.type === 'rgb' || item.type === 'vec3' ? 'vec3f' : item.type === 'vec2' ? 'vec2f' : item.type === 'boolean' ? 'bool' : 'f32';
    return `  let v${index}: ${type} = ${expression};`;
  });
  const outputType = instructions[output].type;
  const canonical = JSON.stringify({ capabilities, instructions: instructions.map(({ nodeId: _nodeId, ...instruction }) => instruction), sampleScopes, output, outputType });
  const returned = outputType === 'image' || outputType === 'vec4' ? `v${output}` : outputType === 'rgb' || outputType === 'vec3' ? `vec4f(v${output}, 1.0)`
    : outputType === 'vec2' ? `vec4f(v${output}, 0.0, 1.0)`
    : outputType === 'boolean' ? `vec4f(vec3f(select(0.0, 1.0, v${output})), 1.0)`
    : outputType === 'alpha' || outputType === 'scalar' ? `vec4f(v${output}, v${output}, v${output}, 1.0)` : `v${output}`;
  const parameters = ['inputColor: vec4f'];
  if (capabilities.includes('uv')) parameters.push('inputUv: vec2f');
  if (capabilities.includes('resolution')) parameters.push('inputResolution: vec2f');
  if (capabilities.includes('time')) parameters.push('timelineTimeSeconds: f32');
  if (parameterValues.length) parameters.push('imageParameters: ImageOperatorParameters');
  const scopeParameters = ['inputColor: vec4f', 'inputUv: vec2f'];
  if (capabilities.includes('resolution')) scopeParameters.push('inputResolution: vec2f');
  if (capabilities.includes('time')) scopeParameters.push('timelineTimeSeconds: f32');
  if (parameterValues.length) scopeParameters.push('imageParameters: ImageOperatorParameters');
  const scopeFunctions = sampleScopes.toSorted((a, b) => b.id - a.id).map(scope => [
    `fn evaluateImageScope${scope.id}(${scopeParameters.join(', ')}) -> vec4f {`, '  let pixel = inputColor;',
    ...expressions.filter((_line, index) => instructions[index].scope === scope.id), `  return v${scope.output};`, '}',
  ].join('\n'));
  return { fusion: 'inline', capabilities, instructions, output, sampleScopes, values: parameterValues, key: `image-v1-${hash(canonical)}`,
    wgsl: [IMAGE_COLOR_WGSL, ...(parameterValues.length ? [IMAGE_PARAMETER_WGSL] : []),
      ...scopeFunctions, `fn evaluateImageGraph(${parameters.join(', ')}) -> vec4f {`, `  let pixel = inputColor;`,
      ...expressions.filter((_line, index) => instructions[index].scope === 0), `  return ${returned};`, `}`].join('\n') };
}

export function compileImageOperatorGraph(graph: EffectOperatorGraph, params: Record<string, unknown> = {}): ImageOperatorPlan {
  return compileImageOperatorTarget(graph, params);
}

export function compileImageOperatorPreview(graph: EffectOperatorGraph, params: Record<string, unknown>, target: ImageOperatorPreviewTarget): ImageOperatorPlan {
  return compileImageOperatorTarget(graph, params, target);
}

export function evaluateImageOperatorPlan(plan: ImageOperatorPlan, pixel: [number, number, number, number], context: ImageOperatorEvaluationContext = {}): [number, number, number, number] {
  if (plan.capabilities.includes('uv') && !context.uv) throw new Error('Image operator plan requires normalized UV context.');
  if (plan.capabilities.includes('resolution') && (!context.resolution || context.resolution.some(value => !Number.isFinite(value) || value <= 0))) {
    throw new Error('Image operator plan requires finite positive resolution context.');
  }
  if (plan.capabilities.includes('time') && (typeof context.timelineTimeSeconds !== 'number' || !Number.isFinite(context.timelineTimeSeconds))) {
    throw new Error('Image operator plan requires finite timeline time context.');
  }
  if (plan.capabilities.includes('sample') && !context.sampleImage) throw new Error('Image operator plan requires an image sampling callback.');
  function evaluateScope(scope: number, scopePixel: [number, number, number, number], scopeUv: [number, number] | undefined) {
   const values: Array<number | boolean | number[]> = [];
   for (const item of plan.instructions) {
    if ((item.scope ?? 0) !== scope) { values.push(0); continue; }
    const args = item.inputs.map(input => values[input]);
    if (item.operation === 'input') values.push(scopePixel);
    else if (item.operation === 'uv') values.push(scopeUv!);
    else if (item.operation === 'resolution') values.push(context.resolution!);
    else if (item.operation === 'time') values.push(context.timelineTimeSeconds!);
    else if (item.operation === 'sample-image') {
      const uv = args[0] as [number, number]; values.push(evaluateScope(item.value!, context.sampleImage!(uv), uv)[plan.sampleScopes.find(candidate => candidate.id === item.value)!.output]);
    }
    else if (item.operation === 'constant') values.push(item.type === 'boolean' ? Boolean(item.value) : item.value ?? 0);
    else if (item.operation === 'parameter') values.push(plan.values[item.value ?? 0]);
    else if (item.operation === 'parameter-boolean') values.push(plan.values[item.value ?? 0] > 0.5);
    else if (item.operation === 'subtract') values.push(evaluateScalarOperation('subtract', args[0] as number, args[1] as number));
    else if (item.operation === 'add-scalar') values.push(evaluateScalarOperation('add', args[0] as number, args[1] as number));
    else if (item.operation === 'multiply-scalar') values.push(evaluateScalarOperation('multiply', args[0] as number, args[1] as number));
    else if (item.operation === 'divide-ieee-scalar') values.push((args[0] as number) / (args[1] as number));
    else if (item.operation === 'reciprocal-scalar') values.push(1 / (args[0] as number));
    else if (item.operation === 'exp2-scalar') values.push(2 ** (args[0] as number));
    else if (item.operation === 'fract-scalar') values.push(imageFract(args[0] as number));
    else if (item.operation === 'max-scalar') values.push(Math.max(args[0] as number, args[1] as number));
    else if (item.operation === 'and-boolean') values.push((args[0] as boolean) && (args[1] as boolean));
    else if (item.operation === 'smoothstep-scalar') {
      const t = Math.max(0, Math.min(1, ((args[2] as number) - (args[0] as number)) / ((args[1] as number) - (args[0] as number))));
      values.push(t * t * (3 - 2 * t));
    }
    else if (item.operation === 'mix-scalar') values.push((args[0] as number) * (1 - (args[2] as number)) + (args[1] as number) * (args[2] as number));
    else if (item.operation === 'add-vec2') values.push((args[0] as number[]).map((value, index) => evaluateScalarOperation('add', value, (args[1] as number[])[index])));
    else if (item.operation === 'subtract-vec2') values.push((args[0] as number[]).map((value, index) => evaluateScalarOperation('subtract', value, (args[1] as number[])[index])));
    else if (item.operation === 'multiply-vec2') values.push((args[0] as number[]).map((value, index) => evaluateScalarOperation('multiply', value, (args[1] as number[])[index])));
    else if (item.operation === 'divide-vec2') values.push((args[0] as number[]).map((value, index) => value / (args[1] as number[])[index]));
    else if (item.operation === 'floor-vec2') values.push((args[0] as number[]).map(Math.floor));
    else if (item.operation === 'dot-vec2') values.push((args[0] as number[])[0] * (args[1] as number[])[0] + (args[0] as number[])[1] * (args[1] as number[])[1]);
    else if (item.operation === 'length-vec2') values.push(Math.hypot(...args[0] as number[]));
    else if (item.operation === 'sin-scalar') values.push(Math.sin(args[0] as number));
    else if (item.operation === 'cos-scalar') values.push(Math.cos(args[0] as number));
    else if (item.operation === 'scalar-to-vec2') values.push([args[0] as number, args[0] as number]);
    else if (item.operation === 'greater-scalar') values.push((args[0] as number) > (args[1] as number));
    else if (item.operation === 'select-scalar') values.push((args[2] as boolean) ? args[1] as number : args[0] as number);
    else if (item.operation === 'split-rgb') values.push((args[0] as number[]).slice(0, 3));
    else if (item.operation === 'split-alpha') values.push((args[0] as number[])[3]);
    else if (item.operation === 'subtract-rgb') values.push((args[0] as number[]).map((channel, index) => evaluateScalarOperation('subtract', channel, (args[1] as number[])[index])));
    else if (item.operation === 'add-rgb') values.push((args[0] as number[]).map((channel, index) => evaluateScalarOperation('add', channel, (args[1] as number[])[index])));
    else if (item.operation === 'multiply-rgb') values.push((args[0] as number[]).map((channel, index) => evaluateScalarOperation('multiply', channel, (args[1] as number[])[index])));
    else if (item.operation === 'divide-ieee-rgb') values.push((args[0] as number[]).map((channel, index) => channel / (args[1] as number[])[index]));
    else if (item.operation === 'max-rgb') values.push((args[0] as number[]).map((channel, index) => Math.max(channel, (args[1] as number[])[index])));
    else if (item.operation === 'power-rgb') values.push((args[0] as number[]).map((channel, index) => channel ** (args[1] as number[])[index]));
    else if (item.operation === 'floor-rgb') values.push((args[0] as number[]).map(Math.floor));
    else if (item.operation === 'clamp-rgb') values.push((args[0] as number[]).map((channel, index) => evaluateScalarOperation('clamp', channel, (args[1] as number[])[index], (args[2] as number[])[index])));
    else if (item.operation === 'mix-rgb') values.push((args[0] as number[]).map((channel, index) => channel * (1 - (args[2] as number)) + (args[1] as number[])[index] * (args[2] as number)));
    else if (item.operation === 'mix-components-rgb') values.push((args[0] as number[]).map((channel, index) => channel * (1 - (args[2] as number[])[index]) + (args[1] as number[])[index] * (args[2] as number[])[index]));
    else if (item.operation === 'reduce-min-rgb') values.push(Math.min(...args[0] as number[]));
    else if (item.operation === 'reduce-max-rgb') values.push(Math.max(...args[0] as number[]));
    else if (item.operation === 'luminance-rec601') values.push((args[0] as number[])[0] * 0.299 + (args[0] as number[])[1] * 0.587 + (args[0] as number[])[2] * 0.114);
    else if (item.operation === 'luminance-rec709') values.push((args[0] as number[])[0] * 0.2126 + (args[0] as number[])[1] * 0.7152 + (args[0] as number[])[2] * 0.0722);
    else if (item.operation === 'scalar-to-rgb') values.push([args[0] as number, args[0] as number, args[0] as number]);
    else if (item.operation === 'rgb-to-vec3' || item.operation === 'vec3-to-rgb') values.push(args[0]);
    else if (item.operation === 'rgb-to-hsv') values.push(imageRgbToHsv(args[0] as [number, number, number]));
    else if (item.operation === 'hsv-to-rgb') values.push(imageHsvToRgb(args[0] as [number, number, number]));
    else if (item.operation === 'image-to-vec4' || item.operation === 'vec4-to-image') values.push(args[0]);
    else if (item.operation === 'split-component') values.push((args[0] as number[])[item.value ?? 0]);
    else if (item.operation === 'combine-vector') values.push(args as number[]);
    else values.push([...(args[0] as number[]), args[1] as number]);
   }
   return values;
  }
  const values = evaluateScope(0, pixel, context.uv);
  const result = values[plan.output], type = plan.instructions[plan.output].type;
  if (type === 'image' || type === 'vec4') return result as [number, number, number, number];
  if (type === 'rgb' || type === 'vec3') return [...result as number[], 1] as [number, number, number, number];
  if (type === 'vec2') return [...result as number[], 0, 1] as [number, number, number, number];
  if (type === 'boolean') { const value = result ? 1 : 0; return [value, value, value, 1]; }
  return [result as number, result as number, result as number, 1];
}
