import type { BoundOperatorNode } from '../../types/operatorGraph';
import type { ImageOperatorMemoryWindowOptions, ImageOperatorMemoryWindowResource } from './imageOperatorExternalResources';
const BINDINGS = ['size', 'depth', 'offset', 'motion', 'stride', 'seed', 'snapshot'] as const;
export const IMAGE_MEMORY_WINDOW_RESOURCE_PREFIX = 'memory-window:';

export function resolveImageOperatorMemoryWindow(node: BoundOperatorNode, params: Record<string, unknown>, allowed: boolean | undefined): ImageOperatorMemoryWindowResource {
  if (!allowed) throw new Error(`Memory window ${node.id} requires an explicit compile-context opt-in.`);
  const bindings = Object.fromEntries(BINDINGS.map(id => [id, node.bindings[id]]));
  if (BINDINGS.some(id => typeof bindings[id] !== 'string' || !bindings[id])) throw new Error(`Memory window ${node.id} requires all seven owner bindings.`);
  const values = Object.fromEntries(BINDINGS.map(id => [id, params[bindings[id] as string]]));
  for (const id of ['size', 'offset', 'stride', 'seed'] as const) {
    if (typeof values[id] !== 'number' || !Number.isFinite(values[id])) throw new Error(`Memory window ${node.id} has invalid ${id}.`);
  }
  if (values.depth !== '8' && values.depth !== '16' && values.depth !== '32') throw new Error(`Memory window ${node.id} has invalid depth.`);
  if (values.motion !== 'static' && values.motion !== 'advance' && values.motion !== 'shuffle') throw new Error(`Memory window ${node.id} has invalid motion.`);
  if (typeof values.snapshot !== 'string') throw new Error(`Memory window ${node.id} has invalid snapshot.`);
  return { id: `${IMAGE_MEMORY_WINDOW_RESOURCE_PREFIX}${node.id}`, kind: 'memory-window', options: values as unknown as ImageOperatorMemoryWindowOptions };
}
