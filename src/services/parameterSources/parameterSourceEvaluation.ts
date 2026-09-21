import type { Keyframe } from '../../types/keyframes';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEndpoint } from '../../types/operatorGraph';
import type { ParameterSourceResult } from '../../types/parameterSources';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { evaluateScalarOperation } from '../operators/scalarOperationSemantics';
import { getControlOperator } from './controlOperators';
import { parameterSourceTargets, type ParameterSourceClip } from './parameterSourceTargets';
import { parameterSourceTime } from './parameterSourceTime';

export class ParameterSourceError extends Error {
  readonly nodeId?: string;
  readonly property?: string;
  constructor(message: string, nodeId?: string, property?: string) {
    super(message); this.name = 'ParameterSourceError'; this.nodeId = nodeId; this.property = property;
  }
}

interface CompiledControls {
  nodes: Map<string, BoundOperatorNode>;
  inputs: Map<string, OperatorEndpoint>;
  errors: Map<string, string>;
}
const compiled = new WeakMap<EffectOperatorGraph, CompiledControls>();
const semanticPrograms = new Map<string, CompiledControls>();

/** Immutable graph snapshots share topology work. A value request never mutates the project. */
function compile(graph: EffectOperatorGraph): CompiledControls {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new ParameterSourceError('Malformed parameter graph.');
  const cached = compiled.get(graph);
  if (cached) return cached;
  if (graph.version !== 1 || (graph.schemaVersion !== undefined && graph.schemaVersion !== 1)) {
    throw new ParameterSourceError('Unsupported parameter graph version.');
  }
  if (graph.nodes.length > 256 || graph.edges.length > 1024) throw new ParameterSourceError('Parameter graph exceeds its node/edge budget.');
  // Layout, group folding and viewport changes do not invalidate a program.
  const signature = JSON.stringify({ nodes: graph.nodes, edges: graph.edges });
  const semantic = semanticPrograms.get(signature);
  if (semantic) { compiled.set(graph, semantic); return semantic; }
  const result: CompiledControls = { nodes: new Map(), inputs: new Map(), errors: new Map() };
  for (const node of graph.nodes) {
    if (result.nodes.has(node.id)) result.errors.set(node.id, 'Duplicate control node ID.');
    result.nodes.set(node.id, node);
    if (!getControlOperator(node.operator) || node.operatorVersion !== 1) result.errors.set(node.id, 'Unsupported control operator/version.');
    if (Object.keys(node.bindings ?? {}).length) result.errors.set(node.id, 'Control nodes use explicit constants and cables, not effect-owned bindings.');
    if (node.bypassed) result.errors.set(node.id, 'Disconnect or disable the target binding to bypass its control source.');
  }
  for (const edge of graph.edges) {
    const target = result.nodes.get(edge.to), source = result.nodes.get(edge.from);
    const input = target && getControlOperator(target.operator)?.inputs.find(port => port.id === edge.input);
    const output = source && getControlOperator(source.operator)?.outputs.find(port => port.id === edge.output);
    const key = `${edge.to}\0${edge.input}`;
    if (!input || !output || input.type !== 'number' || output.type !== 'number') result.errors.set(edge.to, 'Invalid scalar control connection.');
    if (result.inputs.has(key)) result.errors.set(edge.to, 'Only one source can drive a control input.');
    result.inputs.set(key, { nodeId: edge.from, portId: edge.output });
  }
  compiled.set(graph, result);
  semanticPrograms.set(signature, result);
  if (semanticPrograms.size > 32) semanticPrograms.delete(semanticPrograms.keys().next().value!);
  return result;
}

/** One request shares source values across all targets and reads curves from their original owner. */
export function createParameterSourceEvaluator(clip: ParameterSourceClip, keyframes: readonly Keyframe[], localTime: number,
  timelineTime = clip.startTime + localTime) {
  const state = clip.nodeGraph?.parameterSources;
  const clock = parameterSourceTime(clip, keyframes, localTime, timelineTime);
  const targets = new Map(parameterSourceTargets(clip).map(target => [target.path, target]));
  const values = new Map<string, number>(), visiting = new Set<string>();
  const units = new Map<string, string>(), unitVisiting = new Set<string>();
  const keys = clock.keys as Keyframe[];
  const clipTime = clock.localTime + (state?.clipTimeOffset ?? 0);
  let program: CompiledControls | undefined;
  const finite = (value: number, nodeId?: string): number => {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new ParameterSourceError('Control value must be finite and fit a GPU scalar.', nodeId);
    return value;
  };
  const sampleCurve = (property: string): number => {
    const target = targets.get(property);
    if (!target) throw new ParameterSourceError('Keyframe source parameter no longer exists or is unsupported.', undefined, property);
    // MVP targets use clip-local keyframes. Never sample the effective/modulated target.
    return finite(interpolateKeyframes(keys, property as Keyframe['property'], clock.localTime, target.value));
  };
  const compatible = (a: string, b: string, nodeId: string) => {
    if (a !== 'number' && b !== 'number' && a !== b) {
      throw new ParameterSourceError(`Incompatible units (${a} / ${b}). Insert an explicit Remap.`, nodeId);
    }
  };
  const unitForNode = (nodeId: string): string => {
    if (units.has(nodeId)) return units.get(nodeId)!;
    if (!state) throw new ParameterSourceError('Control source is missing.', nodeId);
    program ??= compile(state.graph);
    const node = program.nodes.get(nodeId);
    if (!node) throw new ParameterSourceError('Control source is missing.', nodeId);
    if (unitVisiting.has(nodeId)) throw new ParameterSourceError('Control graph contains a cycle.', nodeId);
    unitVisiting.add(nodeId);
    try {
      const inputUnit = (id: string) => {
        const source = program!.inputs.get(`${nodeId}\0${id}`);
        return source ? unitForNode(source.nodeId) : 'number';
      };
      let unit = 'number';
      if (node.operator === 'control.time') unit = 'seconds';
      else if (node.operator === 'control.keyframes') unit = targets.get(String(node.constants?.property))?.unit ?? 'number';
      else if (node.operator === 'control.lfo') {
        compatible(inputUnit('time'), 'seconds', nodeId); compatible(inputUnit('frequency'), 'Hz', nodeId);
        compatible(inputUnit('phase'), 'turns', nodeId);
        const amplitude = inputUnit('amplitude'), offset = inputUnit('offset');
        compatible(amplitude, offset, nodeId); unit = amplitude === 'number' ? offset : amplitude;
      } else if (node.operator === 'math.add.scalar' || node.operator === 'math.multiply.scalar') {
        const a = inputUnit('a'), b = inputUnit('b');
        if (node.operator === 'math.multiply.scalar' && a !== 'number' && b !== 'number') {
          if (!(a === 'seconds' && b === 'Hz') && !(b === 'seconds' && a === 'Hz')) {
            throw new ParameterSourceError('Multiply requires a unitless factor. Use Remap for explicit conversion.', nodeId);
          }
        } else { compatible(a, b, nodeId); unit = a === 'number' ? b : a; }
      } else if (node.operator === 'math.clamp.scalar') {
        unit = inputUnit('value'); compatible(unit, inputUnit('min'), nodeId); compatible(unit, inputUnit('max'), nodeId);
      } else if (node.operator === 'control.remap') {
        const from = inputUnit('value'); compatible(from, inputUnit('inMin'), nodeId); compatible(from, inputUnit('inMax'), nodeId);
        const a = inputUnit('outMin'), b = inputUnit('outMax'); compatible(a, b, nodeId); unit = a === 'number' ? b : a;
      }
      units.set(nodeId, unit); return unit;
    } finally { unitVisiting.delete(nodeId); }
  };
  const evaluateNode = (endpoint: OperatorEndpoint): number => {
    if (!state || state.version !== 1) throw new ParameterSourceError('Unsupported parameter-source state.');
    program ??= compile(state.graph);
    const { nodeId, portId } = endpoint;
    if (portId !== 'value') throw new ParameterSourceError('Unknown control output.', nodeId);
    const found = values.get(nodeId);
    if (found !== undefined) return found;
    const node = program.nodes.get(nodeId);
    if (!node) throw new ParameterSourceError('Control source is missing.', nodeId);
    const error = program.errors.get(nodeId);
    if (error) throw new ParameterSourceError(error, nodeId);
    unitForNode(nodeId);
    if (visiting.has(nodeId)) throw new ParameterSourceError('Control graph contains a cycle.', nodeId);
    visiting.add(nodeId);
    const definition = getControlOperator(node.operator)!;
    const input = (id: string, fallback = 0): number => {
      const source = program!.inputs.get(`${nodeId}\0${id}`);
      if (source) return evaluateNode(source);
      const constant = node.constants?.[id] ?? definition.parameters.find(p => p.id === id)?.default ?? fallback;
      if (typeof constant !== 'number') throw new ParameterSourceError(`Input ${id} requires a number.`, nodeId);
      return finite(constant, nodeId);
    };
    let value: number;
    try {
      switch (node.operator) {
        case 'values.number': value = input('value'); break;
        case 'control.time': {
          const basis = node.constants?.basis ?? 'clip';
          if (basis !== 'clip' && basis !== 'timeline') throw new ParameterSourceError('Unknown time basis.', nodeId);
          value = basis === 'timeline' ? clock.timelineTime : clipTime; break;
        }
        case 'control.lfo': {
          const timeInput = program.inputs.get(`${nodeId}\0time`);
          const time = timeInput ? evaluateNode(timeInput) : node.constants?.time === 'clip' || node.constants?.time === undefined ? clipTime : input('time');
          value = input('offset') + input('amplitude', 1) * evaluateScalarOperation('sin', 2 * Math.PI * (input('frequency', 1) * time + input('phase'))); break;
        }
        case 'control.keyframes': value = sampleCurve(String(node.constants?.property ?? '')); break;
        case 'math.add.scalar': value = evaluateScalarOperation('add', input('a'), input('b')); break;
        case 'math.multiply.scalar': value = evaluateScalarOperation('multiply', input('a'), input('b', 1)); break;
        case 'math.clamp.scalar': {
          const min = input('min'), max = input('max', 1);
          if (min > max) throw new ParameterSourceError('Clamp minimum must not exceed maximum.', nodeId);
          value = evaluateScalarOperation('clamp', input('value'), min, max); break;
        }
        case 'control.remap': {
          const minimum = input('inMin', -1), span = input('inMax', 1) - minimum;
          if (span === 0) throw new ParameterSourceError('Remap input range must not be zero.', nodeId);
          value = evaluateScalarOperation('mix', input('outMin'), input('outMax', 1), (input('value') - minimum) / span); break;
        }
        default: throw new ParameterSourceError('Unsupported control operator.', nodeId);
      }
      finite(value, nodeId); values.set(nodeId, value); return value;
    } finally { visiting.delete(nodeId); }
  };
  const resolve = (property: string): ParameterSourceResult => {
    const target = targets.get(property);
    if (!target) throw new ParameterSourceError('Parameter does not support control sources.', undefined, property);
    const binding = state?.targets[property];
    if (binding?.source && binding.enabled !== false) {
      const value = evaluateNode(binding.source);
      compatible(unitForNode(binding.source.nodeId), target.unit, binding.source.nodeId);
      if ((target.hardMin !== undefined && value < target.hardMin) || (target.hardMax !== undefined && value > target.hardMax)) {
        throw new ParameterSourceError('Control value is outside the runtime range. Insert Clamp or Remap.', binding.source.nodeId, property);
      }
      return { value, kind: 'node', source: binding.source };
    }
    if (binding?.localMode !== 'constant' && keys.some(key => key.property === property)) return { value: sampleCurve(property), kind: 'keyframes' };
    return { value: finite(target.value), kind: 'constant' };
  };
  const evaluateInput = (nodeId: string, portId: string): number => {
    if (!state) throw new ParameterSourceError('Control source is missing.', nodeId);
    program ??= compile(state.graph);
    const node = program.nodes.get(nodeId), definition = node && getControlOperator(node.operator);
    if (!node || !definition?.inputs.some(port => port.id === portId)) throw new ParameterSourceError('Unknown control input.', nodeId);
    const source = program.inputs.get(`${nodeId}\0${portId}`);
    if (source) return evaluateNode(source);
    const raw = node.constants?.[portId] ?? definition.parameters.find(param => param.id === portId)?.default ?? 0;
    if (node.operator === 'control.lfo' && portId === 'time' && raw === 'clip') return finite(clipTime, nodeId);
    if (typeof raw !== 'number') throw new ParameterSourceError('Control input requires a number.', nodeId);
    return finite(raw, nodeId);
  };
  return { resolve, evaluateNode, evaluateInput, targets };
}
