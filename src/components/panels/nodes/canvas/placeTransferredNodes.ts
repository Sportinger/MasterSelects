import type { NodeGraph, NodeGraphLayout, NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeHeight, NODE_WIDTH } from './canvasGeometry';
import { spacePreviewBlocks } from './spacePreviewNodes';

/** Only incoming nodes are packed on group entry. Existing/manual positions stay fixed. */
export function placeTransferredNodes(graph: NodeGraph, nodes: NodeGraphNode[], targetId: string,
  moves: Array<{ nodeId: string; layout: NodeGraphLayout }>) {
  const moving = new Set(moves.map(move => move.nodeId));
  let group = graph.groups?.find(candidate => candidate.id === targetId);
  while (group?.parentId) group = graph.groups?.find(candidate => candidate.id === group?.parentId);
  const targetMembers = new Set(group?.nodeIds);
  const fixed = nodes.filter(node => targetMembers.has(node.id) && !moving.has(node.id));
  const blocks = [...fixed.map(node => ({ id: node.id, ...node.layout, width: NODE_WIDTH, height: getNodeHeight(node) })),
    ...moves.map(move => ({ id: move.nodeId, ...move.layout, width: NODE_WIDTH, height: getNodeHeight(nodes.find(node => node.id === move.nodeId)!) }))];
  const positions = new Map(spacePreviewBlocks(blocks, new Set(fixed.map(node => node.id))).map(block => [block.id, { x: block.x, y: block.y }]));
  return moves.map(move => ({ ...move, layout: positions.get(move.nodeId)! }));
}
