import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
export type VoxelUV = [number, number, number, number];

export function voxelTextureMapping(graph: EffectOperatorGraph, texture: BoundOperatorNode | undefined,
  value: (node: BoundOperatorNode, parameter: string) => number, enabled: (node: BoundOperatorNode) => boolean): VoxelUV | undefined {
  const input = (node: BoundOperatorNode, port: string) => graph.nodes.find(source => source.id === graph.edges.find(edge => edge.to === node.id && edge.input === port)?.from);
  const uv = (node?: BoundOperatorNode): VoxelUV => {
    if (!node) return [1, 1, 0, 0];
    const parent = uv(input(node, 'uv'));
    if (!enabled(node)) return parent;
    const sx = value(node, 'scaleU'), sy = value(node, 'scaleV');
    const result: VoxelUV = [parent[0] * sx, parent[1] * sy, parent[2] * sx + value(node, 'offsetU'), parent[3] * sy + value(node, 'offsetV')];
    if (result.some(number => !Number.isFinite(number) || Math.abs(number) > 1e6)) throw new Error('Combined UV transform exceeds its supported range.');
    return result;
  };
  if (texture?.operator !== 'texture.image' || !enabled(texture)) return undefined;
  const frame = input(texture, 'image');
  return frame?.operator === 'image.frame' && enabled(frame) ? uv(input(texture, 'uv')) : undefined;
}
