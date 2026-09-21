import type { EffectOperatorGraph, OperatorDefinition } from '../../types/operatorGraph';
import { AUDIO_OPERATORS, AUDIO_SCALAR_OPERATORS } from './audioOperators';
import { getEffectOperator } from './operatorRegistry';
import { validateEffectGraph } from './effectGraph';
import { evaluateScalarOperation, type SharedScalarOperation } from './scalarOperationSemantics';

export const AUDIO_MATH_EFFECT_ID = 'audio-math';
export const AUDIO_GRAPH_PARAM = 'operatorGraph';
export const AUDIO_GRAPH_NODE_LIMIT = 64;
export function audioGraphOperators(): readonly OperatorDefinition[] {
  return [getEffectOperator('values.number')!, ...AUDIO_SCALAR_OPERATORS, ...AUDIO_OPERATORS];
}
export function createDefaultAudioOperatorGraph(): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'audio', nodes: [
    { id: 'input', operator: 'audio.input', operatorVersion: 1, bindings: {} },
    { id: 'gain', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 } },
    { id: 'multiply', operator: 'math.multiply.audio-scalar', operatorVersion: 1, bindings: {} },
    { id: 'output', operator: 'audio.output', operatorVersion: 1, bindings: {} },
  ], edges: [
    { id: 'input-multiply', from: 'input', output: 'audio', to: 'multiply', input: 'a' },
    { id: 'gain-multiply', from: 'gain', output: 'value', to: 'multiply', input: 'b' },
    { id: 'multiply-output', from: 'multiply', output: 'value', to: 'output', input: 'audio' },
  ], layout: { input: { x: 0, y: 0 }, gain: { x: 0, y: 200 }, multiply: { x: 290, y: 0 }, output: { x: 580, y: 0 } } };
}

export function readAudioOperatorGraph(value: unknown): EffectOperatorGraph {
  if (value === undefined || value === '') return createDefaultAudioOperatorGraph();
  if (typeof value !== 'string' || value.length > 100_000) throw new Error('Invalid saved audio graph.');
  const graph = JSON.parse(value) as EffectOperatorGraph;
  validateAudioOperatorGraph(graph);
  return graph;
}

export function validateAudioOperatorGraph(graph: EffectOperatorGraph): void {
  if (!graph || graph.domain !== 'audio' || graph.nodes?.length > AUDIO_GRAPH_NODE_LIMIT || graph.groups?.some(group => group.composition)) {
    throw new Error('Unsupported audio graph.');
  }
  const errors = validateEffectGraph(graph, typeof graph.incomplete === 'string');
  if (errors.length) throw new Error(errors[0]);
  const supported = new Set(audioGraphOperators().map(operator => operator.id));
  if (graph.nodes.some(node => !supported.has(node.operator))) throw new Error('Operator is not supported by the audio sample executor.');
  if (graph.nodes.filter(node => node.operator === 'audio.input').length !== 1
    || graph.nodes.filter(node => node.operator === 'audio.output').length !== 1) throw new Error('Audio graph requires one input and one output.');
}

export interface AudioMathInstruction { operation: string; inputs: number[]; value?: number }
export interface AudioMathProgram { instructions: readonly AudioMathInstruction[]; output: number; paused?: boolean }
const cache = new Map<string, AudioMathProgram>();

/** Plans are immutable and bounded. Parsing/topology work never runs per sample. */
export function compileAudioOperatorGraph(graph: EffectOperatorGraph): AudioMathProgram {
  validateAudioOperatorGraph(graph);
  if (graph.incomplete) return { instructions: [], output: 0, paused: true };
  const instructions: AudioMathInstruction[] = [], registers = new Map<string, number>();
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const incoming = new Map(graph.edges.map(edge => [`${edge.to}:${edge.input}`, edge.from]));
  const visit = (id: string): number => {
    const existing = registers.get(id); if (existing !== undefined) return existing;
    const node = byId.get(id)!;
    const operator = getEffectOperator(node.operator)!;
    const inputs = operator.inputs.map(input => {
      const source = incoming.get(`${id}:${input.id}`);
      if (!source) throw new Error(`Connect ${operator.label} ${input.label}.`);
      return visit(source);
    });
    if (node.operator === 'audio.output' || node.bypassed) {
      if (node.bypassed && operator.bypass === 'mute') {
        const register = instructions.push({ operation: 'constant', inputs: [], value: 0 }) - 1;
        registers.set(id, register); return register;
      }
      // A mixed Number/Audio variant must pass samples through, never turn a
      // bypassed node into a constant DC signal merely because A is scalar.
      const inputIndex = operator.outputs[0]?.type === 'audio' ? operator.inputs.findIndex(input => input.type === 'audio') : 0;
      const passthrough = inputs[Math.max(0, inputIndex)];
      if (passthrough === undefined) throw new Error('This audio node cannot be bypassed.');
      registers.set(id, passthrough); return passthrough;
    }
    const operation = node.operator === 'audio.input' ? 'input' : node.operator === 'values.number' ? 'constant' : operator.family!.slice(5);
    const value = node.constants?.value ?? 1;
    if (operation === 'constant' && (Object.keys(node.bindings).length || typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('Audio graph values require finite local constants.');
    }
    const register = instructions.push({ operation, inputs, ...(operation === 'constant' ? { value: value as number } : {}) }) - 1;
    registers.set(id, register); return register;
  };
  return { instructions, output: visit(graph.nodes.find(node => node.operator === 'audio.output')!.id) };
}

export function audioMathProgram(value: unknown): AudioMathProgram {
  const key = value === undefined ? '' : value;
  if (typeof key !== 'string') throw new Error('Invalid audio graph.');
  let plan = cache.get(key);
  if (!plan) {
    plan = compileAudioOperatorGraph(readAudioOperatorGraph(key));
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, plan);
  }
  return plan;
}

/** Same per-sample kernel for playback, scrub and export. Channel count/rate are preserved.
 * Nonfinite results become silence at the output; ordinary over-range samples are not clipped. */
export function processAudioMathChannels(program: AudioMathProgram, inputs: readonly Float32Array[], outputs: readonly Float32Array[]) {
  const values = new Float64Array(program.instructions.length);
  for (let channel = 0; channel < outputs.length; channel++) {
    const input = inputs[channel], output = outputs[channel];
    if (!input) { output.fill(0); continue; }
    if (program.paused) { output.fill(0); output.set(input.subarray(0, output.length)); continue; }
    for (let sample = 0; sample < output.length; sample++) {
      for (let i = 0; i < program.instructions.length; i++) {
        const step = program.instructions[i];
        values[i] = step.operation === 'input' ? input[sample] ?? 0 : step.operation === 'constant' ? step.value!
          : evaluateScalarOperation(step.operation as SharedScalarOperation, values[step.inputs[0]], values[step.inputs[1]], values[step.inputs[2]]);
      }
      const value = Math.fround(values[program.output]);
      output[sample] = Number.isFinite(value) ? value : 0;
    }
  }
}
