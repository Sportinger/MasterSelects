import type { BoundOperatorNode, SceneOperatorGraph } from '../../types/operatorGraph';

export const SPLAT_SCALAR_OPERATORS = new Set(['values.number', 'values.oscillator', 'math.add.scalar', 'math.multiply.scalar', 'math.clamp.scalar', 'math.sin.scalar']);

/** Shared scalar operators feed uniform parameters; per-point fields stay on the GPU. */
export function splatScalarInputs(definition: SceneOperatorGraph, time: number) {
  const nodes = new Map(definition.graph.nodes.map(n => [n.id, n]));
  const parent = (node: BoundOperatorNode, port: string) => nodes.get(definition.graph.edges.find(e => e.to === node.id && e.input === port)?.from ?? '');
  const literal = (node: BoundOperatorNode, parameter: string, fallback: number): number => {
    const binding = node.bindings[parameter];
    const value = typeof binding === 'string' ? definition.params[binding] : node.constants?.[parameter];
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid scalar value.');
    return value;
  };
  const scalar = (node: BoundOperatorNode | undefined, path = new Set<string>()): number => {
    if (!node) throw new Error('Connect the scalar inputs.');
    if (path.has(node.id)) throw new Error('Cycles are not supported.');
    const next = new Set(path).add(node.id), input = (port: string) => scalar(parent(node, port), next);
    if (!SPLAT_SCALAR_OPERATORS.has(node.operator)) throw new Error('Unsupported splat parameter source.');
    let value: number;
    if (node.bypassed) value = node.operator.startsWith('values.') ? 0 : input(['math.sin.scalar', 'math.clamp.scalar'].includes(node.operator) ? 'value' : 'a');
    else switch (node.operator) {
      case 'values.number': value = literal(node, 'value', 1); break;
      case 'values.oscillator': value = literal(node, 'offset', 0) + literal(node, 'amplitude', 1) * Math.sin(2 * Math.PI * literal(node, 'frequency', 1) * time); break;
      case 'math.add.scalar': value = input('a') + input('b'); break;
      case 'math.multiply.scalar': value = input('a') * input('b'); break;
      case 'math.sin.scalar': value = Math.sin(input('value')); break;
      default: value = Math.min(input('max'), Math.max(input('min'), input('value')));
    }
    if (!Number.isFinite(value)) throw new Error('Non-finite splat parameter source.');
    return value;
  };
  return (node: BoundOperatorNode, parameter: string): number | undefined => {
    const source = parent(node, parameter); return source ? scalar(source) : undefined;
  };
}
