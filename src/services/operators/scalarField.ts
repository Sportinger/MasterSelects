import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorPort } from '../../types/operatorGraph';

export const MAX_SCALAR_FIELD_OPS = 32;
const field = (id: string, label: string): OperatorPort => ({ id, label, type: 'field' });
export const SCALAR_FIELD_OPS = { constant: 0, luminance: 1, add: 2, subtract: 3, multiply: 4, divide: 5, power: 6, min: 7, max: 8, abs: 9, sin: 10, clamp: 11 } as const;
// Same names as the image math family: Minimum, not Min.
const SCALAR_FIELD_LABELS: Record<string, string> = { constant: 'Value', min: 'Minimum', max: 'Maximum', abs: 'Absolute', sin: 'Sine' };
export const SCALAR_FIELD_OPERATORS: readonly OperatorDefinition[] = [
  { id: 'image.luminance', version: 1, label: 'Luminance', description: 'Reads linear RGB luminance from the connected texture for each grid cell.',
    inputs: [{ id: 'texture', label: 'Texture', type: 'texture' }], outputs: [field('value', 'Luminance')], parameters: [], invalidates: 'appearance', runtime: 'builtin', addable: true },
  ...Object.keys(SCALAR_FIELD_OPS).filter(name => name !== 'luminance').map(name => ({
    id: `math.${name}`, version: 1 as const, label: SCALAR_FIELD_LABELS[name] ?? name[0].toUpperCase() + name.slice(1),
    description: 'Scalar field arithmetic evaluated for each grid cell in the same GPU pass. Unconnected inputs use the numeric controls.',
    inputs: name === 'constant' ? [] : [field('a', 'A'), ...(['abs', 'sin'].includes(name) ? [] : [field('b', name === 'clamp' ? 'Minimum' : 'B')]), ...(name === 'clamp' ? [field('c', 'Maximum')] : [])],
    outputs: [field('value', 'Value')],
    parameters: (name === 'constant' ? ['value'] : ['a', ...(['abs', 'sin'].includes(name) ? [] : ['b']), ...(name === 'clamp' ? ['c'] : [])]).map(id => ({
      id, label: id === 'value' ? 'Value' : name === 'clamp' && id === 'b' ? 'Minimum' : name === 'clamp' && id === 'c' ? 'Maximum' : id.toUpperCase(),
      type: 'number' as const, default: id === 'c' || id === 'b' && ['multiply', 'divide', 'power'].includes(name) ? 1 : 0,
      min: -10, max: 10, step: 0.01, animatable: true,
    })), invalidates: 'appearance' as const, runtime: 'builtin' as const, addable: true,
  })),
];

export interface ScalarFieldProgram { operations: [number, number, number, number][]; output: number; textureNodeId?: string; nodeRegisters?: Record<string, number> }

/** A bounded topological register program. Nested presentation groups do not
 * introduce passes or duplicate evaluation of shared mathematical subgraphs. */
export function compileScalarField(graph: EffectOperatorGraph, output: BoundOperatorNode,
  value: (node: BoundOperatorNode, name: string) => number, enabled: (node: BoundOperatorNode) => boolean = node => !node.bypassed): ScalarFieldProgram {
  const operations: ScalarFieldProgram['operations'] = [], indexes = new Map<string, number>();
  let textureNodeId: string | undefined;
  const emit = (instruction: ScalarFieldProgram['operations'][number]) => {
    if (operations.length >= MAX_SCALAR_FIELD_OPS) throw new Error(`Height field exceeds ${MAX_SCALAR_FIELD_OPS} operations.`);
    return operations.push(instruction) - 1;
  };
  const input = (node: BoundOperatorNode, name: string) => graph.nodes.find(candidate => candidate.id === graph.edges.find(edge => edge.to === node.id && edge.input === name)?.from);
  const visit = (node: BoundOperatorNode): number => {
    const cached = indexes.get(node.id); if (cached !== undefined) return cached;
    let index: number;
    if (!enabled(node)) {
      const source = input(node, 'a');
      index = source ? visit(source) : emit([0, 0, 0, node.operator.startsWith('math.') && node.operator !== 'math.constant' ? value(node, 'a') : 0]);
    } else if (node.operator === 'image.luminance') {
      const texture = input(node, 'texture');
      if (!texture || !enabled(texture)) { index = emit([0, 0, 0, 0]); indexes.set(node.id, index); return index; }
      if (texture.operator !== 'texture.image') throw new Error('Unsupported luminance texture.');
      if (textureNodeId && textureNodeId !== texture.id) throw new Error('A height field currently samples one texture mapping; share its luminance node.');
      textureNodeId = texture.id; index = emit([SCALAR_FIELD_OPS.luminance, 0, 0, 0]);
    } else {
      const name = node.operator.slice(5) as keyof typeof SCALAR_FIELD_OPS;
      if (!node.operator.startsWith('math.') || !(name in SCALAR_FIELD_OPS)) throw new Error('Unsupported height field operation.');
      const argument = (id: string) => { const source = input(node, id); return source ? visit(source) : emit([0, 0, 0, value(node, id)]); };
      index = name === 'constant' ? emit([0, 0, 0, value(node, 'value')])
        : emit([SCALAR_FIELD_OPS[name], argument('a'), ['abs', 'sin'].includes(name) ? 0 : argument('b'), name === 'clamp' ? argument('c') : 0]);
    }
    indexes.set(node.id, index); return index;
  };
  const result = visit(output);
  return { operations, output: result, textureNodeId, nodeRegisters: Object.fromEntries(indexes) };
}

export function packScalarField(program: ScalarFieldProgram): number[] {
  const values = Array<number>(MAX_SCALAR_FIELD_OPS * 4).fill(0);
  program.operations.forEach((operation, index) => operation.forEach((value, component) => { values[index * 4 + component] = value; }));
  return values;
}
