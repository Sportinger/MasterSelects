import type { Keyframe } from '../../types/keyframes';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEndpoint } from '../../types/operatorGraph';
import type { ParameterSourceResult } from '../../types/parameterSources';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { evaluateScalarOperation } from '../operators/scalarOperationSemantics';
import { controlClockInputs, getControlOperator } from './controlOperators';
import { parameterSourceTargets, type ParameterSourceClip } from './parameterSourceTargets';
import { parameterSourceTime } from './parameterSourceTime';
import { evaluateAudioParameter, frozenAudioParameterContext, type AudioParameterContext } from './audioParameterContext';
import type { AudioEnvelopeSampling } from './audioEnvelopeSampling';
import { liveAudioParameterContext } from './audioParameterRuntime';
import { envelopeValue, markerTriggerValue, smoothNoise, solveTwoBoneIk, type MarkerTriggerMode } from './controlSignalMath';
import { frozenMarkerParameterContext } from './markerParameterContext';
import { liveMarkerParameterContext } from './markerParameterRuntime';

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

const IK_ANGLE_OUTPUTS = new Set(['angle1', 'angle2']);

/** One request shares source values across all targets and reads curves from their original owner. */
export function createParameterSourceEvaluator(clip: ParameterSourceClip, keyframes: readonly Keyframe[], localTime: number,
  timelineTime = clip.startTime + localTime, audioContext?: AudioParameterContext) {
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
  const loadProgram = (nodeId?: string): CompiledControls => {
    if (!state) throw new ParameterSourceError('Control source is missing.', nodeId);
    program ??= compile(state.graph);
    return program;
  };
  const unitFor = (nodeId: string, portId = 'value'): string => {
    const cacheKey = `${nodeId}\0${portId}`;
    if (units.has(cacheKey)) return units.get(cacheKey)!;
    const node = loadProgram(nodeId).nodes.get(nodeId);
    if (!node) throw new ParameterSourceError('Control source is missing.', nodeId);
    if (unitVisiting.has(nodeId)) throw new ParameterSourceError('Control graph contains a cycle.', nodeId);
    unitVisiting.add(nodeId);
    try {
      const inputUnit = (id: string) => {
        const source = program!.inputs.get(`${nodeId}\0${id}`);
        return source ? unitFor(source.nodeId, source.portId) : 'number';
      };
      const scaledSignal = () => {
        const amplitude = inputUnit('amplitude'), offset = inputUnit('offset');
        compatible(amplitude, offset, nodeId); return amplitude === 'number' ? offset : amplitude;
      };
      let unit = 'number';
      if (node.operator === 'control.time') unit = 'seconds';
      else if (node.operator === 'control.audio-envelope') compatible(inputUnit('time'), 'seconds', nodeId);
      else if (node.operator === 'control.keyframes') unit = targets.get(String(node.constants?.property))?.unit ?? 'number';
      else if (node.operator === 'control.lfo') {
        compatible(inputUnit('time'), 'seconds', nodeId); compatible(inputUnit('frequency'), 'Hz', nodeId);
        compatible(inputUnit('phase'), 'turns', nodeId); unit = scaledSignal();
      } else if (node.operator === 'control.noise') {
        compatible(inputUnit('time'), 'seconds', nodeId); compatible(inputUnit('frequency'), 'Hz', nodeId); unit = scaledSignal();
      } else if (node.operator === 'control.envelope') {
        for (const id of ['age', 'attack', 'hold', 'decay']) compatible(inputUnit(id), 'seconds', nodeId);
        unit = inputUnit('amplitude');
      } else if (node.operator === 'control.marker-trigger') {
        compatible(inputUnit('time'), 'seconds', nodeId);
        const mode = String(node.constants?.mode ?? 'since');
        unit = mode === 'since' || mode === 'until' ? 'seconds' : 'number';
      } else if (node.operator === 'control.ik-two-bone') {
        const position = inputUnit('rootX');
        for (const id of ['rootY', 'targetX', 'targetY', 'length1', 'length2']) compatible(position, inputUnit(id), nodeId);
        unit = IK_ANGLE_OUTPUTS.has(portId) ? 'degrees' : portId === 'reach' ? 'number' : position;
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
      units.set(cacheKey, unit); return unit;
    } finally { unitVisiting.delete(nodeId); }
  };
  /** Compute every output of one node; multi-output nodes share a single solve per request. */
  const computeOutputs = (node: BoundOperatorNode): Record<string, number> => {
    const nodeId = node.id, definition = getControlOperator(node.operator)!;
    const input = (id: string, fallback = 0): number => {
      const source = program!.inputs.get(`${nodeId}\0${id}`);
      if (source) return evaluateNode(source);
      const constant = node.constants?.[id] ?? definition.parameters.find(p => p.id === id)?.default ?? fallback;
      if (typeof constant !== 'number') throw new ParameterSourceError(`Input ${id} requires a number.`, nodeId);
      return finite(constant, nodeId);
    };
    /** An unwired clock input reads its authored clock; an explicit number stays a number. */
    const clockInput = (id: string): number => {
      const source = program!.inputs.get(`${nodeId}\0${id}`);
      if (source) return evaluateNode(source);
      const raw = node.constants?.[id] ?? controlClockInputs(node.operator)[id];
      if (raw === 'clip') return clipTime;
      if (raw === 'timeline') return clock.timelineTime;
      return input(id);
    };
    const nonNegative = (id: string) => {
      const value = input(id);
      if (value < 0) throw new ParameterSourceError(`${definition.parameters.find(p => p.id === id)?.label ?? id} must not be negative.`, nodeId);
      return value;
    };
    switch (node.operator) {
      case 'values.number': return { value: input('value') };
      case 'control.time': {
        const basis = node.constants?.basis ?? 'clip';
        if (basis !== 'clip' && basis !== 'timeline') throw new ParameterSourceError('Unknown time basis.', nodeId);
        return { value: basis === 'timeline' ? clock.timelineTime : clipTime };
      }
      case 'control.lfo': return { value: input('offset') + input('amplitude', 1)
        * evaluateScalarOperation('sin', 2 * Math.PI * (input('frequency', 1) * clockInput('time') + input('phase'))) };
      case 'control.noise': return { value: input('offset') + input('amplitude', 1)
        * smoothNoise(input('frequency', 1) * clockInput('time'), input('seed'), input('octaves', 1)) };
      case 'control.envelope': {
        const curve = String(node.constants?.curve ?? 'exponential');
        if (curve !== 'exponential' && curve !== 'linear') throw new ParameterSourceError('Unknown envelope curve.', nodeId);
        return { value: input('amplitude', 1) * envelopeValue(clockInput('age'), nonNegative('attack'), nonNegative('hold'), nonNegative('decay'), curve) };
      }
      case 'control.marker-trigger': {
        const mode = String(node.constants?.mode ?? 'since') as MarkerTriggerMode;
        if (!['since', 'until', 'count', 'progress'].includes(mode)) throw new ParameterSourceError('Unknown marker output.', nodeId);
        const markers = frozenMarkerParameterContext(state!.graph) ?? liveMarkerParameterContext(state!.graph, clip.id);
        return { value: markerTriggerValue(markers, clockInput('time'), String(node.constants?.label ?? ''), mode) };
      }
      case 'control.ik-two-bone': {
        const bend = node.constants?.bend ?? 'positive';
        if (bend !== 'positive' && bend !== 'negative') throw new ParameterSourceError('Unknown bend direction.', nodeId);
        try {
          const solved = solveTwoBoneIk(input('rootX'), input('rootY'), input('targetX'), input('targetY'),
            input('length1'), input('length2'), bend === 'positive' ? 1 : -1, input('aspect', 1));
          return { ...solved };
        } catch (error) {
          if (error instanceof ParameterSourceError) throw error;
          throw new ParameterSourceError(error instanceof Error ? error.message : String(error), nodeId);
        }
      }
      case 'control.keyframes': return { value: sampleCurve(String(node.constants?.property ?? '')) };
      case 'control.audio-envelope': {
        const context = frozenAudioParameterContext(state!.graph) ?? audioContext ?? liveAudioParameterContext(state!.graph);
        if (!context) throw new ParameterSourceError('Audio analysis context is unavailable.', nodeId);
        const linked = program!.inputs.get(`${nodeId}\0time`);
        if (!linked && node.constants?.basis === 'source' && node.constants?.time === 'timeline') {
          throw new ParameterSourceError('Connect explicit source seconds to the Audio envelope time input.', nodeId);
        }
        const time = linked ? evaluateNode(linked) : node.constants?.time === 'timeline' ? clock.timelineTime : input('time');
        return { value: evaluateAudioParameter(context, String(node.constants?.audioClipId ?? ''), time,
          String(node.constants?.basis ?? 'timeline') as 'timeline' | 'source', {
            metric: String(node.constants?.metric ?? 'rms-dbfs') as AudioEnvelopeSampling['metric'],
            interpolation: String(node.constants?.interpolation ?? 'linear') as AudioEnvelopeSampling['interpolation'],
            floorDb: input('floorDb', -60), ceilingDb: input('ceilingDb', 0),
          }) };
      }
      case 'math.add.scalar': return { value: evaluateScalarOperation('add', input('a'), input('b')) };
      case 'math.multiply.scalar': return { value: evaluateScalarOperation('multiply', input('a'), input('b', 1)) };
      case 'math.clamp.scalar': {
        const min = input('min'), max = input('max', 1);
        if (min > max) throw new ParameterSourceError('Clamp minimum must not exceed maximum.', nodeId);
        return { value: evaluateScalarOperation('clamp', input('value'), min, max) };
      }
      case 'control.remap': {
        const minimum = input('inMin', -1), span = input('inMax', 1) - minimum;
        if (span === 0) throw new ParameterSourceError('Remap input range must not be zero.', nodeId);
        return { value: evaluateScalarOperation('mix', input('outMin'), input('outMax', 1), (input('value') - minimum) / span) };
      }
      default: throw new ParameterSourceError('Unsupported control operator.', nodeId);
    }
  };
  const evaluateNode = (endpoint: OperatorEndpoint): number => {
    if (!state || state.version !== 1) throw new ParameterSourceError('Unsupported parameter-source state.');
    loadProgram();
    const { nodeId, portId } = endpoint;
    const found = values.get(`${nodeId}\0${portId}`);
    if (found !== undefined) return found;
    const node = program!.nodes.get(nodeId);
    if (!node) throw new ParameterSourceError('Control source is missing.', nodeId);
    const error = program!.errors.get(nodeId);
    if (error) throw new ParameterSourceError(error, nodeId);
    if (!getControlOperator(node.operator)!.outputs.some(port => port.id === portId)) throw new ParameterSourceError('Unknown control output.', nodeId);
    unitFor(nodeId, portId);
    if (visiting.has(nodeId)) throw new ParameterSourceError('Control graph contains a cycle.', nodeId);
    visiting.add(nodeId);
    try {
      const outputs = computeOutputs(node);
      for (const [id, value] of Object.entries(outputs)) values.set(`${nodeId}\0${id}`, finite(value, nodeId));
      const value = values.get(`${nodeId}\0${portId}`);
      if (value === undefined) throw new ParameterSourceError('Unknown control output.', nodeId);
      return value;
    } finally { visiting.delete(nodeId); }
  };
  const resolve = (property: string): ParameterSourceResult => {
    const target = targets.get(property);
    if (!target) throw new ParameterSourceError('Parameter does not support control sources.', undefined, property);
    const binding = state?.targets[property];
    if (binding?.source && binding.enabled !== false) {
      const value = evaluateNode(binding.source);
      compatible(unitFor(binding.source.nodeId, binding.source.portId), target.unit, binding.source.nodeId);
      if ((target.hardMin !== undefined && value < target.hardMin) || (target.hardMax !== undefined && value > target.hardMax)) {
        throw new ParameterSourceError('Control value is outside the runtime range. Insert Clamp or Remap.', binding.source.nodeId, property);
      }
      return { value, kind: 'node', source: binding.source };
    }
    if (binding?.localMode !== 'constant' && keys.some(key => key.property === property)) return { value: sampleCurve(property), kind: 'keyframes' };
    return { value: finite(target.value), kind: 'constant' };
  };
  const evaluateInput = (nodeId: string, portId: string): number => {
    const node = loadProgram(nodeId).nodes.get(nodeId), definition = node && getControlOperator(node.operator);
    if (!node || !definition?.inputs.some(port => port.id === portId)) throw new ParameterSourceError('Unknown control input.', nodeId);
    const source = program!.inputs.get(`${nodeId}\0${portId}`);
    if (source) return evaluateNode(source);
    const raw = node.constants?.[portId] ?? definition.parameters.find(param => param.id === portId)?.default
      ?? controlClockInputs(node.operator)[portId] ?? 0;
    if (raw === 'clip') return finite(clipTime, nodeId);
    if (raw === 'timeline') return finite(clock.timelineTime, nodeId);
    if (typeof raw !== 'number') throw new ParameterSourceError('Control input requires a number.', nodeId);
    return finite(raw, nodeId);
  };
  return { resolve, evaluateNode, evaluateInput, targets };
}
