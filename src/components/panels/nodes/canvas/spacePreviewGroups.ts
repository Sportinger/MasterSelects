import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeHeight, NODE_WIDTH } from './canvasGeometry';
import { encloseNodeGroup } from './groupBounds';
import { spacePreviewBlocks, spacePreviewNodes, type PreviewLayoutBlock } from './spacePreviewNodes';

interface GroupBlock extends PreviewLayoutBlock { nodeIds: string[]; group: boolean }

/** Pack from the innermost group outward. Siblings must avoid the entire expanded
 * frame, including its empty space, header and nested frames, not just its cards.
 * Folding is projected first, so each pass uses the current proxy or contents.
 */
export function spacePreviewGroups(graph: NodeGraph, fixedIds: ReadonlySet<string> = new Set()): NodeGraphNode[] {
  if (!graph.groups?.length && !fixedIds.size) return spacePreviewNodes(graph.nodes);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const groups = new Map((graph.groups ?? []).map(group => [group.id, group]));
  const children = new Map<string | undefined, NonNullable<NodeGraph['groups']>>();
  for (const group of graph.groups ?? []) {
    const parent = group.parentId && groups.has(group.parentId) ? group.parentId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), group]);
  }
  const layout = (id?: string): GroupBlock | undefined => {
    const group = id ? groups.get(id) : undefined;
    const listedIds = (group?.nodeIds ?? graph.nodes.map(node => node.id)).filter(nodeId => nodes.has(nodeId));
    const nested = (group?.collapsed ? [] : children.get(id) ?? []).flatMap(child => {
      const block = layout(child.id); return block ? [block] : [];
    });
    const nestedIds = new Set(nested.flatMap(block => block.nodeIds));
    const memberIds = [...new Set([...listedIds, ...nestedIds])];
    const blocks: GroupBlock[] = [...nested, ...memberIds.filter(nodeId => !nestedIds.has(nodeId)).map(nodeId => {
      const node = nodes.get(nodeId)!;
      return { id: `node:${nodeId}`, ...node.layout, width: NODE_WIDTH, height: getNodeHeight(node), nodeIds: [nodeId], group: false };
    })];
    const placed = spacePreviewBlocks(blocks, new Set(blocks.filter(block => block.nodeIds.some(nodeId => fixedIds.has(nodeId))).map(block => block.id)));
    const childBounds = [];
    for (let index = 0; index < blocks.length; index++) {
      const before = blocks[index], after = placed[index], dx = after.x - before.x, dy = after.y - before.y;
      if (dx || dy) for (const nodeId of before.nodeIds) {
        const node = nodes.get(nodeId)!;
        nodes.set(nodeId, { ...node, layout: { x: node.layout.x + dx, y: node.layout.y + dy } });
      }
      if (before.group) childBounds.push({ left: after.x, top: after.y, right: after.x + after.width, bottom: after.y + after.height });
    }
    if (!group || !memberIds.length) return;
    const bounds = encloseNodeGroup(memberIds.map(nodeId => nodes.get(nodeId)!), childBounds);
    return { id: `group:${group.id}`, nodeIds: memberIds, group: true,
      x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
  };
  layout();
  return graph.nodes.map(node => nodes.get(node.id)!);
}
