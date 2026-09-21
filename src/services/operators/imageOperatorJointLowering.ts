import type { BoundOperatorNode } from '../../types/operatorGraph';
import type { ImagePlanInstruction } from './imageOperatorPlanTypes';

/** Lowers shared, pure multi-output lookups once and exposes typed extraction registers. */
export function lowerMarchingSquaresTopology(options: {
  node: BoundOperatorNode; output: string; scope: number; registers: Map<string, number>;
  visitInput: (id: string) => number; emit: (instruction: ImagePlanInstruction) => number;
}): number {
  const { node, output, scope, registers, visitInput, emit } = options;
  const key = `${scope}:${node.id}:topology`;
  if (!registers.has(key)) {
    const topology = emit({ nodeId: node.id, operation: 'marching-squares-topology', type: 'vec4',
      inputs: ['tl', 'tr', 'br', 'bl', 'top', 'right', 'bottom', 'left'].map(visitInput) });
    registers.set(key, topology);
    for (const [id, type] of [['a', 'vec2'], ['b', 'vec2'], ['c', 'vec2'], ['d', 'vec2'], ['count', 'scalar']] as const) {
      registers.set(`${scope}:${node.id}:${id}`, emit({ nodeId: node.id, operation: `marching-squares-${id}`, type, inputs: [topology] }));
    }
  }
  const result = registers.get(`${scope}:${node.id}:${output}`);
  if (result === undefined) throw new Error(`Marching-squares topology ${node.id} has no output ${output}.`);
  return result;
}
