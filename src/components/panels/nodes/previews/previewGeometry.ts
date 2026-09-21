import type { NodeGraphNode } from '../../../../types/nodeGraph';

export const NODE_PREVIEW_HEIGHT = 124;
export const NODE_PREVIEW_WIDTH = 164;
export const isNumericValueNode = (node: NodeGraphNode): boolean => ['values.number', 'values.integer'].includes(node.operatorId ?? '');
export const inlineNumericPorts = (node: NodeGraphNode): boolean => !!node.operatorId?.startsWith('math.') || isNumericValueNode(node) || ['flock.value', 'flock.math'].includes(node.operatorId ?? '');
export function previewAtlasTile(zoom: number, ratio: number) {
  return zoom * ratio < 0.35 ? 64 : zoom * ratio < 0.75 ? 128 : 256;
}
export function previewExtraHeight(node: NodeGraphNode) {
  if (!node.preview?.enabled) return 0;
  if (inlineNumericPorts(node)) return 0;
  const ratio = node.preview.aspectRatio ?? 16 / 9;
  return Math.round(Math.min(292, NODE_PREVIEW_WIDTH / Math.max(0.1, ratio))) + 42;
}
export function previewRect(nodeHeight: number, node?: NodeGraphNode) {
  const height = node ? inlineNumericPorts(node) ? 42 : previewExtraHeight(node) : NODE_PREVIEW_HEIGHT;
  return { x: 10, y: nodeHeight - height, width: NODE_PREVIEW_WIDTH, height: height - 10 };
}
